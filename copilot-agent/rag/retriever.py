from __future__ import annotations

import logging
from typing import Any

import chromadb
from rank_bm25 import BM25Okapi

from .indexer import GuidelineChunk

logger = logging.getLogger(__name__)

_BM25_CANDIDATES = 20
_DENSE_CANDIDATES = 20
_COHERE_RERANK_MODEL = "rerank-english-v3.0"


def _bm25_top_ids(
    query: str,
    bm25: BM25Okapi,
    chunks: list[GuidelineChunk],
    n: int,
) -> dict[str, float]:
    """Return {chunk_id: normalised_bm25_score} for top-n BM25 hits."""
    tokenized_query = query.lower().split()
    scores: list[float] = bm25.get_scores(tokenized_query).tolist()

    # Pair each chunk with its score, sort descending, take top-n
    ranked = sorted(zip(chunks, scores), key=lambda x: x[1], reverse=True)[:n]

    max_score = ranked[0][1] if ranked else 1.0
    if max_score == 0.0:
        max_score = 1.0

    return {chunk.chunk_id: score / max_score for chunk, score in ranked}


def _dense_top_ids(
    query: str,
    chroma_collection: chromadb.Collection,
    n: int,
) -> dict[str, float]:
    """Return {chunk_id: normalised_cosine_score} for top-n dense hits."""
    results = chroma_collection.query(query_texts=[query], n_results=n)

    ids: list[str] = results["ids"][0] if results["ids"] else []
    distances: list[float] = results["distances"][0] if results["distances"] else []

    # ChromaDB cosine distance is in [0, 2]; convert to similarity in [0, 1]
    id_to_score: dict[str, float] = {}
    for chunk_id, dist in zip(ids, distances):
        id_to_score[chunk_id] = 1.0 - dist / 2.0

    return id_to_score


def _combine_scores(
    bm25_scores: dict[str, float],
    dense_scores: dict[str, float],
    bm25_weight: float = 0.4,
    dense_weight: float = 0.6,
) -> dict[str, float]:
    """Union the two candidate sets and compute a weighted combined score."""
    all_ids = set(bm25_scores) | set(dense_scores)
    combined: dict[str, float] = {}
    for chunk_id in all_ids:
        combined[chunk_id] = (
            bm25_weight * bm25_scores.get(chunk_id, 0.0)
            + dense_weight * dense_scores.get(chunk_id, 0.0)
        )
    return combined


def retrieve(
    query: str,
    bm25: BM25Okapi,
    bm25_chunks: list[GuidelineChunk],
    chroma_collection: chromadb.Collection,
    cohere_client: Any | None,
    top_k: int = 5,
) -> list[dict[str, Any]]:
    """Hybrid BM25 + dense retrieval with optional Cohere reranking.

    Parameters
    ----------
    query:
        The clinical question to search for.
    bm25:
        BM25Okapi index built by ``build_index()``.
    bm25_chunks:
        Ordered list of GuidelineChunks aligned with the BM25 index rows.
    chroma_collection:
        ChromaDB collection populated by ``build_index()``.
    cohere_client:
        Initialised ``cohere.Client`` instance, or ``None`` to skip reranking.
    top_k:
        Number of results to return.

    Returns
    -------
    List of dicts with keys: ``chunk_id``, ``text``, ``source_ref``, ``score``.
    """
    if not query.strip():
        return []

    # Build a lookup from chunk_id → GuidelineChunk for the merge step
    chunk_by_id: dict[str, GuidelineChunk] = {c.chunk_id: c for c in bm25_chunks}

    bm25_scores = _bm25_top_ids(query, bm25, bm25_chunks, _BM25_CANDIDATES)
    dense_scores = _dense_top_ids(query, chroma_collection, _DENSE_CANDIDATES)
    combined = _combine_scores(bm25_scores, dense_scores)

    # Collect the union candidates with their text
    candidates = [
        {
            "chunk_id": cid,
            "text": chunk_by_id[cid].text,
            "source_ref": chunk_by_id[cid].source_ref,
            "score": score,
        }
        for cid, score in combined.items()
        if cid in chunk_by_id
    ]

    if cohere_client is not None:
        return _rerank_with_cohere(query, candidates, cohere_client, top_k)

    # Fall back to score-based truncation when Cohere is unavailable
    candidates.sort(key=lambda x: x["score"], reverse=True)
    return candidates[:top_k]


def _rerank_with_cohere(
    query: str,
    candidates: list[dict[str, Any]],
    cohere_client: Any,
    top_k: int,
) -> list[dict[str, Any]]:
    """Rerank candidates using the Cohere rerank API and return top_k."""
    documents = [c["text"] for c in candidates]

    try:
        response = cohere_client.rerank(
            model=_COHERE_RERANK_MODEL,
            query=query,
            documents=documents,
            top_n=top_k,
        )
    except Exception:
        logger.exception("Cohere rerank failed; falling back to score-based ranking")
        candidates.sort(key=lambda x: x["score"], reverse=True)
        return candidates[:top_k]

    reranked: list[dict[str, Any]] = []
    for hit in response.results:
        candidate = candidates[hit.index]
        reranked.append({
            "chunk_id": candidate["chunk_id"],
            "text": candidate["text"],
            "source_ref": candidate["source_ref"],
            "score": float(hit.relevance_score),
        })

    return reranked
