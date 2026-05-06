"""Two-tier extraction cache: in-memory dict warmed from on-disk JSON files.

Survives sidecar restarts (disk layer) while serving repeated reads of the
same doc cheaply (memory layer). Each extraction is a single JSON file
named ``{doc_id}.json``.
"""
from __future__ import annotations

import json
import logging
from pathlib import Path

logger = logging.getLogger(__name__)


class ExtractionCache:
    """Memory-first, disk-fallback cache for document extractions."""

    def __init__(self, cache_dir: Path) -> None:
        self._dir = cache_dir
        self._dir.mkdir(exist_ok=True)
        self._memory: dict[int, dict] = {}

    def get(self, doc_id: int) -> dict | None:
        """Return the extraction or None if not cached anywhere.

        Disk hits warm the memory layer so subsequent reads skip disk I/O.
        """
        if doc_id in self._memory:
            return self._memory[doc_id]

        path = self._path(doc_id)
        if not path.exists():
            return None

        try:
            data = json.loads(path.read_text())
        except Exception:
            logger.exception("Failed to load cached extraction for doc_id=%d", doc_id)
            return None

        self._memory[doc_id] = data
        return data

    def set(self, doc_id: int, data: dict) -> None:
        """Persist to both layers. Disk write failure is logged, not raised."""
        self._memory[doc_id] = data
        try:
            self._path(doc_id).write_text(json.dumps(data))
        except Exception:
            logger.exception("Failed to persist extraction for doc_id=%d", doc_id)

    def _path(self, doc_id: int) -> Path:
        return self._dir / f"{doc_id}.json"
