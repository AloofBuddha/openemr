from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from .citation import SourceCitation


class LabResult(BaseModel):
    """A single parsed lab test result with provenance."""

    test_name: str
    value: str
    unit: str | None = None
    reference_range: str | None = None
    collection_date: str | None = None     # ISO 8601 or null
    abnormal_flag: Literal["H", "L", "C", "N"] | None = None
    confidence: float = Field(ge=0.0, le=1.0, default=1.0)
    source_citation: SourceCitation


class LabExtraction(BaseModel):
    """All lab results parsed from a single lab-report PDF."""

    doc_type: Literal["lab_pdf"]
    patient_id: int
    openemr_doc_id: int
    results: list[LabResult]
    extraction_warnings: list[str] = []
