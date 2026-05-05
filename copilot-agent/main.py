from __future__ import annotations

import base64
import json
import logging
import os

import anthropic
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Clinical Co-Pilot Sidecar")

# ---------------------------------------------------------------------------
# Startup: build RAG index and compile agent graph
# ---------------------------------------------------------------------------

from rag.indexer import build_index

logger.info("Building RAG index...")
bm25, bm25_chunks, chroma_collection = build_index()
logger.info("RAG index built: %d chunks", len(bm25_chunks))

# Clients
anthropic_client = anthropic.AsyncAnthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

_cohere_key = os.environ.get("COHERE_API_KEY")
if _cohere_key:
    import cohere
    cohere_client = cohere.ClientV2(_cohere_key)
    logger.info("Cohere reranking enabled")
else:
    cohere_client = None
    logger.info("COHERE_API_KEY not set — using score-based ranking fallback")

from agent.graph import build_graph

logger.info("Compiling agent graph...")
graph = build_graph(anthropic_client, cohere_client, bm25, bm25_chunks, chroma_collection)
logger.info("Agent graph ready")

# In-memory extraction cache: openemr_doc_id -> extraction result dict
# Populated by /ingest, read by /query to pre-fill extracted_docs.
_extraction_cache: dict[int, dict] = {}


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------


class IngestRequest(BaseModel):
    patient_id: int
    openemr_doc_id: int
    doc_type: str        # "lab_pdf" or "intake_form"
    file_bytes_b64: str  # base64-encoded file bytes
    mimetype: str


class QueryRequest(BaseModel):
    patient_id: int
    query: str
    patient_context: str    # pre-built context string from PHP
    doc_ids: list[int] = [] # openemr_doc_ids of recently uploaded docs


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@app.post("/ingest")
async def ingest(req: IngestRequest):
    """Extract structured data from an uploaded document.

    Accepts base64-encoded file bytes, runs Claude extraction (text or vision
    path depending on content), and returns a LabExtraction or IntakeExtraction
    as JSON.
    """
    from agent.intake_extractor import extract_document

    if req.doc_type not in ("lab_pdf", "intake_form"):
        raise HTTPException(
            status_code=400,
            detail=f"Unknown doc_type '{req.doc_type}'. Must be 'lab_pdf' or 'intake_form'.",
        )

    try:
        file_bytes = base64.b64decode(req.file_bytes_b64)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid base64 encoding in file_bytes_b64.") from exc

    try:
        result = await extract_document(
            file_bytes=file_bytes,
            mimetype=req.mimetype,
            doc_type=req.doc_type,
            patient_id=req.patient_id,
            openemr_doc_id=req.openemr_doc_id,
            anthropic_client=anthropic_client,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Extraction failed for doc_id=%d", req.openemr_doc_id)
        raise HTTPException(status_code=500, detail="Document extraction failed.") from exc

    result_dict = result.model_dump()
    _extraction_cache[req.openemr_doc_id] = result_dict
    logger.info("Cached extraction for doc_id=%d", req.openemr_doc_id)
    return result_dict


@app.post("/query")
async def query(req: QueryRequest):
    """Run the multi-agent LangGraph pipeline and stream the answer as SSE.

    Events emitted:
        event: answer  — JSON with {text, routing_log}
        event: done    — empty payload, signals stream end
    """
    async def event_stream():
        # Pre-populate extracted_docs from ingest cache so the graph can use them
        pre_extracted = [
            _extraction_cache[doc_id]
            for doc_id in req.doc_ids
            if doc_id in _extraction_cache
        ]
        missing_ids = [d for d in req.doc_ids if d not in _extraction_cache]
        if missing_ids:
            logger.warning("doc_ids not in extraction cache (not yet ingested): %s", missing_ids)

        state = {
            "query": req.query,
            "patient_id": req.patient_id,
            "doc_ids": req.doc_ids,
            "extracted_docs": pre_extracted,
            "guideline_chunks": [],
            "patient_context": req.patient_context,
            "answer": "",
            "citations": [],
            "routing_log": [],
            "iteration": 0,
        }

        try:
            result = await graph.ainvoke(state)
            answer = result.get("answer") or "I was unable to generate an answer."
            routing_log = result.get("routing_log", [])
            citations = result.get("citations", [])
        except Exception:
            logger.exception("Graph invocation failed for patient_id=%d", req.patient_id)
            answer = "An internal error occurred while processing your query."
            routing_log = []
            citations = []

        payload = json.dumps({"text": answer, "routing_log": routing_log, "citations": citations})
        yield f"event: answer\ndata: {payload}\n\n"
        yield "event: done\ndata: {}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@app.get("/health")
def health():
    return {"status": "ok"}
