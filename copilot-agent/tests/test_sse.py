"""Tests for sse — the small SSE helpers used by /query."""
from __future__ import annotations

import json

import pytest

from sse import event, stream_text_in_chunks


# ---------------------------------------------------------------------------
# event()
# ---------------------------------------------------------------------------


def test_event_dict_payload_is_json_encoded() -> None:
    out = event("citations", {"citations": []})
    assert out == 'event: citations\ndata: {"citations": []}\n\n'


def test_event_string_payload_passes_through() -> None:
    """Pre-encoded payloads (already JSON or empty object) must not be re-encoded."""
    out = event("done", "{}")
    assert out == "event: done\ndata: {}\n\n"


def test_event_format_has_blank_line_terminator() -> None:
    """SSE protocol requires \\n\\n between events — the consumer relies on it."""
    out = event("status", {"text": "x"})
    assert out.endswith("\n\n")


# ---------------------------------------------------------------------------
# stream_text_in_chunks()
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_stream_text_in_chunks_concats_back_to_original() -> None:
    """Decoding every delta event must reconstitute the input verbatim."""
    text = "The quick brown fox jumps over the lazy dog"
    chunks: list[str] = []
    async for evt in stream_text_in_chunks(text, chunk_size=5, delay_seconds=0):
        # Parse the SSE data: line and extract the text field
        data_line = next(line for line in evt.splitlines() if line.startswith("data: "))
        payload = json.loads(data_line[len("data: "):])
        chunks.append(payload["text"])
    assert "".join(chunks) == text


@pytest.mark.asyncio
async def test_stream_text_in_chunks_empty_text_yields_nothing() -> None:
    events: list[str] = []
    async for evt in stream_text_in_chunks("", chunk_size=5, delay_seconds=0):
        events.append(evt)
    assert events == []


@pytest.mark.asyncio
async def test_stream_text_in_chunks_emits_correct_number_of_events() -> None:
    """27 chars / chunk_size=10 = 3 events."""
    events: list[str] = []
    async for evt in stream_text_in_chunks("a" * 27, chunk_size=10, delay_seconds=0):
        events.append(evt)
    assert len(events) == 3
