"""Public entry point: choose the right extraction path for a document."""
from __future__ import annotations

import logging
import re

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
from schemas.other import OtherExtraction

logger = logging.getLogger(__name__)

# Filename keywords that strongly suggest a document type.
_LAB_KEYWORDS    = re.compile(r"lab|result|panel|report|lipid|cmp|bmp|cbc|a1c|glucose|lipid", re.I)
_INTAKE_KEYWORDS = re.compile(r"intake|registration|admis|new.?patient|consent|history", re.I)


def _guess_type_from_filename(doc_name: str) -> str | None:
    """Return 'lab_pdf' or 'intake_form' if the filename is a strong signal."""
    if _INTAKE_KEYWORDS.search(doc_name):
        return "intake_form"
    if _LAB_KEYWORDS.search(doc_name):
        return "lab_pdf"
    return None


async def _guess_type_from_content(
    text: str,
    file_bytes: bytes,
    mimetype: str,
    anthropic_client: anthropic.AsyncAnthropic,
) -> str:
    """Ask Haiku to classify the document type from a short text snippet."""
    snippet = text[:2000] if text else "(binary / no extractable text)"
    try:
        msg = await anthropic_client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=20,
            messages=[{
                "role": "user",
                "content": (
                    "Classify this medical document as exactly one of: "
                    "lab_pdf, intake_form, other.\n"
                    f"Document snippet:\n{snippet}\n\n"
                    "Reply with only the class name."
                ),
            }],
        )
        label = msg.content[0].text.strip().lower()
        if label in ("lab_pdf", "intake_form", "other"):
            return label
    except Exception:
        logger.warning("Content-based classification failed — defaulting to 'other'")
    return "other"


async def extract_document(
    file_bytes: bytes,
    mimetype: str,
    doc_type: str,
    patient_id: int,
    openemr_doc_id: int,
    anthropic_client: anthropic.AsyncAnthropic,
    doc_name: str = "",
) -> LabExtraction | IntakeExtraction | OtherExtraction:
    """Extract structured data from a PDF or image.

    Path selection:
        - PDFs: try pdfplumber text extraction; if usable → text path,
          else → vision path.
        - Images (PNG/JPG): always vision path.

    If doc_type is 'other', the filename is checked first; if still unclear
    the document content is sampled for classification. Any extraction failure
    returns an OtherExtraction rather than raising, so the caller can still
    announce the upload succeeded.
    """
    if mimetype == "application/pdf":
        is_usable, extracted_text = pdf_text_is_usable(file_bytes)
        use_vision = not is_usable
    else:
        use_vision = True
        extracted_text = ""

    # Resolve effective type when caller sent "other" or an unknown value.
    if doc_type not in ("lab_pdf", "intake_form"):
        guessed = _guess_type_from_filename(doc_name)
        if guessed is None:
            guessed = await _guess_type_from_content(
                extracted_text, file_bytes, mimetype, anthropic_client
            )
        logger.info(
            "extract_document: doc_type=%r resolved to %r via name/content heuristic "
            "(doc_name=%r patient_id=%d doc_id=%d)",
            doc_type, guessed, doc_name, patient_id, openemr_doc_id,
        )
        doc_type = guessed

    logger.info(
        "extract_document: doc_type=%s mimetype=%s use_vision=%s patient_id=%d doc_id=%d",
        doc_type, mimetype, use_vision, patient_id, openemr_doc_id,
    )

    # Route to appropriate extractor; wrap in broad except for graceful fallback.
    try:
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
                pdf_bytes=file_bytes if mimetype == "application/pdf" else None,
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

    except Exception:
        logger.exception(
            "Extraction failed for doc_type=%s doc_id=%d — returning OtherExtraction",
            doc_type, openemr_doc_id,
        )
        return OtherExtraction(
            doc_type="other",
            patient_id=patient_id,
            openemr_doc_id=openemr_doc_id,
            detected_type=doc_type,
            extraction_warnings=[f"Extraction failed for {doc_type}; document stored but not parsed."],
        )

    # doc_type resolved to "other" after heuristics — return minimal stub.
    return OtherExtraction(
        doc_type="other",
        patient_id=patient_id,
        openemr_doc_id=openemr_doc_id,
        detected_type=None,
        summary="Document stored. Type could not be determined from filename or content.",
        extraction_warnings=["Could not classify document type."],
    )
