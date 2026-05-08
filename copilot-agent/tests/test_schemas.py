"""Tests for the wire-format schemas in copilot-agent/schemas/.

These tests protect the contract between Python sidecar and PHP module:
any breaking change to a field name, type, or validation rule will fail
here before it reaches the cache or the UI.

Categories:
    - round_trip: dump -> reload -> equal
    - validation: invalid values are rejected
    - discriminator: doc_type literal binds to the right model
"""
from __future__ import annotations

import pytest
from pydantic import ValidationError

from schemas.citation import BBox, SourceCitation
from schemas.intake import (
    AllergyEntry,
    Demographics,
    IntakeExtraction,
    MedicationEntry,
)
from schemas.lab import LabExtraction, LabResult


# ---------------------------------------------------------------------------
# Fixtures: minimal valid instances
# ---------------------------------------------------------------------------


def make_citation(**overrides: object) -> SourceCitation:
    defaults = {
        "source_type": "lab_pdf",
        "source_id": "abc123",
        "page_or_section": "page 1",
        "field_or_chunk_id": "result.0",
        "quote_or_value": "HbA1c 7.2%",
    }
    defaults.update(overrides)
    return SourceCitation(**defaults)  # type: ignore[arg-type]


def make_lab_result(**overrides: object) -> LabResult:
    defaults = {
        "test_name": "HbA1c",
        "value": "7.2",
        "unit": "%",
        "reference_range": "<5.7",
        "abnormal_flag": "H",
        "confidence": 0.95,
        "source_citation": make_citation(),
    }
    defaults.update(overrides)
    return LabResult(**defaults)  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# Round-trip
# ---------------------------------------------------------------------------


def test_lab_extraction_roundtrip() -> None:
    """Dumping to dict and re-parsing must produce an identical model."""
    original = LabExtraction(
        doc_type="lab_pdf",
        patient_id=42,
        openemr_doc_id=1001,
        results=[make_lab_result()],
        extraction_warnings=["page 2 unreadable"],
    )
    reloaded = LabExtraction.model_validate(original.model_dump())
    assert reloaded == original


def test_intake_extraction_roundtrip() -> None:
    intake_cit = make_citation(source_type="intake_form")
    original = IntakeExtraction(
        doc_type="intake_form",
        patient_id=42,
        openemr_doc_id=1002,
        demographics=Demographics(name="Jane Doe", dob="1980-01-15"),
        chief_concern="chest pain on exertion",
        current_medications=[
            MedicationEntry(
                name="Metformin",
                dose="500mg",
                frequency="BID",
                source_citation=intake_cit,
            ),
        ],
        allergies=[
            AllergyEntry(
                allergen="penicillin",
                reaction="rash",
                source_citation=intake_cit,
            ),
        ],
        family_history=["father — MI at 55"],
        source_citation=intake_cit,
    )
    reloaded = IntakeExtraction.model_validate(original.model_dump())
    assert reloaded == original


def test_medication_entry_requires_source_citation() -> None:
    """Per-field citation is required so the eval rubric can verify provenance."""
    with pytest.raises(ValidationError):
        MedicationEntry(name="Metformin")  # type: ignore[call-arg]


def test_allergy_entry_requires_source_citation() -> None:
    with pytest.raises(ValidationError):
        AllergyEntry(allergen="penicillin")  # type: ignore[call-arg]


# ---------------------------------------------------------------------------
# Validation: invalid values are rejected
# ---------------------------------------------------------------------------


def test_lab_result_rejects_confidence_above_one() -> None:
    """confidence is bounded to [0, 1]; 1.5 must raise."""
    with pytest.raises(ValidationError):
        make_lab_result(confidence=1.5)


def test_lab_result_rejects_confidence_below_zero() -> None:
    with pytest.raises(ValidationError):
        make_lab_result(confidence=-0.1)


