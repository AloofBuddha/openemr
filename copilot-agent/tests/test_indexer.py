"""Tests for rag/indexer.py — corpus loading, chunk ID, source_ref parsing."""
from __future__ import annotations

from pathlib import Path

from rag.indexer import (
    _chunk_id,
    _extract_source_ref,
    _load_chunks,
)


# ---------------------------------------------------------------------------
# _extract_source_ref
# ---------------------------------------------------------------------------


def test_extract_source_ref_returns_bracketed_prefix() -> None:
    text = "[ACC/AHA 2023 §2.1]\nFor most adults, the target BP is..."
    assert _extract_source_ref(text) == "[ACC/AHA 2023 §2.1]"


def test_extract_source_ref_handles_inline_bracket_only() -> None:
    """Bracket must be at the start of the first line; mid-text doesn't count."""
    text = "Some preamble [ADA 2025] inline\nrest of text"
    assert _extract_source_ref(text) == ""


def test_extract_source_ref_returns_empty_when_no_bracket() -> None:
    assert _extract_source_ref("just plain text\nno bracket here") == ""


def test_extract_source_ref_returns_empty_for_empty_text() -> None:
    assert _extract_source_ref("") == ""
    assert _extract_source_ref("   \n  ") == ""


# ---------------------------------------------------------------------------
# _chunk_id
# ---------------------------------------------------------------------------


def test_chunk_id_is_16_hex_chars() -> None:
    cid = _chunk_id("any text")
    assert len(cid) == 16
    assert all(c in "0123456789abcdef" for c in cid)


def test_chunk_id_is_deterministic() -> None:
    assert _chunk_id("the same text") == _chunk_id("the same text")


def test_chunk_id_differs_for_different_text() -> None:
    assert _chunk_id("text one") != _chunk_id("text two")


# ---------------------------------------------------------------------------
# _load_chunks
# ---------------------------------------------------------------------------


def test_load_chunks_splits_on_separator(tmp_path: Path) -> None:
    """Chunks are separated by '---' and blank chunks are skipped."""
    (tmp_path / "guide.txt").write_text(
        "[REF1]\nFirst chunk content.\n"
        "---\n"
        "[REF2]\nSecond chunk content.\n"
        "---\n"
        "\n"  # blank chunk should be skipped
        "---\n"
        "[REF3]\nThird chunk content.",
        encoding="utf-8",
    )
    chunks = _load_chunks(tmp_path)
    assert len(chunks) == 3
    assert [c.source_ref for c in chunks] == ["[REF1]", "[REF2]", "[REF3]"]


def test_load_chunks_reads_multiple_files(tmp_path: Path) -> None:
    (tmp_path / "a.txt").write_text("[A1]\ncontent A", encoding="utf-8")
    (tmp_path / "b.txt").write_text("[B1]\ncontent B", encoding="utf-8")
    chunks = _load_chunks(tmp_path)
    refs = sorted(c.source_ref for c in chunks)
    assert refs == ["[A1]", "[B1]"]


def test_load_chunks_returns_empty_list_when_no_txt_files(tmp_path: Path) -> None:
    (tmp_path / "ignore.md").write_text("not a txt file", encoding="utf-8")
    assert _load_chunks(tmp_path) == []


def test_load_chunks_assigns_unique_chunk_ids(tmp_path: Path) -> None:
    (tmp_path / "guide.txt").write_text(
        "[A]\nfirst\n---\n[B]\nsecond",
        encoding="utf-8",
    )
    chunks = _load_chunks(tmp_path)
    ids = [c.chunk_id for c in chunks]
    assert len(set(ids)) == len(ids)
