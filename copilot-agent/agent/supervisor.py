from __future__ import annotations

import json
import logging
import time
from typing import Literal, TypedDict

import anthropic
from pydantic import BaseModel

logger = logging.getLogger(__name__)

_HAIKU = "claude-haiku-4-5-20251001"


# ---------------------------------------------------------------------------
# State definition
# ---------------------------------------------------------------------------


class AgentState(TypedDict):
    query: str
    patient_id: int
    doc_ids: list[int]             # openemr_doc_ids of uploaded docs
    extracted_docs: list[dict]     # results from intake_extractor
    guideline_chunks: list[dict]   # results from evidence_retriever
    patient_context: str           # pre-built patient record context (from PHP)
    answer: str
    citations: list[dict]
    provenance: str                # one-line natural-language summary of sources used
    suggestions: list[str]
    routing_log: list[dict]        # each: {node, decision, duration_ms}
    iteration: int
    _supervisor_decision: dict     # persisted so the conditional edge can read it


# ---------------------------------------------------------------------------
# Supervisor decision
# ---------------------------------------------------------------------------


class SupervisorDecision(BaseModel):
    intent: list[Literal["needs_extraction", "needs_evidence", "can_answer", "out_of_scope"]]
    reasoning: str
    next_workers: list[str]


# Per-million-token prices (USD). Update if Anthropic pricing changes.
# Source: https://www.anthropic.com/pricing — current as of model release.
_PRICING = {
    "claude-haiku-4-5-20251001": (1.00, 5.00),
    "claude-sonnet-4-6":         (3.00, 15.00),
}


def _estimate_cost(model: str, in_tok: int, out_tok: int) -> float:
    in_per_m, out_per_m = _PRICING.get(model, (0.0, 0.0))
    return round(in_tok * in_per_m / 1_000_000 + out_tok * out_per_m / 1_000_000, 6)


_SUPERVISOR_PROMPT = """\
You are a clinical co-pilot routing agent. Given the query and the current state, classify the intent and decide which workers to call next.

Query: {query}

State summary:
- Uploaded doc IDs available for extraction: {doc_ids}
- Docs already extracted: {num_extracted}
- Guideline chunks already retrieved: {num_chunks}
- Iteration: {iteration}

Workers available:
- "intake_extractor": extracts structured data from uploaded documents (use when doc_ids exist and extraction hasn't been done)
- "evidence_retriever": retrieves clinical guideline evidence (use when the query asks about treatment, targets, or recommendations)
- "answer_assembler": composes the final answer (use when enough context exists or the query is simple)

Return ONLY valid JSON — no markdown, no explanation:
{{
  "intent": ["needs_extraction", "needs_evidence", "can_answer"],
  "reasoning": "one sentence",
  "next_workers": ["intake_extractor", "evidence_retriever"]
}}

Intent values (pick all that apply):
- "needs_extraction": uploaded docs exist and haven't been extracted yet
- "needs_evidence": query requires clinical guideline evidence
- "can_answer": enough context exists to compose an answer
- "out_of_scope": query is not clinical / cannot be answered from patient records

Rules:
- If out_of_scope, set next_workers to [] and can_answer to true (so we terminate gracefully)
- If iteration >= 2, always include "can_answer" and "answer_assembler" to avoid infinite loops
- next_workers drives which nodes run next; always include "answer_assembler" when "can_answer" is in intent
"""


async def make_supervisor_decision(
    state: AgentState,
    anthropic_client: anthropic.AsyncAnthropic,
) -> tuple[SupervisorDecision, dict]:
    """Return (decision, telemetry) where telemetry has tokens + cost.

    The caller (supervisor_node) folds the telemetry into routing_log so
    every encounter has tool sequence + per-step latency + token usage +
    cost estimate — the per-PRD section-7 observability requirement —
    available locally even when LangSmith is off.
    """
    prompt = _SUPERVISOR_PROMPT.format(
        query=state["query"],
        doc_ids=state.get("doc_ids", []),
        num_extracted=len(state.get("extracted_docs", [])),
        num_chunks=len(state.get("guideline_chunks", [])),
        iteration=state.get("iteration", 0),
    )

    t0 = time.monotonic()
    telemetry: dict = {"model": _HAIKU, "input_tokens": 0, "output_tokens": 0, "cost_usd": 0.0}
    try:
        message = await anthropic_client.messages.create(
            model=_HAIKU,
            max_tokens=512,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = message.content[0].text  # type: ignore[union-attr]
        duration_ms = int((time.monotonic() - t0) * 1000)

        in_tok = getattr(message.usage, "input_tokens", 0) or 0
        out_tok = getattr(message.usage, "output_tokens", 0) or 0
        telemetry = {
            "model": _HAIKU,
            "input_tokens": in_tok,
            "output_tokens": out_tok,
            "cost_usd": _estimate_cost(_HAIKU, in_tok, out_tok),
        }

        # Strip markdown fences
        text = raw.strip()
        if text.startswith("```"):
            text = text.split("\n", 1)[1] if "\n" in text else text[3:]
            if text.endswith("```"):
                text = text[:-3]

        data = json.loads(text.strip())
        decision = SupervisorDecision(**data)
        logger.info(
            "Supervisor decision (iter=%d, %dms, %d→%d tok, $%s): intent=%s next=%s",
            state.get("iteration", 0),
            duration_ms,
            in_tok, out_tok, telemetry["cost_usd"],
            decision.intent,
            decision.next_workers,
        )
        return decision, telemetry

    except Exception:
        logger.exception("Supervisor Claude call failed; defaulting to answer_assembler")
        return (
            SupervisorDecision(
                intent=["can_answer"],
                reasoning="Supervisor call failed — routing directly to answer assembler",
                next_workers=["answer_assembler"],
            ),
            telemetry,
        )
