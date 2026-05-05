from __future__ import annotations

import base64
import io
import json
import logging
from typing import Any

import anthropic
import pdfplumber

from schemas.citation import SourceCitation
from schemas.intake import (
    AllergyEntry,
    Demographics,
    IntakeExtraction,
    MedicationEntry,
)
from schemas.lab import LabExtraction, LabResult

logger = logging.getLogger(__name__)

_HAIKU = "claude-haiku-4-5"
_CONFIDENCE_THRESHOLD = 0.7

# ---------------------------------------------------------------------------
# Prompt templates
# ---------------------------------------------------------------------------

_LAB_TEXT_PROMPT = """\
You are a clinical data extraction assistant. Extract all lab test results from the text below.

Return ONLY valid JSON matching this exact structure — no markdown, no explanation:
{{
  "results": [
    {{
      "test_name": "string",
      "value": "string",
      "unit": "string or null",
      "reference_range": "string or null",
      "collection_date": "YYYY-MM-DD or null",
      "abnormal_flag": "H | L | C | N | null",
      "confidence": 0.95
    }}
  ],
  "extraction_warnings": ["string"]
}}

Rules:
- confidence is a float in [0, 1] reflecting how clearly the value was printed
- abnormal_flag: H=high, L=low, C=critical, N=normal; null if not stated
- If a field is not present in the source, use null
- Add a warning string for any value that was ambiguous or partially illegible

Lab report text:
{text}
"""

_LAB_VISION_PROMPT = """\
You are a clinical data extraction assistant. Extract all lab test results visible in this image.

Return ONLY valid JSON matching this exact structure — no markdown, no explanation:
{
  "results": [
    {
      "test_name": "string",
      "value": "string",
      "unit": "string or null",
      "reference_range": "string or null",
      "collection_date": "YYYY-MM-DD or null",
      "abnormal_flag": "H | L | C | N | null",
      "confidence": 0.95
    }
  ],
  "extraction_warnings": ["string"]
}

Rules:
- confidence is a float in [0, 1] reflecting how clearly the value was printed
- abnormal_flag: H=high, L=low, C=critical, N=normal; null if not stated
- If a field is not present in the source, use null
- Add a warning string for any value that was ambiguous or partially illegible
"""

_INTAKE_TEXT_PROMPT = """\
You are a clinical data extraction assistant. Extract structured information from this patient intake form.

Return ONLY valid JSON matching this exact structure — no markdown, no explanation:
{{
  "demographics": {{
    "name": "string or null",
    "dob": "string or null",
    "sex": "string or null",
    "address": "string or null",
    "phone": "string or null"
  }},
  "chief_concern": "string or null",
  "current_medications": [
    {{"name": "string", "dose": "string or null", "frequency": "string or null", "confidence": 0.9}}
  ],
  "allergies": [
    {{"allergen": "string", "reaction": "string or null", "confidence": 0.9}}
  ],
  "family_history": ["string"],
  "extraction_warnings": ["string"]
}}

Rules:
- confidence is a float in [0, 1] for each medication/allergy entry
- Use null for any field not clearly stated in the form
- family_history is a list of plain strings (e.g. "Father: hypertension")
- Add extraction_warnings for any field that was ambiguous or illegible

Intake form text:
{text}
"""

_INTAKE_VISION_PROMPT = """\
You are a clinical data extraction assistant. Extract structured information from this patient intake form image.

Return ONLY valid JSON matching this exact structure — no markdown, no explanation:
{
  "demographics": {
    "name": "string or null",
    "dob": "string or null",
    "sex": "string or null",
    "address": "string or null",
    "phone": "string or null"
  },
  "chief_concern": "string or null",
  "current_medications": [
    {"name": "string", "dose": "string or null", "frequency": "string or null", "confidence": 0.9}
  ],
  "allergies": [
    {"allergen": "string", "reaction": "string or null", "confidence": 0.9}
  ],
  "family_history": ["string"],
  "extraction_warnings": ["string"]
}

Rules:
- confidence is a float in [0, 1] for each medication/allergy entry
- Use null for any field not clearly stated in the form
- family_history is a list of plain strings (e.g. "Father: hypertension")
- Add extraction_warnings for any field that was ambiguous or illegible
"""


# ---------------------------------------------------------------------------
# Path detection
# ---------------------------------------------------------------------------


