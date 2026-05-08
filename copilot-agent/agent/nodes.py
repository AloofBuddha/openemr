"""LangGraph node implementations.

Each node is a top-level async function ``(state, deps) -> dict``. The graph
binds ``deps`` via ``functools.partial`` so the runtime callable matches the
``Callable[[State], Awaitable[State]]`` signature LangGraph expects.

This shape (as opposed to closure-captured deps inside ``build_graph``)
makes the nodes individually testable: a unit test can construct a
``GraphDeps`` with mock clients and call any node directly.
"""
from __future__ import annotations

import json
import logging
import re
import time
from dataclasses import dataclass
from typing import Any, Callable

import anthropic
import chromadb
from rank_bm25 import BM25Okapi

from agent.prompt_helpers import format_guideline_sources, summarise_extracted_docs
from agent.supervisor import (
    AgentState,
    SupervisorDecision,
    _estimate_cost,
    make_supervisor_decision,
    query_wants_guidelines,
)
from rag.indexer import GuidelineChunk
from rag.retriever import retrieve

logger = logging.getLogger(__name__)

MAX_ITERATIONS = 3
SONNET = "claude-sonnet-4-6"

ANSWER_PROMPT = """\
You are a clinical co-pilot assistant helping a physician prepare for a patient visit.
Answer the physician's query concisely (1-3 paragraphs) using only the patient context and
guideline evidence provided below. Never fabricate clinical facts.

CITATION RULES — MANDATORY, NO EXCEPTIONS:
Every drug name, lab value, diagnosis, visit reason, and allergy you mention MUST be wrapped
in citation markers. No clinical fact may appear without one. The three namespaces are
distinct — never use [[PN]] for a document or [[DN]] for a patient-context line.
- Patient record facts → [[PN]]the exact phrase[[/PN]]
  where N matches the line number in PATIENT CONTEXT (line [3] → [[P3]]...[[/P3]])
- Extracted document facts → [[DN]]the exact phrase[[/DN]]
  where N matches the [[DN]] index in EXTRACTED DOCUMENT DATA (e.g. [[D1]] = first doc)
- Guideline evidence → [[GN]]the exact phrase[[/GN]]
  where N is the guideline number (e.g. [[G1]]...[[/G1]])

Example of correct output:
"The patient is taking [[P4]]Metformin 500mg[[/P4]] for [[P2]]Type 2 Diabetes[[/P2]].
The recent lab shows [[D1]]A1c 9.2%[[/D1]].
[[G1]]Guidelines recommend HbA1c target <7% for most adults[[/G1]]."

Use "unknown" only when a fact is genuinely absent from both sources below.

MEDICAL ADVICE RULE:
If the query asks for a specific clinical decision — what to prescribe, exact dose, whether
to order a test, or a definitive diagnosis — do NOT make that decision. Instead:
1. Open with a single sentence: "I can't make specific clinical decisions, but guidelines
   offer the following context:"
2. Cite the most relevant guideline evidence with [[GN]] inline citations.
3. End with a brief note that the physician should apply their clinical judgment.
This rule does NOT apply to informational questions (explaining a condition, summarising
results, listing risk factors) — answer those directly.

---
PHYSICIAN QUERY:
{query}

---
PATIENT CONTEXT (from OpenEMR records):
{patient_context}

---
EXTRACTED DOCUMENT DATA:
{extracted_docs_summary}

---
CLINICAL GUIDELINE EVIDENCE:
{guideline_sources}
---

Provide your answer now. Be concise and clinically precise.

At the very end of your response, on its own line, output exactly:
SUGGESTIONS: followed by a JSON array of exactly 3 specific follow-up questions the physician might ask next, relevant to this patient and query. No markdown fences around the array.
"""


# ---------------------------------------------------------------------------
# Dependency bundle — passed to every node so they can be tested in isolation
# ---------------------------------------------------------------------------


