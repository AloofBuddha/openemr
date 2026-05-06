"""Tests for cache.ExtractionCache — the two-tier extraction cache."""
from __future__ import annotations

import json
from pathlib import Path

from cache import ExtractionCache


def test_get_returns_none_for_unknown_doc(tmp_path: Path) -> None:
    cache = ExtractionCache(tmp_path)
    assert cache.get(999) is None


def test_set_then_get_round_trips(tmp_path: Path) -> None:
    cache = ExtractionCache(tmp_path)
    payload = {"doc_type": "lab_pdf", "results": []}
    cache.set(42, payload)
    assert cache.get(42) == payload


def test_set_persists_to_disk(tmp_path: Path) -> None:
    cache = ExtractionCache(tmp_path)
    cache.set(42, {"a": 1})
    on_disk = json.loads((tmp_path / "42.json").read_text())
    assert on_disk == {"a": 1}


def test_get_warms_memory_from_disk(tmp_path: Path) -> None:
    """A cache built fresh over an existing disk file should serve memory hits afterward."""
    (tmp_path / "7.json").write_text(json.dumps({"warmed": True}))
    cache = ExtractionCache(tmp_path)

    assert cache.get(7) == {"warmed": True}
    # Delete the file — subsequent reads should still hit memory
    (tmp_path / "7.json").unlink()
    assert cache.get(7) == {"warmed": True}


def test_get_returns_none_for_corrupt_disk_file(tmp_path: Path) -> None:
    """A garbled JSON file shouldn't crash the cache — log and return None."""
    (tmp_path / "5.json").write_text("not json {{")
    cache = ExtractionCache(tmp_path)
    assert cache.get(5) is None


def test_creates_cache_dir_if_missing(tmp_path: Path) -> None:
    target = tmp_path / "subdir"
    assert not target.exists()
    ExtractionCache(target)
    assert target.is_dir()
