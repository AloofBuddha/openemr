"""Tests for rag/retriever.py — score combination + end-to-end retrieve()."""
from __future__ import annotations

from pathlib import Path

import pytest

from rag.indexer import build_index
from rag.retriever import _combine_scores, retrieve


# ---------------------------------------------------------------------------
# _combine_scores — pure function, fast tests
# ---------------------------------------------------------------------------


def test_combine_scores_weighted_sum() -> None:
    """Combined score = bm25_weight * bm25 + dense_weight * dense."""
    bm25 = {"a": 1.0, "b": 0.5}
    dense = {"a": 0.8, "b": 0.2}
    combined = _combine_scores(bm25, dense, bm25_weight=0.4, dense_weight=0.6)
    # a: 0.4*1.0 + 0.6*0.8 = 0.88
    # b: 0.4*0.5 + 0.6*0.2 = 0.32
    assert combined["a"] == pytest.approx(0.88)
    assert combined["b"] == pytest.approx(0.32)


def test_combine_scores_takes_union_of_candidates() -> None:
    """Chunk found by only one retriever still appears, scored against 0 in the other."""
    bm25 = {"only_bm25": 1.0}
    dense = {"only_dense": 1.0}
    combined = _combine_scores(bm25, dense, bm25_weight=0.5, dense_weight=0.5)
    assert set(combined) == {"only_bm25", "only_dense"}
    assert combined["only_bm25"] == pytest.approx(0.5)
    assert combined["only_dense"] == pytest.approx(0.5)


def test_combine_scores_pure_bm25_when_dense_weight_is_zero() -> None:
    """With dense_weight=0, the combined ranking equals BM25 ranking."""
    bm25 = {"a": 0.9, "b": 0.4}
    dense = {"a": 0.1, "b": 0.95}  # dense disagrees strongly
    combined = _combine_scores(bm25, dense, bm25_weight=1.0, dense_weight=0.0)
    # Ranking should follow BM25
    ranked = sorted(combined.items(), key=lambda kv: kv[1], reverse=True)
    assert [r[0] for r in ranked] == ["a", "b"]


def test_combine_scores_returns_empty_for_empty_inputs() -> None:
    assert _combine_scores({}, {}) == {}


# ---------------------------------------------------------------------------
# retrieve() — short-circuit
# ---------------------------------------------------------------------------


def test_retrieve_returns_empty_for_blank_query() -> None:
    """A blank/whitespace query short-circuits without calling the indices."""
    # Pass None/empty arguments — they shouldn't be accessed.
    result = retrieve(
        query="   ",
        bm25=None,  # type: ignore[arg-type]
        bm25_chunks=[],
        chroma_collection=None,  # type: ignore[arg-type]
        cohere_client=None,
    )
    assert result == []


# ---------------------------------------------------------------------------
# retrieve() — integration with a small fake corpus
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def small_index(tmp_path_factory: pytest.TempPathFactory) -> tuple:
    """Build a real BM25 + ChromaDB index over a 3-chunk fake corpus.

    Module-scoped because building the ChromaDB embedding model is slow
    (loads sentence-transformer weights on first call).
    """
    corpus = tmp_path_factory.mktemp("corpus")
    (corpus / "guidelines.txt").write_text(
        "[DIABETES §1]\n"
        "For adults with type 2 diabetes the target HbA1c is less than 7 percent.\n"
        "---\n"
        "[BP §1]\n"
        "Blood pressure target for most adults is below 130 over 80 mmHg.\n"
        "---\n"
        "[VACCINE §1]\n"
        "Annual influenza vaccine is recommended for all adults age 18 and older.",
        encoding="utf-8",
    )
    bm25, chunks, collection = build_index(corpus_dir=corpus)
    return bm25, chunks, collection


def test_retrieve_finds_diabetes_chunk_for_diabetes_query(small_index: tuple) -> None:
    """A query about HbA1c targets must rank the diabetes chunk first."""
    bm25, chunks, collection = small_index
    results = retrieve(
        query="What is the target HbA1c for a diabetic patient?",
        bm25=bm25,
        bm25_chunks=chunks,
        chroma_collection=collection,
        cohere_client=None,
        top_k=3,
    )
    assert len(results) >= 1
    assert results[0]["source_ref"] == "[DIABETES §1]"


def test_retrieve_finds_vaccine_chunk_for_vaccine_query(small_index: tuple) -> None:
    """Different query, different top result — confirms ranking is query-dependent."""
    bm25, chunks, collection = small_index
    results = retrieve(
        query="Which vaccines should adults receive each year?",
        bm25=bm25,
        bm25_chunks=chunks,
        chroma_collection=collection,
        cohere_client=None,
        top_k=3,
    )
    assert results[0]["source_ref"] == "[VACCINE §1]"


def test_retrieve_respects_top_k(small_index: tuple) -> None:
    bm25, chunks, collection = small_index
    results = retrieve(
        query="diabetes blood pressure vaccine",
        bm25=bm25,
        bm25_chunks=chunks,
        chroma_collection=collection,
        cohere_client=None,
        top_k=2,
    )
    assert len(results) == 2


def test_retrieve_returns_well_formed_results(small_index: tuple) -> None:
    """Each result has the documented keys: chunk_id, text, source_ref, score."""
    bm25, chunks, collection = small_index
    results = retrieve(
        query="diabetes target",
        bm25=bm25,
        bm25_chunks=chunks,
        chroma_collection=collection,
        cohere_client=None,
        top_k=1,
    )
    assert len(results) == 1
    r = results[0]
    assert set(r.keys()) == {"chunk_id", "text", "source_ref", "score"}
    assert isinstance(r["score"], float)
