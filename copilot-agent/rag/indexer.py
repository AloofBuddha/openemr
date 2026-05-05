from __future__ import annotations

import hashlib
import logging
from dataclasses import dataclass
from pathlib import Path

import chromadb
from chromadb.utils import embedding_functions
from rank_bm25 import BM25Okapi

logger = logging.getLogger(__name__)

CORPUS_DIR = Path(__file__).parent / "corpus"
CHROMA_COLLECTION_NAME = "clinical_guidelines"

# Separator token used between chunks inside corpus .txt files
CHUNK_SEPARATOR = "---"


@dataclass(frozen=True)
class GuidelineChunk:
    """A single text chunk from the clinical guideline corpus."""

    chunk_id: str       # SHA-256 of the raw text (first 16 hex chars)
    source_ref: str     # e.g. "[ACC/AHA 2023 §2.1]"
    text: str           # full chunk text including the source_ref line


def _chunk_id(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()[:16]


def _extract_source_ref(text: str) -> str:
    """Return the bracketed source reference from the first line of a chunk.

    Falls back to an empty string if the chunk does not start with '['.
    """
    first_line = text.strip().splitlines()[0] if text.strip() else ""
    if first_line.startswith("["):
        end = first_line.find("]")
        if end != -1:
            return first_line[: end + 1]
    return ""


def _load_chunks(corpus_dir: Path) -> list[GuidelineChunk]:
    """Read every .txt file in corpus_dir and split on CHUNK_SEPARATOR."""
    chunks: list[GuidelineChunk] = []
    txt_files = sorted(corpus_dir.glob("*.txt"))
    if not txt_files:
        logger.warning("No .txt files found in corpus dir: %s", corpus_dir)
        return chunks

    for path in txt_files:
        raw = path.read_text(encoding="utf-8")
        raw_chunks = [c.strip() for c in raw.split(CHUNK_SEPARATOR) if c.strip()]
        for raw_chunk in raw_chunks:
            chunk_id = _chunk_id(raw_chunk)
            source_ref = _extract_source_ref(raw_chunk)
            chunks.append(GuidelineChunk(chunk_id=chunk_id, source_ref=source_ref, text=raw_chunk))

    logger.info("Loaded %d guideline chunks from %d files", len(chunks), len(txt_files))
    return chunks


def _build_bm25(chunks: list[GuidelineChunk]) -> BM25Okapi:
    """Tokenize each chunk and build a BM25 index."""
    tokenized = [chunk.text.lower().split() for chunk in chunks]
    return BM25Okapi(tokenized)


def _build_chroma(
    chunks: list[GuidelineChunk],
) -> chromadb.Collection:
    """Build an in-memory ChromaDB collection with local sentence-transformer embeddings."""
    client = chromadb.EphemeralClient()

    # DefaultEmbeddingFunction uses all-MiniLM-L6-v2 locally — no API key required
    ef = embedding_functions.DefaultEmbeddingFunction()

    collection = client.get_or_create_collection(
        name=CHROMA_COLLECTION_NAME,
        embedding_function=ef,  # type: ignore[arg-type]
        metadata={"hnsw:space": "cosine"},
    )

    if len(chunks) == 0:
        return collection

    # Batch-upsert all chunks
    collection.upsert(
        ids=[c.chunk_id for c in chunks],
        documents=[c.text for c in chunks],
        metadatas=[{"source_ref": c.source_ref} for c in chunks],
    )
    logger.info("ChromaDB collection '%s' built with %d chunks", CHROMA_COLLECTION_NAME, len(chunks))
    return collection


def build_index(
    corpus_dir: Path = CORPUS_DIR,
) -> tuple[BM25Okapi, list[GuidelineChunk], chromadb.Collection]:
    """Load the corpus and build both BM25 and ChromaDB indices.

    Returns
    -------
    bm25:
        BM25Okapi instance aligned with ``bm25_chunks`` by list index.
    bm25_chunks:
        Ordered list of GuidelineChunk objects (same order as BM25 rows).
    chroma_collection:
        ChromaDB collection keyed by chunk_id.
    """
    chunks = _load_chunks(corpus_dir)
    bm25 = _build_bm25(chunks)
    chroma_collection = _build_chroma(chunks)
    return bm25, chunks, chroma_collection
