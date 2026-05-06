"""Intake-form extraction — text path and vision path.

Each :class:`MedicationEntry` and :class:`AllergyEntry` carries its own
:class:`SourceCitation`. Claude is asked to emit a ``source_quote`` per
entry; if it omits one we synthesise the citation from context (the entry
name and the page label).
"""
from __future__ import annotations

import logging
from typing import Any

import anthropic

from agent.extractor.claude_calls import (
    call_claude_text,
    call_claude_vision,
    parse_json_response,
)
from agent.extractor.confidence import threshold_warnings_intake
from agent.extractor.pdf_utils import pdf_to_b64_images
from agent.extractor.prompts import INTAKE_TEXT_PROMPT, INTAKE_VISION_PROMPT
from schemas.citation import SourceCitation
from schemas.intake import (
    AllergyEntry,
    Demographics,
    IntakeExtraction,
    MedicationEntry,
    SocialHistory,
    Vitals,
)

logger = logging.getLogger(__name__)


def _entry_citation(
    raw: dict[str, Any],
    openemr_doc_id: int,
    page_label: str,
    field_id: str,
    fallback_quote: str,
) -> SourceCitation:
    """Build a SourceCitation for one medication/allergy entry.

    Uses Claude's ``source_quote`` if provided, otherwise falls back to the
    entry's own name/allergen as the quote.
    """
    quote = str(raw.get("source_quote") or fallback_quote)
    return SourceCitation(
        source_type="intake_form",
        source_id=str(openemr_doc_id),
        page_or_section=page_label,
        field_or_chunk_id=field_id,
        quote_or_value=quote,
    )


def _build_medications(
    raw_meds: list[dict[str, Any]],
    openemr_doc_id: int,
    page_label: str,
) -> list[MedicationEntry]:
    return [
        MedicationEntry(
            name=m["name"],
            dose=m.get("dose"),
            frequency=m.get("frequency"),
            confidence=float(m.get("confidence", 1.0)),
            source_citation=_entry_citation(
                m, openemr_doc_id, page_label, f"medication.{i}", fallback_quote=m["name"]
            ),
        )
        for i, m in enumerate(raw_meds)
        if m.get("name")
    ]


def _build_allergies(
    raw_allergies: list[dict[str, Any]],
    openemr_doc_id: int,
    page_label: str,
) -> list[AllergyEntry]:
    return [
        AllergyEntry(
            allergen=a["allergen"],
            reaction=a.get("reaction"),
            confidence=float(a.get("confidence", 1.0)),
            source_citation=_entry_citation(
                a, openemr_doc_id, page_label, f"allergy.{i}", fallback_quote=a["allergen"]
            ),
        )
        for i, a in enumerate(raw_allergies)
        if a.get("allergen")
    ]


def _build_demographics(demo_data: dict[str, Any]) -> Demographics:
    return Demographics(
        name=demo_data.get("name"),
        dob=demo_data.get("dob"),
        sex=demo_data.get("sex"),
        address=demo_data.get("address"),
        phone=demo_data.get("phone"),
    )


def _build_social_history(raw: dict[str, Any] | None) -> SocialHistory | None:
    if not raw:
        return None
    s = SocialHistory(
        tobacco=raw.get("tobacco"),
        alcohol=raw.get("alcohol"),
        exercise=raw.get("exercise"),
        occupation=raw.get("occupation"),
    )
    if all(v is None for v in s.model_dump().values()):
        return None
    return s


def _build_vitals(vitals_data: dict[str, Any] | None) -> Vitals | None:
    if not vitals_data:
        return None
    v = Vitals(
        blood_pressure=vitals_data.get("blood_pressure"),
        heart_rate=vitals_data.get("heart_rate"),
        weight=vitals_data.get("weight"),
        height=vitals_data.get("height"),
        bmi=vitals_data.get("bmi"),
        temperature=vitals_data.get("temperature"),
        oxygen_saturation=vitals_data.get("oxygen_saturation"),
    )
    # Return None if all fields are empty (form had no vitals section)
    if all(val is None for val in v.model_dump().values()):
        return None
    return v


def _doc_level_citation(openemr_doc_id: int, page_label: str, quote: str) -> SourceCitation:
    return SourceCitation(
        source_type="intake_form",
        source_id=str(openemr_doc_id),
        page_or_section=page_label,
        field_or_chunk_id="intake_form",
        quote_or_value=quote,
    )


