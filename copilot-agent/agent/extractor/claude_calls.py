"""Anthropic API wrappers + JSON-from-Claude parser.

All extractions use Haiku (cheap, fast). The supervisor + answer assembler
in ``agent/nodes.py`` use a different model (Sonnet) and live elsewhere.
"""
from __future__ import annotations

import json
from typing import Any

import anthropic

HAIKU = "claude-haiku-4-5-20251001"


async def call_claude_text(
    prompt: str,
    anthropic_client: anthropic.AsyncAnthropic,
) -> str:
    """Send a text-only message to Claude Haiku and return the raw text reply."""
    message = await anthropic_client.messages.create(
        model=HAIKU,
        max_tokens=2048,
        messages=[{"role": "user", "content": prompt}],
    )
    return message.content[0].text  # type: ignore[union-attr]


async def call_claude_vision(
    prompt: str,
    b64_image: str,
    anthropic_client: anthropic.AsyncAnthropic,
) -> str:
    """Send a vision message (image + text) to Claude Haiku and return the reply."""
    message = await anthropic_client.messages.create(
        model=HAIKU,
        max_tokens=2048,
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": "image/png",
                            "data": b64_image,
                        },
                    },
                    {"type": "text", "text": prompt},
                ],
            }
        ],
    )
    return message.content[0].text  # type: ignore[union-attr]


def parse_json_response(raw: str) -> dict[str, Any]:
    """Strip optional markdown code fences and parse JSON.

    Claude sometimes wraps its JSON in ```json ... ``` despite instructions
    not to. This handles either form gracefully; raises ``json.JSONDecodeError``
    if the payload is genuinely malformed.
    """
    text = raw.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else text[3:]
        if text.endswith("```"):
            text = text[:-3]
    return json.loads(text.strip())
