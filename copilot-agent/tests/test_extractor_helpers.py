"""Tests for extractor utility helpers: JSON parsing + confidence thresholds."""
from __future__ import annotations

import json

import pytest

from agent.extractor.claude_calls import parse_json_response
from agent.extractor.confidence import (
    CONFIDENCE_THRESHOLD,
    threshold_warnings_intake,
    threshold_warnings_lab,
)


# ---------------------------------------------------------------------------
# parse_json_response
# ---------------------------------------------------------------------------


def test_parse_json_response_handles_bare_json() -> None:
    assert parse_json_response('{"a": 1}') == {"a": 1}


def test_parse_json_response_strips_json_fence() -> None:
    raw = '```json\n{"a": 1}\n```'
    assert parse_json_response(raw) == {"a": 1}


def test_parse_json_response_strips_bare_fence() -> None:
    """Some Claude replies omit the language tag after the opening backticks."""
    raw = '```\n{"a": 1}\n```'
    assert parse_json_response(raw) == {"a": 1}


def test_parse_json_response_raises_on_malformed_json() -> None:
    with pytest.raises(json.JSONDecodeError):
        parse_json_response("not actually json")


# ---------------------------------------------------------------------------
# threshold_warnings_lab
# ---------------------------------------------------------------------------


def test_threshold_warnings_lab_passes_high_confidence_unchanged() -> None:
    results = [{"test_name": "Glucose", "value": "120", "confidence": 0.95}]
    cleaned, warnings = threshold_warnings_lab(results)
    assert cleaned[0]["value"] == "120"
    assert warnings == []


def test_threshold_warnings_lab_nulls_value_below_threshold() -> None:
    """A low-confidence result keeps its name but loses its (uncertain) value."""
    low = max(0.0, CONFIDENCE_THRESHOLD - 0.1)
    results = [{"test_name": "Glucose", "value": "120", "confidence": low}]
    cleaned, warnings = threshold_warnings_lab(results)
    assert cleaned[0]["value"] is None
    assert cleaned[0]["test_name"] == "Glucose"
    assert len(warnings) == 1
    assert "Glucose" in warnings[0]


def test_threshold_warnings_lab_does_not_mutate_input() -> None:
    """The cleaning step copies dicts before nulling — caller's data stays intact."""
    low = max(0.0, CONFIDENCE_THRESHOLD - 0.1)
    original = [{"test_name": "Glucose", "value": "120", "confidence": low}]
    threshold_warnings_lab(original)
    assert original[0]["value"] == "120"


# ---------------------------------------------------------------------------
# threshold_warnings_intake
# ---------------------------------------------------------------------------


def test_threshold_warnings_intake_nulls_low_confidence_med_details() -> None:
    """Low-confidence medication: keep the name, null out dose/frequency."""
    low = max(0.0, CONFIDENCE_THRESHOLD - 0.1)
    data = {
        "current_medications": [
            {"name": "Metformin", "dose": "500mg", "frequency": "BID", "confidence": low},
        ],
    }
    warnings = threshold_warnings_intake(data)
    med = data["current_medications"][0]
    assert med["name"] == "Metformin"
    assert med["dose"] is None
    assert med["frequency"] is None
    assert any("Metformin" in w for w in warnings)


def test_threshold_warnings_intake_keeps_high_confidence_data() -> None:
    data = {
        "current_medications": [
            {"name": "Metformin", "dose": "500mg", "frequency": "BID", "confidence": 0.95},
        ],
        "allergies": [
            {"allergen": "penicillin", "reaction": "rash", "confidence": 0.95},
        ],
    }
    warnings = threshold_warnings_intake(data)
    assert warnings == []
    assert data["current_medications"][0]["dose"] == "500mg"
    assert data["allergies"][0]["reaction"] == "rash"
