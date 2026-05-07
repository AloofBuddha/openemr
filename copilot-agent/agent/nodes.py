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
    make_supervisor_decision,
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
in citation markers. No clinical fact may appear without one.
- Patient record facts → [[PN]]the exact phrase[[/PN]]
  where N matches the line number in PATIENT CONTEXT (line [3] → [[P3]]...[[/P3]])
- Guideline evidence → [[GN]]the exact phrase[[/GN]]
  where N is the guideline number (e.g. [[G1]]...[[/G1]])

Example of correct output:
"The patient is taking [[P4]]Metformin 500mg[[/P4]] for [[P2]]Type 2 Diabetes[[/P2]].
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

    if iteration >= MAX_ITERATIONS:
        logger.warning("Max iterations reached; forcing answer_assembler")
        decision = SupervisorDecision(
            intent=["can_answer"],
            reasoning="Max iterations reached",
            next_workers=["answer_assembler"],
        )
    else:
        decision = await make_supervisor_decision(state, deps.anthropic_client)

    routing_log = list(state.get("routing_log", []))
    routing_log.append({
        "node": "supervisor",
        "decision": {
            "intent": decision.intent,
            "next_workers": decision.next_workers,
            "reasoning": decision.reasoning,
        },
        "duration_ms": int((time.monotonic() - t0) * 1000),
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

    try:
        message = await deps.anthropic_client.messages.create(
            model=SONNET,
            max_tokens=2400,
            messages=[{"role": "user", "content": prompt}],
        )
        answer = message.content[0].text  # type: ignore[union-attr]
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
        suggestions = _DEFAULT_SUGGESTIONS

    routing_log = list(state.get("routing_log", []))
    routing_log.append({
        "node": "answer_assembler",
        "decision": {"answer_length": len(answer)},
        "duration_ms": int((time.monotonic() - t0) * 1000),
    })

    return {
        "answer": answer,
        "citations": _build_citations(guideline_chunks, extracted_docs),
        "suggestions": suggestions,
        "routing_log": routing_log,
    }


_DEFAULT_SUGGESTIONS = [
    "What is the most pressing item for today's visit?",
    "Are there any pending follow-ups from prior visits?",
    "What do guidelines say about this patient's conditions?",
]


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


def _build_citations(
    guideline_chunks: list[dict[str, Any]],
    extracted_docs: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Produce the citation list surfaced to PHP/UI: one per guideline chunk + one per doc."""
    citations: list[dict[str, Any]] = []
    for i, chunk in enumerate(guideline_chunks, start=1):
        citations.append({
            "ref": f"G{i}",
            "source_ref": chunk.get("source_ref", ""),
            "text": chunk.get("text", "")[:200],
        })
    for i, doc in enumerate(extracted_docs, start=1):
        citations.append({
            "ref": f"P{i}",
            "source_type": doc.get("doc_type", "document"),
            "openemr_doc_id": doc.get("openemr_doc_id"),
        })
    return citations
