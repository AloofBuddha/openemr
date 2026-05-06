from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from .citation import SourceCitation


class Demographics(BaseModel):
    """Patient demographic fields parsed from an intake form."""

    name: str | None = None
    dob: str | None = None
    sex: str | None = None
    address: str | None = None
    phone: str | None = None


class MedicationEntry(BaseModel):
    """A single medication entry from the intake form med list."""

    name: str
    dose: str | None = None
    frequency: str | None = None
    confidence: float = Field(ge=0.0, le=1.0, default=1.0)
    source_citation: SourceCitation


class AllergyEntry(BaseModel):
    """A single allergy entry from the intake form."""

    allergen: str
    reaction: str | None = None
    confidence: float = Field(ge=0.0, le=1.0, default=1.0)
    source_citation: SourceCitation


class IntakeExtraction(BaseModel):
    """All structured data parsed from a patient intake form PDF.

    Per-entry citations live on each MedicationEntry / AllergyEntry. The
    document-level ``source_citation`` covers the form as a whole — used as
    a fallback for fields without their own citation (demographics,
    chief_concern, family_history).
    """

    doc_type: Literal["intake_form"]
    patient_id: int
    openemr_doc_id: int
    demographics: Demographics | None = None
    chief_concern: str | None = None
    current_medications: list[MedicationEntry] = []
    allergies: list[AllergyEntry] = []
    family_history: list[str] = []
    source_citation: SourceCitation
    extraction_warnings: list[str] = []