def _pdf_text_is_usable(pdf_bytes: bytes) -> tuple[bool, str]:
    """Return (is_usable, extracted_text) for a PDF.

    A PDF is considered text-usable when pdfplumber can extract more than
    100 printable characters across all pages.
    """
    try:
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            pages_text: list[str] = []
            for page in pdf.pages:
                text = page.extract_text() or ""
                pages_text.append(text)
            combined = "\n\n".join(pages_text)
            printable = sum(1 for c in combined if c.isprintable())
            return printable > 100, combined
    except Exception:
        logger.exception("pdfplumber failed to open PDF")
        return False, ""


def _pdf_to_b64_images(pdf_bytes: bytes) -> list[tuple[str, int]]:
    """Convert each PDF page to a base64 PNG string.

    Returns a list of (b64_string, page_number) tuples (1-indexed).
    """
    results: list[tuple[str, int]] = []
    try:
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            for page_num, page in enumerate(pdf.pages, start=1):
                img = page.to_image(resolution=150)
                buf = io.BytesIO()
                img.save(buf, format="PNG")
                b64 = base64.standard_b64encode(buf.getvalue()).decode()
                results.append((b64, page_num))
    except Exception:
        logger.exception("pdfplumber failed to render PDF pages to images")
    return results


# ---------------------------------------------------------------------------
# Claude callers
# ---------------------------------------------------------------------------


async def _call_claude_text(
    prompt: str,
    anthropic_client: anthropic.AsyncAnthropic,
) -> str:
    """Send a text-only message to Claude Haiku and return the raw text reply."""
    message = await anthropic_client.messages.create(
        model=_HAIKU,
        max_tokens=2048,
        messages=[{"role": "user", "content": prompt}],
    )
    return message.content[0].text  # type: ignore[union-attr]


async def _call_claude_vision(
    prompt: str,
    b64_image: str,
    anthropic_client: anthropic.AsyncAnthropic,
) -> str:
    """Send a vision message (image + text) to Claude Haiku and return the reply."""
    message = await anthropic_client.messages.create(
        model=_HAIKU,
        max_tokens=2048,
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": "image/png",
                            "data": b64_image,
                        },
                    },
                    {"type": "text", "text": prompt},
                ],
            }
        ],
    )
    return message.content[0].text  # type: ignore[union-attr]


def _parse_json_response(raw: str) -> dict[str, Any]:
    """Strip markdown fences if present and parse JSON."""
    text = raw.strip()
    if text.startswith("```"):
        # Remove opening fence (```json or ```)
        text = text.split("\n", 1)[1] if "\n" in text else text[3:]
        # Remove closing fence
        if text.endswith("```"):
            text = text[:-3]
    return json.loads(text.strip())


# ---------------------------------------------------------------------------
# Confidence thresholding helpers
# ---------------------------------------------------------------------------


def _threshold_warnings_lab(results: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[str]]:
    warnings: list[str] = []
    cleaned: list[dict[str, Any]] = []
    for r in results:
        confidence = float(r.get("confidence", 1.0))
        if confidence < _CONFIDENCE_THRESHOLD:
            test_name = r.get("test_name", "unknown")
            warnings.append(
                f"Low confidence for field '{test_name}' (score={confidence:.2f}) — verify against source"
            )
            r = dict(r)
            r["value"] = None  # null out the uncertain value
        cleaned.append(r)
    return cleaned, warnings


def _threshold_warnings_intake(data: dict[str, Any]) -> list[str]:
    warnings: list[str] = []
    for med in data.get("current_medications", []):
        confidence = float(med.get("confidence", 1.0))
        if confidence < _CONFIDENCE_THRESHOLD:
            warnings.append(
                f"Low confidence for medication '{med.get('name', 'unknown')}' "
                f"(score={confidence:.2f}) — verify against source"
            )
            med["name"] = med.get("name")  # keep name but could null dose/freq
            med["dose"] = None
            med["frequency"] = None
    for allergy in data.get("allergies", []):
        confidence = float(allergy.get("confidence", 1.0))
        if confidence < _CONFIDENCE_THRESHOLD:
            warnings.append(
                f"Low confidence for allergy '{allergy.get('allergen', 'unknown')}' "
                f"(score={confidence:.2f}) — verify against source"
            )
            allergy["reaction"] = None
    return warnings


# ---------------------------------------------------------------------------
# Lab extraction paths
# ---------------------------------------------------------------------------


