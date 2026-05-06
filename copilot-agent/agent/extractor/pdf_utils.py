"""PDF and image preparation helpers.

Two paths feed into Claude:
    - text path: pdfplumber pulls plain text out of digital PDFs
    - vision path: pdfplumber renders each page to a base64 PNG

Single-image uploads (PNG/JPEG) are wrapped as a one-page list so the
same vision-extraction code handles both.
"""
from __future__ import annotations

import base64
import io
import logging

import pdfplumber

logger = logging.getLogger(__name__)

# A PDF is considered text-usable when pdfplumber extracts more than this
# many printable characters across all pages. Below this we fall back to
# the vision path.
_PRINTABLE_CHAR_THRESHOLD = 100


def single_image_as_pages(file_bytes: bytes) -> list[tuple[str, int]]:
    """Wrap raw image bytes as a single-page list for the vision helpers."""
    b64 = base64.standard_b64encode(file_bytes).decode()
    return [(b64, 1)]


def pdf_text_is_usable(pdf_bytes: bytes) -> tuple[bool, str]:
    """Return (is_usable, extracted_text) for a PDF.

    pdfplumber returns mostly-empty text for scanned/image PDFs; the
    printable-character count is a cheap signal for "did this work".
    """
    try:
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            pages_text: list[str] = []
            for page in pdf.pages:
                text = page.extract_text() or ""
                pages_text.append(text)
            combined = "\n\n".join(pages_text)
            printable = sum(1 for c in combined if c.isprintable())
            return printable > _PRINTABLE_CHAR_THRESHOLD, combined
    except Exception:
        logger.exception("pdfplumber failed to open PDF")
        return False, ""


def pdf_to_b64_images(pdf_bytes: bytes) -> list[tuple[str, int]]:
    """Convert each PDF page to a base64 PNG.

    Returns
    -------
    List of ``(b64_string, page_number)`` tuples (1-indexed). Empty list if
    rendering fails — callers should add a warning rather than crash.
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
