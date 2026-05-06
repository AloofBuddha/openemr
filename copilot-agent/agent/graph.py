from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any

import anthropic
import chromadb
from langgraph.graph import END, StateGraph
from rank_bm25 import BM25Okapi

from agent.evidence_retriever import format_guideline_sources, retrieve_evidence
from agent.intake_extractor import extract_document
from agent.supervisor import AgentState, SupervisorDecision, _async_make_supervisor_decision
from rag.indexer import GuidelineChunk

logger = logging.getLogger(__name__)

MAX_ITERATIONS = 3
_SONNET = "claude-sonnet-4-6"

_ANSWER_PROMPT = """\
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
"""


# ---------------------------------------------------------------------------
# Node helpers
# ---------------------------------------------------------------------------


def _summarise_extracted_docs(extracted_docs: list[dict]) -> str:
    """Convert extracted doc dicts to a human-readable summary for the prompt."""
    if not extracted_docs:
        return "No documents have been extracted yet."

    lines: list[str] = []
    for i, doc in enumerate(extracted_docs, start=1):
        doc_type = doc.get("doc_type", "unknown")
        doc_id = doc.get("openemr_doc_id", "?")

        if doc_type == "lab_pdf":
            results = doc.get("results", [])
            result_lines = [
                f"  - {r.get('test_name', '?')}: {r.get('value', '?')} {r.get('unit', '')} "
                f"(ref: {r.get('reference_range', 'N/A')}, flag: {r.get('abnormal_flag', 'N/A')})"
                for r in results[:10]  # cap to avoid token bloat
            ]
            lines.append(f"[[P{i}]] Lab Report (doc_id={doc_id}):")
            lines.extend(result_lines)
            if len(results) > 10:
                lines.append(f"  ... and {len(results) - 10} more results")

        elif doc_type == "intake_form":
            demo = doc.get("demographics") or {}
            meds = doc.get("current_medications", [])
            allergies = doc.get("allergies", [])
            cc = doc.get("chief_concern", "not stated")
            lines.append(f"[[P{i}]] Intake Form (doc_id={doc_id}):")
            lines.append(f"  Chief concern: {cc}")
            if demo:
                lines.append(f"  Demographics: {json.dumps(demo)}")
            if meds:
                med_str = "; ".join(
                    f"{m.get('name', '?')} {m.get('dose', '')} {m.get('frequency', '')}".strip()
                    for m in meds[:8]
                )
                lines.append(f"  Medications: {med_str}")
            if allergies:
                allergy_str = "; ".join(
                    f"{a.get('allergen', '?')} ({a.get('reaction', 'reaction unknown')})"
                    for a in allergies[:8]
                )
                lines.append(f"  Allergies: {allergy_str}")
        else:
            lines.append(f"[[P{i}]] Unknown document type (doc_id={doc_id})")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Graph builder
# ---------------------------------------------------------------------------