@dataclass
class GraphDeps:
    anthropic_client: anthropic.AsyncAnthropic
    cohere_client: Any | None
    bm25: BM25Okapi
    bm25_chunks: list[GuidelineChunk]
    chroma_collection: chromadb.Collection
    get_extraction: Callable[[int], dict | None] | None = None


# ---------------------------------------------------------------------------
# Routing helper (the conditional edge)
# ---------------------------------------------------------------------------


def route_from_supervisor(state: AgentState) -> str:
    """Return the next node name based on the supervisor's most recent decision.

    Skips workers whose job is already done (extraction complete, retrieval
    complete). Without this, Haiku occasionally re-proposes the same plan on
    every iteration — we'd loop on intake_extractor until MAX_ITERATIONS and
    never call evidence_retriever.

    Trusts the supervisor's intent classification; doesn't second-guess
    its evidence_retriever decision. An earlier keyword-based veto was
    too aggressive — it silenced guideline citations for follow-ups like
    "what about her A1c?" where the supervisor correctly wanted RAG but
    the query happened to lack a hardcoded keyword.
    """
    decision_data = state.get("_supervisor_decision", {})
    next_workers: list[str] = decision_data.get("next_workers", [])
    intent: list[str] = decision_data.get("intent", [])

    valid_nodes = {"intake_extractor", "evidence_retriever", "answer_assembler"}

    if "out_of_scope" in intent:
        return "answer_assembler"

    extracted_docs = state.get("extracted_docs", [])
    doc_ids = state.get("doc_ids", [])
    guideline_chunks = state.get("guideline_chunks", [])

    extraction_done = len(extracted_docs) >= len(doc_ids)
    retrieval_done = len(guideline_chunks) > 0

    for worker in next_workers:
        if worker == "intake_extractor" and extraction_done:
            continue
        if worker == "evidence_retriever" and retrieval_done:
            continue
        if worker in valid_nodes:
            return worker

    return "answer_assembler"


# ---------------------------------------------------------------------------
# Node: supervisor
# ---------------------------------------------------------------------------


async def supervisor_node(state: AgentState, deps: GraphDeps) -> dict:
    t0 = time.monotonic()
    iteration = state.get("iteration", 0)
    telemetry: dict = {"input_tokens": 0, "output_tokens": 0, "cost_usd": 0.0, "model": SONNET}

    if iteration >= MAX_ITERATIONS:
        logger.warning("Max iterations reached; forcing answer_assembler")
        decision = SupervisorDecision(
            intent=["can_answer"],
            reasoning="Max iterations reached",
            next_workers=["answer_assembler"],
        )
    else:
        decision, telemetry = await make_supervisor_decision(state, deps.anthropic_client)

    routing_log = list(state.get("routing_log", []))
    routing_log.append({
        "node": "supervisor",
        "decision": {
            "intent": decision.intent,
            "next_workers": decision.next_workers,
            "reasoning": decision.reasoning,
        },
        "duration_ms": int((time.monotonic() - t0) * 1000),
        "tokens": {
            "input": telemetry["input_tokens"],
            "output": telemetry["output_tokens"],
        },
        "cost_usd": telemetry["cost_usd"],
        "model": telemetry["model"],
    })

    return {
        "routing_log": routing_log,
        "iteration": iteration + 1,
        "_supervisor_decision": decision.model_dump(),
    }


# ---------------------------------------------------------------------------
# Node: intake_extractor — loads cached extractions from disk
# ---------------------------------------------------------------------------


