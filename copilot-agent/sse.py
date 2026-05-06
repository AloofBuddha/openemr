"""Server-Sent Events helpers.

Two utilities:
    - ``event`` formats one SSE message ready for ``yield``-ing
    - ``stream_text_in_chunks`` slices a string into ``delta`` events with a
      small delay between chunks so the browser renders progressively
"""
from __future__ import annotations

import asyncio
import json
from typing import AsyncIterator

# Default streaming feel: ~67 chunks/sec at 12 chars each ≈ 800 chars/sec.
# Fast enough to feel live, slow enough for the eye to track.
DEFAULT_CHUNK_SIZE = 12
DEFAULT_DELAY_SECONDS = 0.015


def event(name: str, data: dict | str) -> str:
    """Format a single SSE event. ``data`` is JSON-encoded if it's a dict."""
    payload = data if isinstance(data, str) else json.dumps(data)
    return f"event: {name}\ndata: {payload}\n\n"


async def stream_text_in_chunks(
    text: str,
    chunk_size: int = DEFAULT_CHUNK_SIZE,
    delay_seconds: float = DEFAULT_DELAY_SECONDS,
) -> AsyncIterator[str]:
    """Yield ``delta`` events that together reconstitute ``text``.

    Each chunk is a JSON object ``{"text": "..."}`` so the consumer can
    append directly without re-parsing.
    """
    for i in range(0, len(text), chunk_size):
        yield event("delta", {"text": text[i:i + chunk_size]})
        await asyncio.sleep(delay_seconds)
