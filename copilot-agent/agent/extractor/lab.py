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
from agent.extractor.pdf_utils import (
    PageWordIndex,
    build_word_index,
    find_value_bbox,
    pdf_to_b64_images,
)
from agent.extractor.prompts import LAB_TEXT_PROMPT, LAB_VISION_PROMPT
from schemas.citation import BBox, SourceCitation
from schemas.lab import LabExtraction, LabResult

logger = logging.getLogger(__name__)


def _build_lab_result(
    r: dict[str, Any],
    openemr_doc_id: int,
    page_label: str,
    word_index: PageWordIndex | None = None,
) -> LabResult:
    """Convert a raw result dict from Claude into a LabResult with citation.

    When a ``word_index`` is supplied (text path only — pdfplumber gave us
    word-level coordinates), we try to locate the extracted value back in
    the source PDF and attach a bbox to the citation. Bbox is decoration:
    if the lookup misses, we still emit a perfectly valid LabResult.
    """
    test_name = r.get("test_name", "")
    value_str = str(r.get("value", "")) if r.get("value") is not None else ""

    bbox: BBox | None = None
    page_label_resolved = page_label
    if word_index is not None and value_str:
        located = find_value_bbox(word_index, value_str, test_name=test_name)
        if located is not None:
            page_num, x0, y0, x1, y1, pw, ph = located
            bbox = BBox(page=page_num, x0=x0, y0=y0, x1=x1, y1=y1,
                        page_width=pw, page_height=ph)
            page_label_resolved = f"page {page_num}"

    citation = SourceCitation(
        source_type="lab_pdf",
        source_id=str(openemr_doc_id),
        page_or_section=page_label_resolved,
        field_or_chunk_id=test_name or "unknown",
        quote_or_value=value_str,
        bbox=bbox,
    )
    return LabResult(
        test_name=test_name,
        value=value_str,
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
    pdf_bytes: bytes | None = None,
) -> LabExtraction:
    """Text-path lab extraction with optional bbox capture.

    When ``pdf_bytes`` is supplied, we build a word index once and look up
    each extracted value's bbox so the UI can render a yellow-rectangle
    overlay on the cited page. Without ``pdf_bytes`` (legacy callers,
    tests), the result is unchanged — citation just lacks ``bbox``.
    """
    raw = await call_claude_text(LAB_TEXT_PROMPT.format(text=text), anthropic_client)
    data = parse_json_response(raw)

    word_index = build_word_index(pdf_bytes) if pdf_bytes else None

    raw_results, threshold_warns = threshold_warnings_lab(data.get("results", []))
    warnings = list(data.get("extraction_warnings", [])) + threshold_warns
    results = [
        _build_lab_result(r, openemr_doc_id, "text extraction", word_index)
        for r in raw_results
    ]

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