async def intake_extractor_node(state: AgentState, deps: GraphDeps) -> dict:
    t0 = time.monotonic()
    doc_ids: list[int] = state.get("doc_ids", [])
    already_extracted_ids = {
        d.get("openemr_doc_id") for d in state.get("extracted_docs", [])
    }
    pending_ids = [d for d in doc_ids if d not in already_extracted_ids]

    new_extractions: list[dict] = []
    warnings: list[str] = []

    for doc_id in pending_ids:
        cached = deps.get_extraction(doc_id) if deps.get_extraction is not None else None
        if cached:
            new_extractions.append(cached)
        else:
            warnings.append(f"Doc {doc_id} extraction not found — upload via /ingest first.")

    routing_log = list(state.get("routing_log", []))
    routing_log.append({
        "node": "intake_extractor",
        "decision": {
            "pending_doc_ids": pending_ids,
            "new_extractions": len(new_extractions),
            "warnings": warnings,
        },
        "duration_ms": int((time.monotonic() - t0) * 1000),
    })

    return {
        "extracted_docs": list(state.get("extracted_docs", [])) + new_extractions,
        "routing_log": routing_log,
    }


# ---------------------------------------------------------------------------
# Node: evidence_retriever — hybrid RAG over guideline corpus
# ---------------------------------------------------------------------------


async def evidence_retriever_node(state: AgentState, deps: GraphDeps) -> dict:
    t0 = time.monotonic()
    chunks = retrieve(
        query=state["query"],
        bm25=deps.bm25,
        bm25_chunks=deps.bm25_chunks,
        chroma_collection=deps.chroma_collection,
        cohere_client=deps.cohere_client,
        top_k=5,
    )

    routing_log = list(state.get("routing_log", []))
    routing_log.append({
        "node": "evidence_retriever",
        "decision": {"chunks_retrieved": len(chunks)},
        "duration_ms": int((time.monotonic() - t0) * 1000),
        "tokens": {"input": 0, "output": 0},
        "cost_usd": 0.0,
    })

    return {
        "guideline_chunks": chunks,
        "routing_log": routing_log,
    }


# ---------------------------------------------------------------------------
# Node: answer_assembler — final synthesis with Sonnet
# ---------------------------------------------------------------------------


async def answer_assembler_node(state: AgentState, deps: GraphDeps) -> dict:
    t0 = time.monotonic()
    extracted_docs = state.get("extracted_docs", [])
    guideline_chunks = state.get("guideline_chunks", [])

    prompt = ANSWER_PROMPT.format(
        query=state["query"],
        patient_context=state.get("patient_context", "No patient context provided."),
        extracted_docs_summary=summarise_extracted_docs(extracted_docs),
        guideline_sources=format_guideline_sources(guideline_chunks) or "No guideline evidence retrieved.",
    )

    in_tok = out_tok = 0
    try:
        message = await deps.anthropic_client.messages.create(
            model=SONNET,
            max_tokens=2400,
            messages=[{"role": "user", "content": prompt}],
        )
        answer = message.content[0].text  # type: ignore[union-attr]
        in_tok = getattr(message.usage, "input_tokens", 0) or 0
        out_tok = getattr(message.usage, "output_tokens", 0) or 0
    except Exception:
        logger.exception("Answer assembler Claude call failed")
        answer = (
            "I was unable to generate an answer due to an internal error. "
            "Please review the patient records directly."
        )

    answer, suggestions = _split_answer_and_suggestions(answer)
    if not suggestions:
        # Sonnet occasionally omits the trailing SUGGESTIONS block on long
        # technical answers. Always surface at least one chip so the UI
        # never shows a dead-end.
        suggestions = list(_DEFAULT_SUGGESTIONS)
    suggestions = _ensure_guideline_chip(suggestions)

    routing_log = list(state.get("routing_log", []))
    routing_log.append({
        "node": "answer_assembler",
        "decision": {"answer_length": len(answer)},
        "duration_ms": int((time.monotonic() - t0) * 1000),
        "tokens": {"input": in_tok, "output": out_tok},
        "cost_usd": _estimate_cost(SONNET, in_tok, out_tok),
        "model": SONNET,
    })

    patient_context = state.get("patient_context", "")
    return {
        "answer": answer,
        "citations": _build_citations(guideline_chunks, extracted_docs, patient_context),
        "provenance": _build_provenance_summary(
            guideline_chunks, extracted_docs, has_patient_context=bool(patient_context.strip())
        ),
        "suggestions": suggestions,
        "routing_log": routing_log,
    }