async def _extract_lab_text(
    text: str,
    patient_id: int,
    openemr_doc_id: int,
    anthropic_client: anthropic.AsyncAnthropic,
) -> LabExtraction:
    prompt = _LAB_TEXT_PROMPT.format(text=text)
    raw = await _call_claude_text(prompt, anthropic_client)
    data = _parse_json_response(raw)

    raw_results = data.get("results", [])
    raw_results, threshold_warnings = _threshold_warnings_lab(raw_results)
    extraction_warnings: list[str] = list(data.get("extraction_warnings", [])) + threshold_warnings

    results: list[LabResult] = []
    for r in raw_results:
        citation = SourceCitation(
            source_type="lab_pdf",
            source_id=str(openemr_doc_id),
            page_or_section="text extraction",
            field_or_chunk_id=r.get("test_name", "unknown"),
            quote_or_value=str(r.get("value", "")),
        )
        results.append(
            LabResult(
                test_name=r.get("test_name", ""),
                value=str(r.get("value", "")) if r.get("value") is not None else "",
                unit=r.get("unit"),
                reference_range=r.get("reference_range"),
                collection_date=r.get("collection_date"),
                abnormal_flag=r.get("abnormal_flag"),
                confidence=float(r.get("confidence", 1.0)),
                source_citation=citation,
            )
        )

    return LabExtraction(
        doc_type="lab_pdf",
        patient_id=patient_id,
        openemr_doc_id=openemr_doc_id,
        results=results,
        extraction_warnings=extraction_warnings,
    )


async def _extract_lab_vision(
    pdf_bytes: bytes,
    patient_id: int,
    openemr_doc_id: int,
    anthropic_client: anthropic.AsyncAnthropic,
) -> LabExtraction:
    page_images = _pdf_to_b64_images(pdf_bytes)
    if not page_images:
        return LabExtraction(
            doc_type="lab_pdf",
            patient_id=patient_id,
            openemr_doc_id=openemr_doc_id,
            results=[],
            extraction_warnings=["Vision path: could not render PDF pages to images"],
        )

    all_results: list[LabResult] = []
    all_warnings: list[str] = []

    for b64_image, page_num in page_images:
        try:
            raw = await _call_claude_vision(_LAB_VISION_PROMPT, b64_image, anthropic_client)
            data = _parse_json_response(raw)

            raw_results = data.get("results", [])
            raw_results, threshold_warnings = _threshold_warnings_lab(raw_results)
            all_warnings.extend(data.get("extraction_warnings", []))
            all_warnings.extend(threshold_warnings)

            for r in raw_results:
                citation = SourceCitation(
                    source_type="lab_pdf",
                    source_id=str(openemr_doc_id),
                    page_or_section=f"page {page_num}",
                    field_or_chunk_id=r.get("test_name", "unknown"),
                    quote_or_value=str(r.get("value", "")),
                )
                all_results.append(
                    LabResult(
                        test_name=r.get("test_name", ""),
                        value=str(r.get("value", "")) if r.get("value") is not None else "",
                        unit=r.get("unit"),
                        reference_range=r.get("reference_range"),
                        collection_date=r.get("collection_date"),
                        abnormal_flag=r.get("abnormal_flag"),
                        confidence=float(r.get("confidence", 1.0)),
                        source_citation=citation,
                    )
                )
        except Exception:
            logger.exception("Vision extraction failed for page %d", page_num)
            all_warnings.append(f"Vision extraction failed for page {page_num}")

    return LabExtraction(
        doc_type="lab_pdf",
        patient_id=patient_id,
        openemr_doc_id=openemr_doc_id,
        results=all_results,
        extraction_warnings=all_warnings,
    )


# ---------------------------------------------------------------------------
# Intake extraction paths
# ---------------------------------------------------------------------------


async def _extract_intake_text(
    text: str,
    patient_id: int,
    openemr_doc_id: int,
    anthropic_client: anthropic.AsyncAnthropic,
) -> IntakeExtraction:
    prompt = _INTAKE_TEXT_PROMPT.format(text=text)
    raw = await _call_claude_text(prompt, anthropic_client)
    data = _parse_json_response(raw)

    threshold_warnings = _threshold_warnings_intake(data)
    extraction_warnings: list[str] = list(data.get("extraction_warnings", [])) + threshold_warnings

    citation = SourceCitation(
        source_type="intake_form",
        source_id=str(openemr_doc_id),
        page_or_section="text extraction",
        field_or_chunk_id="intake_form",
        quote_or_value=text[:200],
    )

    demo_data = data.get("demographics") or {}
    demographics = Demographics(
        name=demo_data.get("name"),
        dob=demo_data.get("dob"),
        sex=demo_data.get("sex"),
        address=demo_data.get("address"),
        phone=demo_data.get("phone"),
    )

    medications = [
        MedicationEntry(
            name=m["name"],
            dose=m.get("dose"),
            frequency=m.get("frequency"),
            confidence=float(m.get("confidence", 1.0)),
        )
        for m in data.get("current_medications", [])
        if m.get("name")
    ]

    allergies = [
        AllergyEntry(
            allergen=a["allergen"],
            reaction=a.get("reaction"),
            confidence=float(a.get("confidence", 1.0)),
        )
        for a in data.get("allergies", [])
        if a.get("allergen")
    ]

    return IntakeExtraction(
        doc_type="intake_form",
        patient_id=patient_id,
        openemr_doc_id=openemr_doc_id,
        demographics=demographics,
        chief_concern=data.get("chief_concern"),
        current_medications=medications,
        allergies=allergies,
        family_history=data.get("family_history", []),
        source_citation=citation,
        extraction_warnings=extraction_warnings,
    )


