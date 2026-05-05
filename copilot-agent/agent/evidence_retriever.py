from __future__ import annotations

from typing import Any

import chromadb
from rank_bm25 import BM25Okapi

from rag.indexer import GuidelineChunk
from rag.retriever import retrieve


def retrieve_evidence(
    query: str,
    bm25: BM25Okapi,
    bm25_chunks: list[GuidelineChunk],
    chroma_collection: chromadb.Collection,
    cohere_client: Any | None,
    top_k: int = 5,
) -> list[dict[str, Any]]:
    """Retrieve relevant guideline chunks for a clinical query.

    Returns a list of dicts, each containing:
      - chunk_id: str
      - text: str
      - source_ref: str
      - score: float
    """
    return retrieve(
        query=query,
        bm25=bm25,
        bm25_chunks=bm25_chunks,
        chroma_collection=chroma_collection,
        cohere_client=cohere_client,
        top_k=top_k,
    )


def format_guideline_sources(chunks: list[dict[str, Any]]) -> str:
    """Format retrieved guideline chunks as a numbered reference list.

    Example output:
        [G1] ACC/AHA 2023 §2.1: "For most adults, the target blood pressure..."
        [G2] ADA 2025 §6.5: "For most non-pregnant adults with T2D..."
    """
    if not chunks:
        return ""

    lines: list[str] = []
    for i, chunk in enumerate(chunks, start=1):
        source_ref = chunk.get("source_ref", "Unknown source")
        text = chunk.get("text", "")

        # Strip the source_ref line from the top of the text if present,
        # since we render it separately in the bracket label.
        text_lines = text.strip().splitlines()
        if text_lines and text_lines[0].strip() == source_ref:
            body = " ".join(text_lines[1:]).strip()
        else:
            body = " ".join(text_lines).strip()

        # Truncate long chunks so the prompt stays manageable
        if len(body) > 300:
            body = body[:297] + "..."

        lines.append(f'[G{i}] {source_ref}: "{body}"')

    return "\n".join(lines)