_DEFAULT_SUGGESTIONS = [
    "What is the most pressing item for today's visit?",
    "Are there any pending follow-ups from prior visits?",
    "What do guidelines say about this patient's conditions?",
]

_DEFAULT_GUIDELINE_CHIP = "What do clinical guidelines recommend for this patient?"


def _ensure_guideline_chip(suggestions: list[str]) -> list[str]:
    """Always return three chips with the last one explicitly guideline-related.

    Why: the UX contract is that one chip is always the "ask the guidelines"
    affordance. Clicking it phrases the next query with "guidelines" /
    "recommend", which trips the supervisor's wants-guidelines gate and
    invokes RAG. If we let the model omit a guideline chip, that path is
    invisible to the physician and the RAG capability never surfaces.
    """
    cleaned = [s.strip() for s in suggestions if s and s.strip()]
    has_guideline = any(query_wants_guidelines(s) for s in cleaned)
    if not has_guideline:
        if len(cleaned) >= 3:
            cleaned[2] = _DEFAULT_GUIDELINE_CHIP
        else:
            cleaned.append(_DEFAULT_GUIDELINE_CHIP)
    return cleaned[:3]


def _split_answer_and_suggestions(answer: str) -> tuple[str, list[str]]:
    """Strip the trailing ``SUGGESTIONS: [...]`` block and return both halves.

    The answer prompt instructs Sonnet to emit a JSON array of follow-up
    questions on its own line. If the array is malformed, return [].
    """
    sug_pos = answer.rfind("SUGGESTIONS:")
    if sug_pos == -1:
        return answer, []

    rest = answer[sug_pos + len("SUGGESTIONS:"):].strip()
    cleaned = answer[:sug_pos].strip()

    m = re.search(r"(\[.*\])", rest, re.DOTALL)
    if not m:
        return cleaned, []

    try:
        decoded = json.loads(m.group(1))
    except json.JSONDecodeError:
        logger.warning("Failed to parse suggestions JSON from answer")
        return cleaned, []

    if not isinstance(decoded, list):
        return cleaned, []

    return cleaned, [s for s in decoded if isinstance(s, str)]


_PATIENT_CONTEXT_LINE_RE = re.compile(r"^\s*\[(\d+)\]\s*(.+?)\s*$")
_GUIDELINE_FAMILY_RE = re.compile(r"\[([A-Z][A-Z/]+)")  # "[ACC/AHA 2023 §..." → "ACC/AHA"

_EXTRACTED_RESULTS_LIMIT = 6  # cap how many provenance entries we ship per doc


def _doc_extracted_results(doc: dict[str, Any]) -> list[dict[str, Any]]:
    """Compact list of {label, value, page, quote, abnormal} per extracted item.

    Carries the literal text the extractor pulled from the PDF (via
    ``SourceCitation.quote_or_value``) plus the page reference, so the UI
    can show the physician the actual evidence rather than just doc-level
    metadata.
    """
    out: list[dict[str, Any]] = []
    doc_type = doc.get("doc_type")

    if doc_type == "lab_pdf":
        for r in (doc.get("results") or [])[:_EXTRACTED_RESULTS_LIMIT]:
            sc = r.get("source_citation") or {}
            out.append({
                "label": r.get("test_name") or "Result",
                "value": f"{r.get('value', '')} {r.get('unit') or ''}".strip(),
                "abnormal": r.get("abnormal_flag"),
                "page": sc.get("page_or_section") or "",
                "quote": sc.get("quote_or_value") or "",
                "bbox": sc.get("bbox"),  # null when text didn't match a word
            })
        return out

    if doc_type == "intake_form":
        for m in (doc.get("current_medications") or [])[:_EXTRACTED_RESULTS_LIMIT]:
            sc = m.get("source_citation") or {}
            out.append({
                "label": f"Medication: {m.get('name') or '?'}",
                "value": f"{m.get('dose') or ''} {m.get('frequency') or ''}".strip(),
                "page": sc.get("page_or_section") or "",
                "quote": sc.get("quote_or_value") or "",
            })
        for a in (doc.get("allergies") or [])[:_EXTRACTED_RESULTS_LIMIT]:
            sc = a.get("source_citation") or {}
            out.append({
                "label": f"Allergy: {a.get('allergen') or '?'}",
                "value": a.get("reaction") or "",
                "page": sc.get("page_or_section") or "",
                "quote": sc.get("quote_or_value") or "",
            })
        chief = doc.get("chief_concern")
        if chief:
            sc = (doc.get("source_citation") or {})
            out.append({
                "label": "Chief concern",
                "value": chief,
                "page": sc.get("page_or_section") or "",
                "quote": sc.get("quote_or_value") or chief,
            })
        return out

    return out