async def _extract_intake_vision(
    pdf_bytes: bytes,
    patient_id: int,
    openemr_doc_id: int,
    anthropic_client: anthropic.AsyncAnthropic,
) -> IntakeExtraction:
    page_images = _pdf_to_b64_images(pdf_bytes)

    fallback_citation = SourceCitation(
        source_type="intake_form",
        source_id=str(openemr_doc_id),
        page_or_section="vision extraction",
        field_or_chunk_id="intake_form",
        quote_or_value="",
    )

    if not page_images:
        return IntakeExtraction(
            doc_type="intake_form",
            patient_id=patient_id,
            openemr_doc_id=openemr_doc_id,
            source_citation=fallback_citation,
            extraction_warnings=["Vision path: could not render PDF pages to images"],
        )

    # For intake forms, merge across pages — first page typically has the form
    merged_data: dict[str, Any] = {}
    all_warnings: list[str] = []

    for b64_image, page_num in page_images:
        try:
            raw = await _call_claude_vision(_INTAKE_VISION_PROMPT, b64_image, anthropic_client)
            data = _parse_json_response(raw)

            threshold_warnings = _threshold_warnings_intake(data)
            all_warnings.extend(data.get("extraction_warnings", []))
            all_warnings.extend(threshold_warnings)

            # Merge: first non-null value wins for scalars; lists are extended
            if not merged_data.get("demographics") and data.get("demographics"):
                merged_data["demographics"] = data["demographics"]
            if not merged_data.get("chief_concern") and data.get("chief_concern"):
                merged_data["chief_concern"] = data["chief_concern"]
            merged_data.setdefault("current_medications", [])
            merged_data["current_medications"].extend(data.get("current_medications", []))
            merged_data.setdefault("allergies", [])
            merged_data["allergies"].extend(data.get("allergies", []))
            merged_data.setdefault("family_history", [])
            merged_data["family_history"].extend(data.get("family_history", []))

        except Exception:
            logger.exception("Vision intake extraction failed for page %d", page_num)
            all_warnings.append(f"Vision extraction failed for page {page_num}")

    citation = SourceCitation(
        source_type="intake_form",
        source_id=str(openemr_doc_id),
        page_or_section=f"page 1 of {len(page_images)}",
        field_or_chunk_id="intake_form",
        quote_or_value="",
    )

    demo_data = merged_data.get("demographics") or {}
    demographics = Demographics(
        name=demo_data.get("name"),
        dob=demo_data.get("dob"),
        sex=demo_data.get("sex"),
        address=demo_data.get("address"),
        phone=demo_data.get("phone"),
    )

    medications = [
        MedicationEntry(
            name=m["name"],
            dose=m.get("dose"),
            frequency=m.get("frequency"),
            confidence=float(m.get("confidence", 1.0)),
        )
        for m in merged_data.get("current_medications", [])
        if m.get("name")
    ]

    allergies = [
        AllergyEntry(
            allergen=a["allergen"],
            reaction=a.get("reaction"),
            confidence=float(a.get("confidence", 1.0)),
        )
        for a in merged_data.get("allergies", [])
        if a.get("allergen")
    ]

    return IntakeExtraction(
        doc_type="intake_form",
        patient_id=patient_id,
        openemr_doc_id=openemr_doc_id,
        demographics=demographics,
        chief_concern=merged_data.get("chief_concern"),
        current_medications=medications,
        allergies=allergies,
        family_history=merged_data.get("family_history", []),
        source_citation=citation,
        extraction_warnings=all_warnings,
    )


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


