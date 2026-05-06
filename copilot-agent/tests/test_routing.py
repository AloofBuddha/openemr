"""Tests for agent.nodes.route_from_supervisor — the conditional edge."""
from __future__ import annotations

from agent.nodes import route_from_supervisor


def _state_with_decision(
    intent: list[str],
    next_workers: list[str],
    *,
    extracted_docs: list[dict] | None = None,
    doc_ids: list[int] | None = None,
    guideline_chunks: list[dict] | None = None,
) -> dict:
    """Build a minimal state dict carrying the supervisor decision and progress fields."""
    return {
        "_supervisor_decision": {"intent": intent, "next_workers": next_workers},
        "extracted_docs": extracted_docs or [],
        "doc_ids": doc_ids or [],
        "guideline_chunks": guideline_chunks or [],
    }


def test_route_picks_first_valid_worker() -> None:
    state = _state_with_decision(
        intent=["needs_evidence"], next_workers=["evidence_retriever"]
    )
    assert route_from_supervisor(state) == "evidence_retriever"


def test_route_skips_unknown_workers_and_falls_through() -> None:
    """Unknown worker names are filtered; falls back to answer_assembler."""
    state = _state_with_decision(
        intent=["can_answer"], next_workers=["mystery_worker"]
    )
    assert route_from_supervisor(state) == "answer_assembler"


def test_route_returns_first_valid_when_multiple_candidates() -> None:
    """With pending extraction, the first valid worker is intake_extractor."""
    state = _state_with_decision(
        intent=["needs_extraction", "needs_evidence"],
        next_workers=["intake_extractor", "evidence_retriever"],
        doc_ids=[1],  # one doc pending extraction
        extracted_docs=[],
    )
    assert route_from_supervisor(state) == "intake_extractor"


def test_route_out_of_scope_short_circuits_to_answer() -> None:
    """Even with workers queued, an out_of_scope intent terminates immediately."""
    state = _state_with_decision(
        intent=["out_of_scope"], next_workers=["evidence_retriever"]
    )
    assert route_from_supervisor(state) == "answer_assembler"


def test_route_empty_decision_falls_through_to_answer() -> None:
    """Missing/empty supervisor decision must not crash — go straight to answer."""
    assert route_from_supervisor({}) == "answer_assembler"


def test_route_skips_extractor_when_already_extracted() -> None:
    """If all uploaded docs are already extracted, skip intake_extractor.

    Without this guard, Haiku occasionally re-requests extraction on every
    iteration and the graph never advances to evidence retrieval.
    """
    state = _state_with_decision(
        intent=["needs_extraction", "needs_evidence"],
        next_workers=["intake_extractor", "evidence_retriever"],
        extracted_docs=[{"openemr_doc_id": 36}],
        doc_ids=[36],
    )
    assert route_from_supervisor(state) == "evidence_retriever"


def test_route_skips_retriever_when_chunks_already_present() -> None:
    state = _state_with_decision(
        intent=["needs_evidence", "can_answer"],
        next_workers=["evidence_retriever", "answer_assembler"],
        guideline_chunks=[{"chunk_id": "abc", "text": "..."}],
    )
    assert route_from_supervisor(state) == "answer_assembler"


def test_route_falls_through_to_answer_when_all_work_done() -> None:
    """Both workers requested but both are already complete — go to assembler."""
    state = _state_with_decision(
        intent=["needs_extraction", "needs_evidence", "can_answer"],
        next_workers=["intake_extractor", "evidence_retriever"],
        extracted_docs=[{"openemr_doc_id": 36}],
        doc_ids=[36],
        guideline_chunks=[{"chunk_id": "abc"}],
    )
    assert route_from_supervisor(state) == "answer_assembler"
