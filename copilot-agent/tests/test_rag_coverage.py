"""Tests that the RAG corpus covers each demo patient's clinical profile.

These tests build the real index from copilot-agent/rag/corpus/ and ask
the retriever for chunks relevant to questions a physician would ask
about each demo patient. If the corpus drifts out of coverage (a file
deleted, topics not addressed, retriever broken), these tests fail
loudly so we catch the regression before the demo.

No Cohere — we test the BM25+dense fallback path so the test runs
hermetically without an API key.
"""
from __future__ import annotations

import pytest

from rag.indexer import build_index
from rag.retriever import retrieve


@pytest.fixture(scope="module")
def index():
    """Build the corpus index once per module — slow on first call."""
    return build_index()


# Each query maps to a substring expected somewhere in the top-3 chunks.
# We assert text containment (not chunk_id) so corpus edits don't break
# the test as long as the topic is still covered.
DEMO_QUERIES = [
    # Chen — T2DM, hypertension, hyperlipidemia, chest tightness
    ("What's the LDL target for a 58 yo on a statin with diabetes?",
     ["statin", "ldl", "diabetes"]),
    ("Should we titrate Lisinopril given a BP target for diabetes?",
     ["130/80", "diabetes", "ace"]),
    # Whitaker — AFib on apixaban, hyperlipidemia, BPH, dizziness/falls
    ("Apixaban dose adjustment for an older patient with low CrCl?",
     ["apixaban", "2.5 mg", "creatinine"]),
    ("CHA2DS2-VASc score components for stroke risk?",
     ["cha2ds2-vasc", "stroke"]),
    ("Falls risk and anticoagulation in elderly afib patient?",
     ["fall", "anticoagulation"]),
    # Reyes — T2DM, depression on sertraline
    ("PHQ-9 cutoff for moderate depression and treatment options?",
     ["phq-9", "depression"]),
    ("SSRI dosing and follow-up for new depression diagnosis?",
     ["ssri", "sertraline"]),
    # Kowalski — HTN, asthma, alcohol use disorder
    ("Stepwise asthma treatment with frequent SABA use?",
     ["asthma", "ics-formoterol", "step"]),
    ("AUDIT-C score interpretation for alcohol screening?",
     ["audit-c", "alcohol"]),
    ("Brief intervention for unhealthy alcohol use?",
     ["alcohol", "brief intervention"]),
]


@pytest.mark.parametrize("query,expected_terms", DEMO_QUERIES)
def test_demo_query_returns_relevant_chunk(index, query: str, expected_terms: list[str]) -> None:
    """For each demo query, at least one of the top-3 chunks must contain
    one of the expected topical terms. This guards against corpus drift
    (file deleted, topic gap) without coupling the test to specific chunks.
    """
    bm25, chunks, chroma = index
    results = retrieve(query, bm25, chunks, chroma, cohere_client=None, top_k=3)

    assert len(results) >= 1, f"retriever returned 0 chunks for {query!r}"

    top_3_text = " ".join(r["text"].lower() for r in results)
    matched = [t for t in expected_terms if t.lower() in top_3_text]
    assert matched, (
        f"None of {expected_terms!r} found in top-3 chunks for {query!r}.\n"
        f"Top hits: {[r['source_ref'] for r in results]}"
    )


def test_corpus_covers_required_topics(index) -> None:
    """Every demo-relevant topic should be represented somewhere in the corpus."""
    bm25, chunks, chroma = index
    all_text = " ".join(c.text.lower() for c in chunks)
    required = [
        # Chen: HTN, DM, lipids
        "lisinopril", "metformin", "statin", "ldl",
        # Whitaker: AFib, anticoag
        "apixaban", "cha2ds2-vasc",
        # Kowalski: asthma, alcohol
        "asthma", "ics-formoterol", "audit-c",
        # Reyes: depression
        "phq-9", "ssri",
        # Preventive
        "screening",
    ]
    missing = [term for term in required if term not in all_text]
    assert not missing, f"Corpus missing topics: {missing}"


def test_chunks_have_source_refs(index) -> None:
    """Every chunk should carry a [Source §X] header — that's how citations
    point back to the guideline. A chunk without source_ref produces a
    citation with an empty page_or_section, breaking the contract."""
    _, chunks, _ = index
    no_source = [c for c in chunks if not c.source_ref]
    assert not no_source, (
        f"{len(no_source)} chunks have no source_ref. First: "
        f"{no_source[0].text[:80]!r}"
    )


def test_corpus_has_grown_beyond_baseline(index) -> None:
    """Sanity: we should have meaningfully more chunks than the W1 baseline
    (3 files × ~14 chunks = ~42). Below this, the demo will hit gaps."""
    _, chunks, _ = index
    assert len(chunks) >= 60, (
        f"Corpus only has {len(chunks)} chunks — expand to cover "
        f"AFib, asthma, mental health, cholesterol topics."
    )
