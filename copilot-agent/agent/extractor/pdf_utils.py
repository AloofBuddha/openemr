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
import re
from dataclasses import dataclass

import pdfplumber

logger = logging.getLogger(__name__)


# ── Word-level page index for bbox lookups ──────────────────────────────────


@dataclass(frozen=True)
class PageWord:
    """One pdfplumber-extracted word with its page-relative bbox."""

    page: int
    text: str
    x0: float
    y0: float    # PDF coords: distance from page bottom
    x1: float
    y1: float
    page_width: float
    page_height: float


@dataclass(frozen=True)
class PageWordIndex:
    """Per-page list of words; built once per PDF, queried per extracted value."""

    pages: dict[int, list[PageWord]]  # 1-indexed page → words


def build_word_index(pdf_bytes: bytes) -> PageWordIndex:
    """Walk every page once and capture word-level bboxes for later matching.

    pdfplumber yields y-coords with the origin at the top of the page; we
    convert to a bottom-origin frame (PDF native) so the UI's coord-flip
    is simple: ``canvas_y = (page_height - y_pdf) * scale``.
    """
    pages: dict[int, list[PageWord]] = {}
    try:
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            for i, page in enumerate(pdf.pages, start=1):
                w = float(page.width or 0.0)
                h = float(page.height or 0.0)
                page_words: list[PageWord] = []
                for raw in page.extract_words() or []:
                    try:
                        x0 = float(raw["x0"])
                        x1 = float(raw["x1"])
                        # Convert top-origin → bottom-origin.
                        y0_pdf = h - float(raw["bottom"])
                        y1_pdf = h - float(raw["top"])
                        page_words.append(PageWord(
                            page=i,
                            text=str(raw.get("text") or ""),
                            x0=x0,
                            y0=y0_pdf,
                            x1=x1,
                            y1=y1_pdf,
                            page_width=w,
                            page_height=h,
                        ))
                    except (KeyError, TypeError, ValueError):
                        continue
                pages[i] = page_words
    except Exception:
        logger.exception("Word-index build failed; bbox overlays will be skipped")
    return PageWordIndex(pages=pages)


_WORD_TOKEN_RE = re.compile(r"\S+")


def _normalize(token: str) -> str:
    """Lowercase + strip punctuation so 'A1c:' matches 'A1c'."""
    return re.sub(r"[^\w.\-/%]", "", token.lower())


def find_value_bbox(
    index: PageWordIndex,
    value: str,
    test_name: str | None = None,
) -> tuple[int, float, float, float, float, float, float] | None:
    """Locate the bbox of ``value`` (e.g. "9.2") on the page that also hosts ``test_name``.

    Returns ``(page, x0, y0, x1, y1, page_width, page_height)`` or None.
    The match is intentionally greedy: we look for a word whose normalized
    text equals the normalized value, preferring pages where ``test_name``
    appears nearby. Fail soft — bbox is decoration, not gating.
    """
    norm_value = _normalize(value)
    norm_test = _normalize(test_name or "")
    if not norm_value:
        return None

    # Step 1: pages containing the test name (preferred), else all pages.
    candidate_pages = list(index.pages.keys())
    if norm_test:
        with_test = [
            p for p, words in index.pages.items()
            if any(norm_test in _normalize(w.text) or _normalize(w.text) in norm_test for w in words)
        ]
        if with_test:
            candidate_pages = with_test

    # Step 2: find the value word on those pages.
    for p in candidate_pages:
        for w in index.pages.get(p, []):
            if _normalize(w.text) == norm_value:
                return (p, w.x0, w.y0, w.x1, w.y1, w.page_width, w.page_height)

    # Step 3: substring fallback — value embedded in a longer word ("9.2%").
    for p in candidate_pages:
        for w in index.pages.get(p, []):
            if norm_value and norm_value in _normalize(w.text):
                return (p, w.x0, w.y0, w.x1, w.y1, w.page_width, w.page_height)

    return None

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
