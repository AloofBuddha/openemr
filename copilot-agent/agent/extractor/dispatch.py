"""Public entry point: choose the right extraction path for a document."""
from __future__ import annotations

import logging

import anthropic

from agent.extractor.intake import (
    extract_intake_text,
    extract_intake_vision,
    extract_intake_vision_pages,
)
from agent.extractor.lab import (
    extract_lab_text,
    extract_lab_vision,
    extract_lab_vision_pages,
)
from agent.extractor.pdf_utils import pdf_text_is_usable, single_image_as_pages
from schemas.intake import IntakeExtraction
from schemas.lab import LabExtraction

logger = logging.getLogger(__name__)


async def extract_document(
    file_bytes: bytes,
    mimetype: str,
    doc_type: str,  # "lab_pdf" or "intake_form"
    patient_id: int,
    openemr_doc_id: int,
    anthropic_client: anthropic.AsyncAnthropic,
) -> LabExtraction | IntakeExtraction:
    """Extract structured data from a PDF or image.

    Path selection:
        - PDFs: try pdfplumber text extraction; if usable → text path,
          else → vision path.
        - Images (PNG/JPG): always vision path.
    """
    if mimetype == "application/pdf":
        is_usable, extracted_text = pdf_text_is_usable(file_bytes)
        use_vision = not is_usable
    else:
        use_vision = True
        extracted_text = ""

    logger.info(
        "extract_document: doc_type=%s mimetype=%s use_vision=%s patient_id=%d doc_id=%d",
        doc_type, mimetype, use_vision, patient_id, openemr_doc_id,
    )

    if doc_type == "lab_pdf":
        if use_vision:
            if mimetype != "application/pdf":
                return await extract_lab_vision_pages(
                    single_image_as_pages(file_bytes),
                    patient_id, openemr_doc_id, anthropic_client,
                )
            return await extract_lab_vision(
                file_bytes, patient_id, openemr_doc_id, anthropic_client,
            )
        return await extract_lab_text(
            extracted_text, patient_id, openemr_doc_id, anthropic_client,
        )

    if doc_type == "intake_form":
        if use_vision:
            if mimetype != "application/pdf":
                return await extract_intake_vision_pages(
                    single_image_as_pages(file_bytes),
                    patient_id, openemr_doc_id, anthropic_client,
                )
            return await extract_intake_vision(
                file_bytes, patient_id, openemr_doc_id, anthropic_client,
            )
        return await extract_intake_text(
            extracted_text, patient_id, openemr_doc_id, anthropic_client,
        )

    raise ValueError(f"Unknown doc_type: {doc_type!r}. Expected 'lab_pdf' or 'intake_form'.")
