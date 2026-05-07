"""Tests for agent.prompt_helpers — formatters that feed the answer prompt."""
from __future__ import annotations

from agent.prompt_helpers import format_guideline_sources, summarise_extracted_docs


# ---------------------------------------------------------------------------
# format_guideline_sources
# ---------------------------------------------------------------------------


def test_format_guideline_sources_empty_returns_empty_string() -> None:
    assert format_guideline_sources([]) == ""


def test_format_guideline_sources_numbers_each_chunk() -> None:
    chunks = [
        {"source_ref": "[ADA 2025]", "text": "Target HbA1c < 7%"},
        {"source_ref": "[ACC/AHA 2023]", "text": "BP < 130/80"},
    ]
    out = format_guideline_sources(chunks)
    assert "[G1] [ADA 2025]" in out
    assert "[G2] [ACC/AHA 2023]" in out


def test_format_guideline_sources_strips_source_ref_from_body() -> None:
    """If the chunk text starts with the source_ref line, drop it from the body."""
    chunks = [{"source_ref": "[ADA]", "text": "[ADA]\nTarget HbA1c < 7%"}]
    out = format_guideline_sources(chunks)
    # Body should not duplicate the source_ref
    body_part = out.split(": ", 1)[1]
    assert "[ADA]" not in body_part


def test_format_guideline_sources_truncates_long_text() -> None:
    long_text = "x" * 500
    chunks = [{"source_ref": "[X]", "text": long_text}]
    out = format_guideline_sources(chunks)
    assert "..." in out
    # Quoted body is at most ~300 chars (truncate constant + ellipsis)
    assert len(out) < 350


# ---------------------------------------------------------------------------
# summarise_extracted_docs
# ---------------------------------------------------------------------------


def test_summarise_extracted_docs_empty_returns_placeholder() -> None:
    assert summarise_extracted_docs([]) == "No documents have been extracted yet."


def test_summarise_extracted_docs_lab_lists_results_with_indexed_ref() -> None:
    docs = [{
        "doc_type": "lab_pdf",
        "openemr_doc_id": 42,
        "results": [
            {"test_name": "HbA1c", "value": "7.2", "unit": "%",
             "reference_range": "<5.7", "abnormal_flag": "H"},
        ],
    }]
    out = summarise_extracted_docs(docs)
    assert "[[D1]] Lab Report (doc_id=42)" in out
    assert "HbA1c" in out and "7.2" in out and "H" in out


def test_summarise_extracted_docs_intake_lists_meds_and_allergies() -> None:
    docs = [{
        "doc_type": "intake_form",
        "openemr_doc_id": 99,
        "chief_concern": "fatigue",
        "current_medications": [
            {"name": "Metformin", "dose": "500mg", "frequency": "BID"},
        ],
        "allergies": [{"allergen": "penicillin", "reaction": "rash"}],
    }]
    out = summarise_extracted_docs(docs)
    assert "[[D1]] Intake Form (doc_id=99)" in out
    assert "fatigue" in out
    assert "Metformin" in out
    assert "penicillin" in out and "rash" in out


def test_summarise_extracted_docs_handles_unknown_doc_type() -> None:
    """Unknown doc_type still gets a [[DN]] entry so the prompt isn't malformed."""
    docs = [{"doc_type": "weird", "openemr_doc_id": 5}]
    out = summarise_extracted_docs(docs)
    assert "[[D1]]" in out and "doc_id=5" in out
