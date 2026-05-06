"""Clinical Co-Pilot sidecar — FastAPI surface.

Endpoints:
    POST /ingest  — extract structured data from an uploaded document
    POST /query   — run the multi-agent graph and stream the answer as SSE
    GET  /health  — liveness probe

All heavy initialisation (RAG index, Anthropic client, graph compile) lives
in the lifespan context, so this module is cheap to import for tests.
"""
from __future__ import annotations

import base64
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncIterator

import anthropic
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import StreamingResponse

from agent.extractor import extract_document
from agent.graph import build_graph
from api_models import IngestRequest, QueryRequest
from cache import ExtractionCache
from rag.indexer import build_index
from sse import event, stream_text_in_chunks

load_dotenv()
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

_CACHE_DIR = Path("extraction_cache")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Build indices, clients, and the agent graph before serving requests."""
    logger.info("Building RAG index...")
    bm25, bm25_chunks, chroma_collection = build_index()
    logger.info("RAG index built: %d chunks", len(bm25_chunks))

    anthropic_client = anthropic.AsyncAnthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

    cohere_key = os.environ.get("COHERE_API_KEY")
    if cohere_key:
        import cohere
        cohere_client = cohere.ClientV2(cohere_key)
        logger.info("Cohere reranking enabled")
    else:
        cohere_client = None
        logger.info("COHERE_API_KEY not set — using score-based ranking fallback")

    extraction_cache = ExtractionCache(_CACHE_DIR)

    logger.info("Compiling agent graph...")
    graph = build_graph(
        anthropic_client,
        cohere_client,
        bm25,
        bm25_chunks,
        chroma_collection,
        extraction_cache.get,
    )
    logger.info("Agent graph ready")

    app.state.anthropic_client = anthropic_client
    app.state.graph = graph
    app.state.extraction_cache = extraction_cache

    yield


app = FastAPI(title="Clinical Co-Pilot Sidecar", lifespan=lifespan)


@app.post("/ingest")
async def ingest(req: IngestRequest, request: Request) -> dict:
    """Extract structured data from an uploaded document.

    Returns a LabExtraction or IntakeExtraction as JSON. The result is cached
    (memory + disk) so a follow-up ``/query`` referencing this doc_id reuses
    it instead of paying for re-extraction.
    """
    try:
        file_bytes = base64.b64decode(req.file_bytes_b64)
    except Exception as exc:
        raise HTTPException(
            status_code=400, detail="Invalid base64 encoding in file_bytes_b64."
        ) from exc

    try:
        result = await extract_document(
            file_bytes=file_bytes,
            mimetype=req.mimetype,
            doc_type=req.doc_type,
            patient_id=req.patient_id,
            openemr_doc_id=req.openemr_doc_id,
            anthropic_client=request.app.state.anthropic_client,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Extraction failed for doc_id=%d", req.openemr_doc_id)
        raise HTTPException(status_code=500, detail="Document extraction failed.") from exc

    result_dict = result.model_dump()
    request.app.state.extraction_cache.set(req.openemr_doc_id, result_dict)
    logger.info("Cached extraction for doc_id=%d", req.openemr_doc_id)
    return result_dict


@app.post("/query")
async def query(req: QueryRequest, request: Request) -> StreamingResponse:
    """Run the multi-agent graph and stream the answer as SSE.

    Event sequence::

        status      — UI hint while the graph runs
        citations   — JSON {citations: [...]} so PHP can build the source map
        delta       — repeated; small text chunks of the streaming answer
        suggestions — JSON {suggestions: [...]} for follow-up question chips
        done        — terminator
    """
    return StreamingResponse(
        _query_stream(req, request.app.state),
        media_type="text/event-stream",
    )


async def _query_stream(req: QueryRequest, state) -> AsyncIterator[str]:
    pre_extracted, missing_ids = _gather_extractions(req.doc_ids, state.extraction_cache)
    if missing_ids:
        logger.warning("doc_ids not found in any cache (not yet ingested): %s", missing_ids)

    initial_state = {
        "query": req.query,
        "patient_id": req.patient_id,
        "doc_ids": req.doc_ids,
        "extracted_docs": pre_extracted,
        "guideline_chunks": [],
        "patient_context": req.patient_context,
        "answer": "",
        "citations": [],
        "suggestions": [],
        "routing_log": [],
        "iteration": 0,
    }

    yield event("status", {"text": "Searching clinical guidelines..."})

    try:
        result = await state.graph.ainvoke(initial_state)
        answer = result.get("answer") or "I was unable to generate an answer."
        citations = result.get("citations", [])
        suggestions = result.get("suggestions", [])
    except Exception:
        logger.exception("Graph invocation failed for patient_id=%d", req.patient_id)
        answer = "An internal error occurred while processing your query."
        citations = []
        suggestions = []

    yield event("citations", {"citations": citations})
    async for chunk in stream_text_in_chunks(answer):
        yield chunk
    yield event("suggestions", {"suggestions": suggestions})
    yield event("done", "{}")


def _gather_extractions(
    doc_ids: list[int], cache: ExtractionCache
) -> tuple[list[dict], list[int]]:
    """Return (cached_extractions, missing_doc_ids) for the requested docs."""
    found: list[dict] = []
    missing: list[int] = []
    for doc_id in doc_ids:
        data = cache.get(doc_id)
        if data is not None:
            found.append(data)
        else:
            missing.append(doc_id)
    return found, missing


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}
