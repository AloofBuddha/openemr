"""Tests for bbox extraction on real demo PDFs.

Bboxes drive the citation drawer's yellow-rectangle overlay. If these
break, the demo's "click-to-source" feature silently degrades to a plain
PNG with no highlight — exactly the failure mode we want to catch in CI.

Each test runs the bbox-only path (no Claude call) by simulating what
Claude would return and asserting that ``find_value_bbox`` locates each
value on the right page.
"""
from __future__ import annotations

from pathlib import Path

import pytest

from agent.extractor.lab import _build_lab_result
from agent.extractor.intake import _entry_citation
from agent.extractor.pdf_utils import build_word_index, find_value_bbox

EXAMPLES = Path(__file__).resolve().parents[2] / "example-documents"
LAB_DIR = EXAMPLES / "lab-results"
INTAKE_DIR = EXAMPLES / "intake-forms"


def _load(p: Path) -> bytes:
    if not p.exists():
        pytest.skip(f"Demo PDF missing: {p}")
    return p.read_bytes()


# ---------------------------------------------------------------------------
# find_value_bbox: low-level matcher
# ---------------------------------------------------------------------------


def test_find_value_bbox_matches_single_token_lab_value() -> None:
    """Standard case: lab value is a single token (e.g. '232')."""
    idx = build_word_index(_load(LAB_DIR / "p01-chen-lipid-panel.pdf"))
    res = find_value_bbox(idx, "232", test_name="Cholesterol, Total")
    assert res is not None
    page, x0, y0, x1, y1, pw, ph = res
    assert page == 1
    assert x1 > x0 and y1 > y0
    assert pw > 0 and ph > 0


def test_find_value_bbox_matches_multi_token_dose() -> None:
    """Multi-token: pdfplumber splits '10 mg' into ['10', 'mg']."""
    idx = build_word_index(_load(INTAKE_DIR / "p01-chen-intake-typed.pdf"))
    res = find_value_bbox(idx, "10 mg", test_name="Lisinopril")
    assert res is not None
    # Union bbox: should be wider than a single token's box.
    page, x0, y0, x1, y1, *_ = res
    assert page >= 1
    assert (x1 - x0) > 5


def test_find_value_bbox_returns_none_for_missing_value() -> None:
    idx = build_word_index(_load(LAB_DIR / "p01-chen-lipid-panel.pdf"))
    assert find_value_bbox(idx, "ZZZNOPE-12345") is None


def test_find_value_bbox_falls_back_to_first_token() -> None:
    """If full multi-token sequence isn't contiguous, return first-token bbox."""
    idx = build_word_index(_load(INTAKE_DIR / "p02-whitaker-intake.pdf"))
    # "5 mg" appears for Apixaban: should find it
    res = find_value_bbox(idx, "5 mg", test_name="Apixaban")
    assert res is not None


def test_find_value_bbox_expands_to_row() -> None:
    """The returned bbox should span the row of context, not just the matched
    word. Chen's intake has a meds table where 'Metformin' on the left ends
    with 'Type 2 diabetes' on the right — the bbox width should reflect that
    full row, not the ~50 pt of just the medication name."""
    idx = build_word_index(_load(INTAKE_DIR / "p01-chen-intake-typed.pdf"))
    res = find_value_bbox(idx, "Metformin")
    assert res is not None
    _, x0, _, x1, _, page_width, _ = res
    width = x1 - x0
    # 'Metformin' alone is ~50pt wide. A full table row is several hundred.
    # Anything > 200 indicates row-level expansion is working.
    assert width > 200, (
        f"Expected row-level bbox (>200pt wide), got {width:.0f}pt — "
        f"row-expansion may have regressed"
    )
    # And the row should still fit on the page.
    assert x1 <= page_width


# ---------------------------------------------------------------------------
# Lab + intake citation builders: the real call sites
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("pdf,values", [
    ("p01-chen-lipid-panel.pdf", [
        {"test_name": "Cholesterol, Total", "value": "232", "unit": "mg/dL"},
        {"test_name": "HDL Cholesterol",    "value": "48",  "unit": "mg/dL"},
        {"test_name": "LDL Cholesterol",    "value": "158", "unit": "mg/dL"},
        {"test_name": "Triglycerides",      "value": "165", "unit": "mg/dL"},
    ]),
])
def test_lab_text_path_populates_bbox(pdf: str, values: list[dict]) -> None:
    """The text path should populate bbox for every clean lab value."""
    word_index = build_word_index(_load(LAB_DIR / pdf))
    for raw in values:
        result = _build_lab_result(raw, openemr_doc_id=99,
                                   page_label="text extraction",
                                   word_index=word_index)
        sc = result.source_citation
        assert sc.bbox is not None, f"No bbox for {raw['test_name']!r}"
        assert sc.page_or_section.startswith("page "), \
            f"Expected resolved page label, got {sc.page_or_section!r}"


@pytest.mark.parametrize("pdf,meds", [
    ("p01-chen-intake-typed.pdf", ["Lisinopril", "Metformin", "Atorvastatin"]),
    ("p02-whitaker-intake.pdf",   ["Apixaban", "Tamsulosin", "Atorvastatin"]),
])
def test_intake_text_path_populates_med_bbox(pdf: str, meds: list[str]) -> None:
    """Intake medication entries should each have a bbox over the med name."""
    word_index = build_word_index(_load(INTAKE_DIR / pdf))
    for med_name in meds:
        citation = _entry_citation(
            raw={"name": med_name, "source_quote": med_name},
            openemr_doc_id=42,
            page_label="page 1",
            field_id=f"medication.{med_name}",
            fallback_quote=med_name,
            word_index=word_index,
            locator=med_name,
        )
        assert citation.bbox is not None, f"No bbox for med {med_name!r} in {pdf}"
        assert citation.page_or_section.startswith("page ")