def build_graph(
    anthropic_client: anthropic.AsyncAnthropic,
    cohere_client: Any | None,
    bm25: BM25Okapi,
    bm25_chunks: list[GuidelineChunk],
    chroma_collection: chromadb.Collection,
) -> Any:
    """Build and compile the LangGraph clinical co-pilot graph.

    Nodes:
        supervisor          — classifies intent and decides next workers
        intake_extractor    — extracts structured data from uploaded docs
        evidence_retriever  — retrieves relevant guideline chunks
        answer_assembler    — composes the final cited answer

    Routing:
        supervisor → one or more workers → back to supervisor → answer_assembler → END
    """

    workflow = StateGraph(AgentState)

    # ------------------------------------------------------------------
    # Node: supervisor
    # ------------------------------------------------------------------

    async def supervisor_node(state: AgentState) -> dict:
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
            decision = await _async_make_supervisor_decision(state, anthropic_client)

        duration_ms = int((time.monotonic() - t0) * 1000)
        log_entry = {
            "node": "supervisor",
            "decision": {
                "intent": decision.intent,
                "next_workers": decision.next_workers,
                "reasoning": decision.reasoning,
            },
            "duration_ms": duration_ms,
        }

        routing_log = list(state.get("routing_log", []))
        routing_log.append(log_entry)

        return {
            "routing_log": routing_log,
            "iteration": iteration + 1,
            # Store decision in state so the router can read it
            "_supervisor_decision": decision.model_dump(),
        }

    # ------------------------------------------------------------------
    # Node: intake_extractor
    # ------------------------------------------------------------------

    async def intake_extractor_node(state: AgentState) -> dict:
        t0 = time.monotonic()
        doc_ids: list[int] = state.get("doc_ids", [])
        already_extracted_ids = {
            d.get("openemr_doc_id") for d in state.get("extracted_docs", [])
        }
        pending_ids = [d for d in doc_ids if d not in already_extracted_ids]

        new_extractions: list[dict] = []
        warnings_added: list[str] = []

        for doc_id in pending_ids:
            # We don't have the file bytes here — the graph only processes
            # doc IDs that were already ingested via /ingest.  The extracted
            # data should have been persisted server-side. For now, we emit a
            # warning noting that the doc needs to be fetched.
            warnings_added.append(
                f"Doc {doc_id} was listed in doc_ids but no pre-extracted data was found. "
                "Upload the document via /ingest first."
            )

        duration_ms = int((time.monotonic() - t0) * 1000)
        routing_log = list(state.get("routing_log", []))
        routing_log.append({
            "node": "intake_extractor",
            "decision": {
                "pending_doc_ids": pending_ids,
                "new_extractions": len(new_extractions),
                "warnings": warnings_added,
            },
            "duration_ms": duration_ms,
        })

        extracted_docs = list(state.get("extracted_docs", [])) + new_extractions
        return {
            "extracted_docs": extracted_docs,
            "routing_log": routing_log,
        }

    # ------------------------------------------------------------------
    # Node: evidence_retriever
    # ------------------------------------------------------------------

    async def evidence_retriever_node(state: AgentState) -> dict:
        t0 = time.monotonic()
        query = state["query"]

        chunks = retrieve_evidence(
            query=query,
            bm25=bm25,
            bm25_chunks=bm25_chunks,
            chroma_collection=chroma_collection,
            cohere_client=cohere_client,
            top_k=5,
        )

        duration_ms = int((time.monotonic() - t0) * 1000)
        routing_log = list(state.get("routing_log", []))
        routing_log.append({
            "node": "evidence_retriever",
            "decision": {"chunks_retrieved": len(chunks)},
            "duration_ms": duration_ms,
        })

        return {
            "guideline_chunks": chunks,
            "routing_log": routing_log,
        }

    # ------------------------------------------------------------------
    # Node: answer_assembler
    # ------------------------------------------------------------------

    async def answer_assembler_node(state: AgentState) -> dict:
        t0 = time.monotonic()
        query = state["query"]
        patient_context = state.get("patient_context", "No patient context provided.")
        extracted_docs = state.get("extracted_docs", [])
        guideline_chunks = state.get("guideline_chunks", [])

        extracted_docs_summary = _summarise_extracted_docs(extracted_docs)
        guideline_sources = format_guideline_sources(guideline_chunks)

        prompt = _ANSWER_PROMPT.format(
            query=query,
            patient_context=patient_context,
            extracted_docs_summary=extracted_docs_summary,
            guideline_sources=guideline_sources if guideline_sources else "No guideline evidence retrieved.",
        )

        try:
            message = await anthropic_client.messages.create(
                model=_SONNET,
                max_tokens=1024,
                messages=[{"role": "user", "content": prompt}],
            )
            answer = message.content[0].text  # type: ignore[union-attr]
        except Exception:
            logger.exception("Answer assembler Claude call failed")
            answer = (
                "I was unable to generate an answer due to an internal error. "
                "Please review the patient records directly."
            )

        duration_ms = int((time.monotonic() - t0) * 1000)
        routing_log = list(state.get("routing_log", []))
        routing_log.append({
            "node": "answer_assembler",
            "decision": {"answer_length": len(answer)},
            "duration_ms": duration_ms,
        })

        # Build citation list from extracted docs and guideline chunks
        citations: list[dict] = []
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

        return {
            "answer": answer,
            "citations": citations,
            "routing_log": routing_log,
        }

    # ------------------------------------------------------------------
    # Register nodes
    # ------------------------------------------------------------------

    workflow.add_node("supervisor", supervisor_node)
    workflow.add_node("intake_extractor", intake_extractor_node)
    workflow.add_node("evidence_retriever", evidence_retriever_node)
    workflow.add_node("answer_assembler", answer_assembler_node)

    # ------------------------------------------------------------------
    # Edges: supervisor routes to workers or answer_assembler or END
    # ------------------------------------------------------------------

    def route_from_supervisor(state: AgentState) -> str:
        """Return the single next node name from the supervisor decision."""
        decision_data = state.get("_supervisor_decision", {})
        next_workers: list[str] = decision_data.get("next_workers", [])
        intent: list[str] = decision_data.get("intent", [])

        valid_nodes = {"intake_extractor", "evidence_retriever", "answer_assembler"}

        if "out_of_scope" in intent and not any(w in valid_nodes for w in next_workers):
            return "answer_assembler"

        # If docs are already extracted and evidence is still needed, skip intake_extractor
        already_extracted_ids = {d.get("openemr_doc_id") for d in state.get("extracted_docs", [])}
        doc_ids = set(state.get("doc_ids", []))
        docs_covered = doc_ids and doc_ids.issubset(already_extracted_ids)
        needs_evidence = "needs_evidence" in intent or "evidence_retriever" in next_workers
        if docs_covered and needs_evidence and not state.get("guideline_chunks"):
            return "evidence_retriever"

        for worker in next_workers:
            if worker in valid_nodes:
                return worker

        return "answer_assembler"

    workflow.set_entry_point("supervisor")

    workflow.add_conditional_edges(
        "supervisor",
        route_from_supervisor,
    )

    # After each worker, go straight to answer_assembler
    workflow.add_edge("intake_extractor", "answer_assembler")
    workflow.add_edge("evidence_retriever", "answer_assembler")

    # answer_assembler is terminal
    workflow.add_edge("answer_assembler", END)

    return workflow.compile()