async def extract_intake_text(
    text: str,
    patient_id: int,
    openemr_doc_id: int,
    anthropic_client: anthropic.AsyncAnthropic,
) -> IntakeExtraction:
    raw = await call_claude_text(INTAKE_TEXT_PROMPT.format(text=text), anthropic_client)
    data = parse_json_response(raw)

    threshold_warns = threshold_warnings_intake(data)
    warnings = list(data.get("extraction_warnings", [])) + threshold_warns

    page_label = "text extraction"
    return IntakeExtraction(
        doc_type="intake_form",
        patient_id=patient_id,
        openemr_doc_id=openemr_doc_id,
        demographics=_build_demographics(data.get("demographics") or {}),
        chief_concern=data.get("chief_concern"),
        current_medications=_build_medications(
            data.get("current_medications", []), openemr_doc_id, page_label
        ),
        allergies=_build_allergies(data.get("allergies", []), openemr_doc_id, page_label),
        vitals=_build_vitals(data.get("vitals")),
        past_medical_history=data.get("past_medical_history", []),
        surgical_history=data.get("surgical_history", []),
        social_history=_build_social_history(data.get("social_history")),
        family_history=data.get("family_history", []),
        source_citation=_doc_level_citation(openemr_doc_id, page_label, text[:200]),
        extraction_warnings=warnings,
    )


async def extract_intake_vision_pages(
    page_images: list[tuple[str, int]],
    patient_id: int,
    openemr_doc_id: int,
    anthropic_client: anthropic.AsyncAnthropic,
) -> IntakeExtraction:
    fallback_quote = ""
    if not page_images:
        return IntakeExtraction(
            doc_type="intake_form",
            patient_id=patient_id,
            openemr_doc_id=openemr_doc_id,
            source_citation=_doc_level_citation(
                openemr_doc_id, "vision extraction", fallback_quote
            ),
            extraction_warnings=["Vision path: could not render PDF pages to images"],
        )

    # Merge across pages: first non-null wins for scalars; lists are extended.
    merged: dict[str, Any] = {
        "current_medications": [],
        "allergies": [],
        "past_medical_history": [],
        "surgical_history": [],
        "family_history": [],
        "vitals": {},
        "social_history": {},
    }
    all_warnings: list[str] = []

    for b64_image, page_num in page_images:
        try:
            raw = await call_claude_vision(INTAKE_VISION_PROMPT, b64_image, anthropic_client)
            data = parse_json_response(raw)

            threshold_warns = threshold_warnings_intake(data)
            all_warnings.extend(data.get("extraction_warnings", []))
            all_warnings.extend(threshold_warns)

            if not merged.get("demographics") and data.get("demographics"):
                merged["demographics"] = data["demographics"]
            if not merged.get("chief_concern") and data.get("chief_concern"):
                merged["chief_concern"] = data["chief_concern"]
            merged["current_medications"].extend(data.get("current_medications", []))
            merged["allergies"].extend(data.get("allergies", []))
            merged["past_medical_history"].extend(data.get("past_medical_history", []))
            merged["surgical_history"].extend(data.get("surgical_history", []))
            merged["family_history"].extend(data.get("family_history", []))
            # Merge vitals and social history: first non-null value per field wins
            for vk, vv in (data.get("vitals") or {}).items():
                if vv and not merged["vitals"].get(vk):
                    merged["vitals"][vk] = vv
            for sk, sv in (data.get("social_history") or {}).items():
                if sv and not merged["social_history"].get(sk):
                    merged["social_history"][sk] = sv
        except Exception:
            logger.exception("Vision intake extraction failed for page %d", page_num)
            all_warnings.append(f"Vision extraction failed for page {page_num}")

    page_label = f"page 1 of {len(page_images)}"
    return IntakeExtraction(
        doc_type="intake_form",
        patient_id=patient_id,
        openemr_doc_id=openemr_doc_id,
        demographics=_build_demographics(merged.get("demographics") or {}),
        chief_concern=merged.get("chief_concern"),
        current_medications=_build_medications(
            merged["current_medications"], openemr_doc_id, page_label
        ),
        allergies=_build_allergies(merged["allergies"], openemr_doc_id, page_label),
        vitals=_build_vitals(merged.get("vitals")),
        past_medical_history=merged["past_medical_history"],
        surgical_history=merged["surgical_history"],
        social_history=_build_social_history(merged.get("social_history")),
        family_history=merged["family_history"],
        source_citation=_doc_level_citation(openemr_doc_id, page_label, fallback_quote),
        extraction_warnings=all_warnings,
    )


async def extract_intake_vision(
    pdf_bytes: bytes,
    patient_id: int,
    openemr_doc_id: int,
    anthropic_client: anthropic.AsyncAnthropic,
) -> IntakeExtraction:
    return await extract_intake_vision_pages(
        pdf_to_b64_images(pdf_bytes), patient_id, openemr_doc_id, anthropic_client
    )