def test_lab_result_rejects_unknown_abnormal_flag() -> None:
    """abnormal_flag is Literal['H','L','C','N']; 'X' must raise."""
    with pytest.raises(ValidationError):
        make_lab_result(abnormal_flag="X")


def test_lab_result_requires_source_citation() -> None:
    """A LabResult without provenance is meaningless — must raise."""
    with pytest.raises(ValidationError):
        LabResult(test_name="HbA1c", value="7.2")  # type: ignore[call-arg]


def test_citation_rejects_unknown_source_type() -> None:
    with pytest.raises(ValidationError):
        make_citation(source_type="ehr_field")  # not in the Literal set


def test_medication_entry_requires_name() -> None:
    with pytest.raises(ValidationError):
        MedicationEntry()  # type: ignore[call-arg]


def test_allergy_entry_requires_allergen() -> None:
    with pytest.raises(ValidationError):
        AllergyEntry()  # type: ignore[call-arg]


# ---------------------------------------------------------------------------
# doc_type discriminator
# ---------------------------------------------------------------------------


def test_lab_extraction_rejects_intake_doc_type() -> None:
    """The Literal['lab_pdf'] on LabExtraction must reject 'intake_form'."""
    with pytest.raises(ValidationError):
        LabExtraction(
            doc_type="intake_form",  # type: ignore[arg-type]
            patient_id=1,
            openemr_doc_id=1,
            results=[],
        )


def test_intake_extraction_rejects_lab_doc_type() -> None:
    with pytest.raises(ValidationError):
        IntakeExtraction(
            doc_type="lab_pdf",  # type: ignore[arg-type]
            patient_id=1,
            openemr_doc_id=1,
            source_citation=make_citation(source_type="intake_form"),
        )


# ---------------------------------------------------------------------------
# BBox: schema + serialization for the citation-overlay feature
# ---------------------------------------------------------------------------


def test_bbox_roundtrip_inside_citation() -> None:
    bbox = BBox(
        page=1,
        x0=100.0, y0=200.0, x1=300.0, y1=240.0,
        page_width=612.0, page_height=792.0,
    )
    cit = make_citation(bbox=bbox)
    reloaded = SourceCitation.model_validate(cit.model_dump())
    assert reloaded.bbox == bbox
    assert reloaded.bbox is not None
    assert reloaded.bbox.page == 1


def test_bbox_optional_on_citation() -> None:
    """A citation without bbox is still valid (text path may not locate value)."""
    cit = make_citation(bbox=None)
    assert cit.bbox is None


# ---------------------------------------------------------------------------
# PRD field-coverage check: assert every required field exists on the schema
# ---------------------------------------------------------------------------


def test_lab_result_has_all_prd_required_fields() -> None:
    """PRD §2: lab fields include test name, value, unit, reference range,
    collection date, abnormal flag, source citation. Guards against
    accidental rename/removal in a future refactor."""
    required = {"test_name", "value", "unit", "reference_range",
                "collection_date", "abnormal_flag", "source_citation"}
    fields = set(LabResult.model_fields.keys())
    missing = required - fields
    assert not missing, f"LabResult missing PRD-required fields: {missing}"


def test_intake_extraction_has_all_prd_required_fields() -> None:
    """PRD §2: intake fields include demographics, chief concern, current
    medications, allergies, family history, source citation."""
    required = {"demographics", "chief_concern", "current_medications",
                "allergies", "family_history", "source_citation"}
    fields = set(IntakeExtraction.model_fields.keys())
    missing = required - fields
    assert not missing, f"IntakeExtraction missing PRD-required fields: {missing}"


def test_source_citation_matches_prd_contract() -> None:
    """PRD §5: citation shape must include source_type, source_id,
    page_or_section, field_or_chunk_id, quote_or_value."""
    required = {"source_type", "source_id", "page_or_section",
                "field_or_chunk_id", "quote_or_value"}
    fields = set(SourceCitation.model_fields.keys())
    missing = required - fields
    assert not missing, f"SourceCitation missing PRD-required fields: {missing}"