async def extract_document(
    file_bytes: bytes,
    mimetype: str,
    doc_type: str,  # "lab_pdf" or "intake_form"
    patient_id: int,
    openemr_doc_id: int,
    anthropic_client: anthropic.AsyncAnthropic,
) -> LabExtraction | IntakeExtraction:
    """Extract structured data from a document (PDF or image).

    Path selection:
    - PDFs: try pdfplumber text extraction; if >100 printable chars → text path,
      else → vision path.
    - Images (PNG/JPG): always vision path.
    """
    use_vision: bool
    extracted_text: str = ""

    if mimetype == "application/pdf":
        is_usable, extracted_text = _pdf_text_is_usable(file_bytes)
        use_vision = not is_usable
    else:
        # PNG / JPEG / etc — always vision
        use_vision = True

    logger.info(
        "extract_document: doc_type=%s mimetype=%s use_vision=%s patient_id=%d doc_id=%d",
        doc_type,
        mimetype,
        use_vision,
        patient_id,
        openemr_doc_id,
    )

    if doc_type == "lab_pdf":
        if use_vision:
            if mimetype != "application/pdf":
                # Single image — encode directly
                b64 = base64.standard_b64encode(file_bytes).decode()
                raw = await _call_claude_vision(_LAB_VISION_PROMPT, b64, anthropic_client)
                data = _parse_json_response(raw)
                raw_results = data.get("results", [])
                raw_results, threshold_warnings = _threshold_warnings_lab(raw_results)
                extraction_warnings: list[str] = list(data.get("extraction_warnings", [])) + threshold_warnings
                results: list[LabResult] = []
                for r in raw_results:
                    citation = SourceCitation(
                        source_type="lab_pdf",
                        source_id=str(openemr_doc_id),
                        page_or_section="page 1",
                        field_or_chunk_id=r.get("test_name", "unknown"),
                        quote_or_value=str(r.get("value", "")),
                    )
                    results.append(
                        LabResult(
                            test_name=r.get("test_name", ""),
                            value=str(r.get("value", "")) if r.get("value") is not None else "",
                            unit=r.get("unit"),
                            reference_range=r.get("reference_range"),
                            collection_date=r.get("collection_date"),
                            abnormal_flag=r.get("abnormal_flag"),
                            confidence=float(r.get("confidence", 1.0)),
                            source_citation=citation,
                        )
                    )
                return LabExtraction(
                    doc_type="lab_pdf",
                    patient_id=patient_id,
                    openemr_doc_id=openemr_doc_id,
                    results=results,
                    extraction_warnings=extraction_warnings,
                )
            return await _extract_lab_vision(file_bytes, patient_id, openemr_doc_id, anthropic_client)
        return await _extract_lab_text(extracted_text, patient_id, openemr_doc_id, anthropic_client)

    if doc_type == "intake_form":
        if use_vision:
            if mimetype != "application/pdf":
                b64 = base64.standard_b64encode(file_bytes).decode()
                raw = await _call_claude_vision(_INTAKE_VISION_PROMPT, b64, anthropic_client)
                data = _parse_json_response(raw)
                threshold_warnings = _threshold_warnings_intake(data)
                extraction_warnings = list(data.get("extraction_warnings", [])) + threshold_warnings
                citation = SourceCitation(
                    source_type="intake_form",
                    source_id=str(openemr_doc_id),
                    page_or_section="page 1",
                    field_or_chunk_id="intake_form",
                    quote_or_value="",
                )
                demo_data = data.get("demographics") or {}
                return IntakeExtraction(
                    doc_type="intake_form",
                    patient_id=patient_id,
                    openemr_doc_id=openemr_doc_id,
                    demographics=Demographics(**demo_data) if demo_data else None,
                    chief_concern=data.get("chief_concern"),
                    current_medications=[
                        MedicationEntry(
                            name=m["name"],
                            dose=m.get("dose"),
                            frequency=m.get("frequency"),
                            confidence=float(m.get("confidence", 1.0)),
                        )
                        for m in data.get("current_medications", [])
                        if m.get("name")
                    ],
                    allergies=[
                        AllergyEntry(
                            allergen=a["allergen"],
                            reaction=a.get("reaction"),
                            confidence=float(a.get("confidence", 1.0)),
                        )
                        for a in data.get("allergies", [])
                        if a.get("allergen")
                    ],
                    family_history=data.get("family_history", []),
                    source_citation=citation,
                    extraction_warnings=extraction_warnings,
                )
            return await _extract_intake_vision(file_bytes, patient_id, openemr_doc_id, anthropic_client)
        return await _extract_intake_text(extracted_text, patient_id, openemr_doc_id, anthropic_client)

    raise ValueError(f"Unknown doc_type: {doc_type!r}. Expected 'lab_pdf' or 'intake_form'.")
