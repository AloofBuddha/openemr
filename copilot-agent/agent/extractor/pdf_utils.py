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


def _union_bbox(words: list[PageWord]) -> tuple[float, float, float, float]:
    """Return (x0, y0, x1, y1) covering every word in ``words``."""
    return (
        min(w.x0 for w in words),
        min(w.y0 for w in words),
        max(w.x1 for w in words),
        max(w.y1 for w in words),
    )


# How much of a word's height a same-row neighbor's vertical center can drift
# from the matched bbox's y-band before it's considered a different line.
# 0.5 = neighbors must overlap the band by at least half a line; loose enough
# to absorb baseline jitter, tight enough to not cross to the next row.
_SAME_ROW_TOLERANCE = 0.5


def _expand_to_row_band(
    page_words: list[PageWord],
    bbox: tuple[float, float, float, float],
) -> tuple[float, float, float, float]:
    """Expand a tight word-level bbox to span the whole row it sits on.

    Why: the highlight ought to encompass the full row of context the user
    is reading (e.g. "Metformin 500 mg PO twice daily 2020 ..."), not just
    the matched word. We detect "same row" by checking which words on the
    page vertically overlap the bbox's y-band. The union of their x-extents
    is the row's x-extent.

    Falls back to the input bbox if no neighbors are found (defensive: a
    free-form prose chunk with weird layout shouldn't degrade the highlight).
    """
    bx0, by0, bx1, by1 = bbox
    line_height = max(by1 - by0, 1.0)
    band_top = by0 - line_height * _SAME_ROW_TOLERANCE
    band_bot = by1 + line_height * _SAME_ROW_TOLERANCE
    same_row = [
        w for w in page_words
        if w.y0 < band_bot and w.y1 > band_top  # vertically overlaps the band
    ]
    if not same_row:
        return bbox
    return (
        min(w.x0 for w in same_row),
        min(w.y0 for w in same_row),
        max(w.x1 for w in same_row),
        max(w.y1 for w in same_row),
    )


def _find_token_run(
    page_words: list[PageWord],
    norm_tokens: list[str],
) -> tuple[int, int] | None:
    """Find a contiguous run of ``page_words`` whose normalized text equals
    each token in ``norm_tokens`` in order. Returns (start, end_exclusive)
    or None. Allows substring match on the first/last token to handle
    "10mg" rendered as "10" + "mg" or vice versa.
    """
    n = len(norm_tokens)
    if n == 0:
        return None
    for i in range(len(page_words) - n + 1):
        ok = True
        for j, tok in enumerate(norm_tokens):
            actual = _normalize(page_words[i + j].text)
            if actual == tok:
                continue
            # Be forgiving on first/last: pdfplumber sometimes glues them.
            if (j == 0 or j == n - 1) and tok in actual:
                continue
            ok = False
            break
        if ok:
            return (i, i + n)
    return None


def find_value_bbox(
    index: PageWordIndex,
    value: str,
    test_name: str | None = None,
) -> tuple[int, float, float, float, float, float, float] | None:
    """Locate the bbox of ``value`` (e.g. "9.2", "10 mg", "Type 2 diabetes")
    on the page that also hosts ``test_name``, expanded to its full row.

    Returns ``(page, x0, y0, x1, y1, page_width, page_height)`` or None.
    The returned bbox spans the entire row of context (e.g. "Metformin
    500 mg PO twice daily 2020 ..."), not just the matched word — that's
    the unit a doctor reads to verify the citation. Bbox is decoration —
    failing here returns None and the caller emits a citation without it.
    """
    norm_test = _normalize(test_name or "")
    raw_tokens = [t for t in re.split(r"\s+", value.strip()) if t]
    norm_tokens = [_normalize(t) for t in raw_tokens]
    norm_tokens = [t for t in norm_tokens if t]
    if not norm_tokens:
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

    located: tuple[int, float, float, float, float, float, float] | None = None

    # Step 2: contiguous-run match (handles single-token and multi-token).
    for p in candidate_pages:
        page_words = index.pages.get(p, [])
        run = _find_token_run(page_words, norm_tokens)
        if run is not None:
            start, end = run
            covered = page_words[start:end]
            x0, y0, x1, y1 = _union_bbox(covered)
            first = covered[0]
            located = (p, x0, y0, x1, y1, first.page_width, first.page_height)
            break

    # Step 3: single-token substring fallback (e.g. "9.2" within "9.2%").
    if located is None and len(norm_tokens) == 1:
        only = norm_tokens[0]
        for p in candidate_pages:
            for w in index.pages.get(p, []):
                if only in _normalize(w.text):
                    located = (p, w.x0, w.y0, w.x1, w.y1, w.page_width, w.page_height)
                    break
            if located is not None:
                break

    # Step 4: first-token-only fallback for multi-token values.
    if located is None and len(norm_tokens) > 1:
        first_tok = norm_tokens[0]
        for p in candidate_pages:
            for w in index.pages.get(p, []):
                if _normalize(w.text) == first_tok:
                    located = (p, w.x0, w.y0, w.x1, w.y1, w.page_width, w.page_height)
                    break
            if located is not None:
                break

    if located is None:
        return None

    # Expand the tight match to the full row band so the highlight in the
    # source drawer encompasses the surrounding context, not just the
    # matched word.
    page_num = located[0]
    tight = located[1:5]
    pw, ph = located[5], located[6]
    expanded = _expand_to_row_band(index.pages.get(page_num, []), tight)
    return (page_num, expanded[0], expanded[1], expanded[2], expanded[3], pw, ph)

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
