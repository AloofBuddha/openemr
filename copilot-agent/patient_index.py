"""Per-patient intake document index.

Tracks which intake forms have been ingested for each patient and whether they
have been picked up by the agent graph. This lets the copilot auto-include intake
form context even when the form was uploaded by front-desk staff in a separate
browser session or before the physician opened the chart.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path

logger = logging.getLogger(__name__)


class PatientIntakeIndex:
    """Disk-backed index of intake form docs per patient."""

    def __init__(self, index_dir: Path) -> None:
        self._dir = index_dir
        self._dir.mkdir(exist_ok=True)

    def register(self, pid: int, doc_id: int, doc_name: str) -> None:
        """Record a newly ingested intake form as unprocessed."""
        entries = self._load(pid)
        if any(e["doc_id"] == doc_id for e in entries):
            return
        entries.append({
            "doc_id": doc_id,
            "doc_name": doc_name,
            "ingested_at": datetime.now(timezone.utc).isoformat(),
            "processed_at": None,
        })
        self._save(pid, entries)
        logger.info("Registered intake doc_id=%d for pid=%d", doc_id, pid)

    def mark_processed(self, pid: int, doc_id: int) -> None:
        """Mark an intake form as processed by the agent."""
        entries = self._load(pid)
        for e in entries:
            if e["doc_id"] == doc_id and e["processed_at"] is None:
                e["processed_at"] = datetime.now(timezone.utc).isoformat()
        self._save(pid, entries)

    def get_unprocessed(self, pid: int) -> list[dict]:
        """Return entries for intake forms not yet processed by the agent."""
        return [e for e in self._load(pid) if e["processed_at"] is None]

    def _load(self, pid: int) -> list[dict]:
        path = self._path(pid)
        if not path.exists():
            return []
        try:
            return json.loads(path.read_text())
        except Exception:
            logger.exception("Failed to load intake index for pid=%d", pid)
            return []

    def _save(self, pid: int, entries: list[dict]) -> None:
        try:
            self._path(pid).write_text(json.dumps(entries))
        except Exception:
            logger.exception("Failed to save intake index for pid=%d", pid)

    def _path(self, pid: int) -> Path:
        return self._dir / f"{pid}.json"