def _build_citations(
    guideline_chunks: list[dict[str, Any]],
    extracted_docs: list[dict[str, Any]],
    patient_context: str = "",
) -> list[dict[str, Any]]:
    """Build the citation list surfaced to PHP/UI.

    Three disjoint namespaces:
      G{i} — guideline chunks (RAG hits)
      D{i} — extracted documents (lab PDFs, intake forms). Each carries
             ``extracted_results`` — verbatim quotes + page references so
             the UI can show the physician the actual source text.
      P{N} — patient-context lines. The UI side already builds rich
             entries for these (typed as medication/lab/problem/etc.
             with scroll_to anchors into the chart), so we emit a thin
             record here purely for audit/eval — PHP drops these from
             the displayed source map and lets the JS layer win.
    """
    citations: list[dict[str, Any]] = []
    for i, chunk in enumerate(guideline_chunks, start=1):
        citations.append({
            "ref": f"G{i}",
            "source_ref": chunk.get("source_ref", ""),
            "text": chunk.get("text", "")[:200],
        })
    for i, doc in enumerate(extracted_docs, start=1):
        citations.append({
            "ref": f"D{i}",
            "source_type": doc.get("doc_type", "document"),
            "openemr_doc_id": doc.get("openemr_doc_id"),
            "extracted_results": _doc_extracted_results(doc),
        })
    for line in patient_context.splitlines():
        m = _PATIENT_CONTEXT_LINE_RE.match(line)
        if not m:
            continue
        citations.append({
            "ref": f"P{m.group(1)}",
            "source_type": "ehr_record",
            "text": m.group(2),
        })
    return citations


def _build_provenance_summary(
    guideline_chunks: list[dict[str, Any]],
    extracted_docs: list[dict[str, Any]],
    has_patient_context: bool,
) -> str:
    """One-line natural-language summary of what the agent looked at.

    Renders above the answer so the physician knows the corpus the agent
    drew from before deciding whether to trust it.
    """
    parts: list[str] = []

    if extracted_docs:
        by_type: dict[str, int] = {}
        for doc in extracted_docs:
            t = doc.get("doc_type", "document")
            by_type[t] = by_type.get(t, 0) + 1
        labels = {"lab_pdf": "uploaded lab", "intake_form": "intake form"}
        for t, n in by_type.items():
            label = labels.get(t, "document")
            parts.append(f"{n} {label}{'s' if n > 1 else ''}")

    if guideline_chunks:
        family_counts: dict[str, int] = {}
        for chunk in guideline_chunks:
            m = _GUIDELINE_FAMILY_RE.search(chunk.get("source_ref") or "")
            family = m.group(1) if m else "guideline"
            family_counts[family] = family_counts.get(family, 0) + 1
        total = sum(family_counts.values())
        breakdown = ", ".join(f"{n} {fam}" for fam, n in family_counts.items())
        parts.append(f"{total} guideline section{'s' if total > 1 else ''} ({breakdown})")

    if has_patient_context:
        parts.append("patient's chart")

    if not parts:
        return "Answered without external sources."
    if len(parts) == 1:
        return f"Reviewed: {parts[0]}."
    return "Reviewed: " + " · ".join(parts) + "."
