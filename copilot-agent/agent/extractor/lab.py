"""Lab-PDF extraction — text path and vision path.

The text path is faster and cheaper; the vision path is the fallback for
scanned PDFs. Both produce a fully-cited :class:`LabExtraction`.
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
from agent.extractor.confidence import threshold_warnings_lab
from agent.extractor.pdf_utils import pdf_to_b64_images
from agent.extractor.prompts import LAB_TEXT_PROMPT, LAB_VISION_PROMPT
from schemas.citation import SourceCitation
from schemas.lab import LabExtraction, LabResult

logger = logging.getLogger(__name__)


def _build_lab_result(r: dict[str, Any], openemr_doc_id: int, page_label: str) -> LabResult:
    """Convert a raw result dict from Claude into a LabResult with citation."""
    citation = SourceCitation(
        source_type="lab_pdf",
        source_id=str(openemr_doc_id),
        page_or_section=page_label,
        field_or_chunk_id=r.get("test_name", "unknown"),
        quote_or_value=str(r.get("value", "")),
    )
    return LabResult(
        test_name=r.get("test_name", ""),
        value=str(r.get("value", "")) if r.get("value") is not None else "",
        unit=r.get("unit"),
        reference_range=r.get("reference_range"),
        collection_date=r.get("collection_date"),
        abnormal_flag=r.get("abnormal_flag"),
        confidence=float(r.get("confidence", 1.0)),
        source_citation=citation,
    )


async def extract_lab_text(
    text: str,
    patient_id: int,
    openemr_doc_id: int,
    anthropic_client: anthropic.AsyncAnthropic,
) -> LabExtraction:
    raw = await call_claude_text(LAB_TEXT_PROMPT.format(text=text), anthropic_client)
    data = parse_json_response(raw)

    raw_results, threshold_warns = threshold_warnings_lab(data.get("results", []))
    warnings = list(data.get("extraction_warnings", [])) + threshold_warns
    results = [_build_lab_result(r, openemr_doc_id, "text extraction") for r in raw_results]

    return LabExtraction(
        doc_type="lab_pdf",
        patient_id=patient_id,
        openemr_doc_id=openemr_doc_id,
        results=results,
        extraction_warnings=warnings,
    )


async def extract_lab_vision_pages(
    page_images: list[tuple[str, int]],
    patient_id: int,
    openemr_doc_id: int,
    anthropic_client: anthropic.AsyncAnthropic,
) -> LabExtraction:
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
            raw = await call_claude_vision(LAB_VISION_PROMPT, b64_image, anthropic_client)
            data = parse_json_response(raw)

            raw_results, threshold_warns = threshold_warnings_lab(data.get("results", []))
            all_warnings.extend(data.get("extraction_warnings", []))
            all_warnings.extend(threshold_warns)

            page_label = f"page {page_num}"
            all_results.extend(
                _build_lab_result(r, openemr_doc_id, page_label) for r in raw_results
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


async def extract_lab_vision(
    pdf_bytes: bytes,
    patient_id: int,
    openemr_doc_id: int,
    anthropic_client: anthropic.AsyncAnthropic,
) -> LabExtraction:
    return await extract_lab_vision_pages(
        pdf_to_b64_images(pdf_bytes), patient_id, openemr_doc_id, anthropic_client
    )
