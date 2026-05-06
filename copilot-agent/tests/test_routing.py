"""Tests for agent.nodes.route_from_supervisor — the conditional edge."""
from __future__ import annotations

from agent.nodes import route_from_supervisor


def _state_with_decision(intent: list[str], next_workers: list[str]) -> dict:
    """Build a minimal state dict carrying just the supervisor decision."""
    return {
        "_supervisor_decision": {"intent": intent, "next_workers": next_workers}
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
    state = _state_with_decision(
        intent=["needs_extraction", "needs_evidence"],
        next_workers=["intake_extractor", "evidence_retriever"],
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
