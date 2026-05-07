"""Two-tier extraction cache: in-memory dict warmed from on-disk JSON files.

Survives sidecar restarts (disk layer) while serving repeated reads of the
same doc cheaply (memory layer). Each extraction is a single JSON file
named ``{doc_id}.json``.

Also stores per-document page-image PNGs as ``{doc_id}_page{N}.png`` so
the UI can render bounding-box overlays on the cited region.
"""
from __future__ import annotations

import io
import json
import logging
from pathlib import Path

import pdfplumber

logger = logging.getLogger(__name__)


def render_pdf_pages_to_cache(cache_dir: Path, doc_id: int, pdf_bytes: bytes) -> int:
    """Render every page of ``pdf_bytes`` as PNG into ``cache_dir``.

    Returns the number of pages rendered. Failures are logged and absorbed
    so an extraction that wasn't otherwise broken still succeeds — the
    bbox overlay just won't be available for those pages.
    """
    rendered = 0
    try:
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            for i, page in enumerate(pdf.pages, start=1):
                img = page.to_image(resolution=150)
                out = cache_dir / f"{doc_id}_page{i}.png"
                img.save(str(out), format="PNG")
                rendered += 1
    except Exception:
        logger.exception("Page-image render failed for doc_id=%d", doc_id)
    return rendered


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
