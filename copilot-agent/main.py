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
import io
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, AsyncIterator

import anthropic
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import StreamingResponse

from agent.extractor import extract_document
from schemas.other import OtherExtraction
from agent.graph import build_graph
from api_models import IngestRequest, QueryRequest
from cache import ExtractionCache, render_pdf_pages_to_cache
from patient_index import PatientIntakeIndex
from rag.indexer import build_index
from sse import event, stream_text_in_chunks

load_dotenv()
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

_CACHE_DIR = Path("extraction_cache")
_INDEX_DIR = Path("patient_intake_index")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Build indices, clients, and the agent graph before serving requests."""
    logger.info("Building RAG index...")
    bm25, bm25_chunks, chroma_collection = build_index()
    logger.info("RAG index built: %d chunks", len(bm25_chunks))

    anthropic_client = anthropic.AsyncAnthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

    # LangSmith integration: when LANGCHAIN_TRACING_V2=true and a key is set,
    # wrap the Anthropic client so every messages.create call shows up in
    # the LangSmith dashboard with full prompts, responses, token usage,
    # and a cost estimate. LangGraph nodes are auto-traced separately, so
    # the wrapped LLM calls nest cleanly inside the supervisor / answer
    # assembler node spans. No-op when the env vars aren't set.
    if os.environ.get("LANGCHAIN_TRACING_V2", "").lower() == "true" \
            and os.environ.get("LANGCHAIN_API_KEY"):
        from langsmith.wrappers import wrap_anthropic
        anthropic_client = wrap_anthropic(anthropic_client)
        logger.info(
            "LangSmith tracing enabled (project=%s)",
            os.environ.get("LANGCHAIN_PROJECT", "default"),
        )
    else:
        logger.info("LangSmith tracing disabled (set LANGCHAIN_API_KEY + LANGCHAIN_TRACING_V2=true)")

    cohere_key = os.environ.get("COHERE_API_KEY")
    if cohere_key:
        import cohere
        cohere_client = cohere.ClientV2(cohere_key)
        logger.info("Cohere reranking enabled")
    else:
        cohere_client = None
        logger.info("COHERE_API_KEY not set — using score-based ranking fallback")

    extraction_cache = ExtractionCache(_CACHE_DIR)
    patient_index = PatientIntakeIndex(_INDEX_DIR)

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
    app.state.patient_index = patient_index

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

    # extract_document never raises for known doc_types — it returns OtherExtraction
    # on graceful failure. Only a ValueError (unknown type) escapes as 400.
    try:
        result = await extract_document(
            file_bytes=file_bytes,
            mimetype=req.mimetype,
            doc_type=req.doc_type,
            patient_id=req.patient_id,
            openemr_doc_id=req.openemr_doc_id,
            anthropic_client=request.app.state.anthropic_client,
            doc_name=req.doc_name,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Extraction failed for doc_id=%d — returning OtherExtraction", req.openemr_doc_id)
        result = OtherExtraction(
            doc_type="other",
            patient_id=req.patient_id,
            openemr_doc_id=req.openemr_doc_id,
            extraction_warnings=["Unexpected extraction error; document stored but not parsed."],
        )

    result_dict = result.model_dump()
    request.app.state.extraction_cache.set(req.openemr_doc_id, result_dict)
    logger.info("Cached extraction for doc_id=%d (doc_type=%s)", req.openemr_doc_id, result_dict.get("doc_type"))

    # Render every PDF page as PNG into the cache so the UI can fetch the
    # image and overlay the citation bbox. PDFs only — single-image uploads
    # don't need rendering. Failure here doesn't fail the ingest.
    if req.mimetype == "application/pdf":
        try:
            pages = render_pdf_pages_to_cache(_CACHE_DIR, req.openemr_doc_id, file_bytes)
            logger.info("Rendered %d page(s) for doc_id=%d", pages, req.openemr_doc_id)
        except Exception:
            logger.exception("Page-render cache failed for doc_id=%d", req.openemr_doc_id)

    if req.doc_type == "intake_form":
        request.app.state.patient_index.register(
            req.patient_id, req.openemr_doc_id, req.doc_name
        )

    return result_dict


@app.post("/query")
async def query(req: QueryRequest, request: Request) -> StreamingResponse:
    """Run the multi-agent graph and stream the answer as SSE.

    Event sequence::

        status      — UI hint while the graph runs
        provenance  — JSON {text: "Reviewed: ..."} natural-language source summary
        citations   — JSON {citations: [...]} so PHP can build the source map
        delta       — repeated; small text chunks of the streaming answer
        suggestions — JSON {suggestions: [...]} for follow-up question chips
        routing     — JSON {routing_log: [...]} supervisor + worker decisions
                      (developer-only; UI hides this unless ?debug=1)
        done        — terminator
    """
    return StreamingResponse(
        _query_stream(req, request.app.state),
        media_type="text/event-stream",
    )


async def _query_stream(req: QueryRequest, state) -> AsyncIterator[str]:
    answer = "An internal error occurred while processing your query."
    citations: list = []
    suggestions: list = []
    routing_log: list = []
    provenance: str = ""

    try:
        # Pull in any intake forms uploaded (e.g. by front desk) but not yet seen by the agent.
        unprocessed = state.patient_index.get_unprocessed(req.patient_id)
        if unprocessed:
            extra_ids = [item["doc_id"] for item in unprocessed]
            logger.info(
                "Auto-including %d unprocessed intake form(s) for patient_id=%d: %s",
                len(extra_ids), req.patient_id, extra_ids,
            )
            for item in unprocessed:
                state.patient_index.mark_processed(req.patient_id, item["doc_id"])
            all_doc_ids = list(set(req.doc_ids + extra_ids))
        else:
            all_doc_ids = req.doc_ids

        pre_extracted, missing_ids = _gather_extractions(all_doc_ids, state.extraction_cache)
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

        # Status text walks alongside the supervisor's decisions. The
        # supervisor decides which worker runs next, and we emit a status
        # message reflecting that worker — so a query asking for guidelines
        # transitions through "Searching clinical guidelines..." even if a
        # document was also uploaded, and a query that processes both an
        # intake form and the guideline corpus shows two distinct phases.
        # Without this, the user stares at "Analyzing document..." for the
        # entire run even when most of the time is spent in RAG.
        yield event("status", {"text": "Routing query..."})

        worker_status = {
            "intake_extractor":   "Reviewing patient documents...",
            "evidence_retriever": "Searching clinical guidelines...",
            "answer_assembler":   "Drafting answer...",
        }

        result: dict = {}
        async for snapshot in state.graph.astream(initial_state, stream_mode="values"):
            result = snapshot
            decision = snapshot.get("_supervisor_decision") or {}
            workers = decision.get("next_workers") or []
            for worker in workers:
                if worker in worker_status:
                    yield event("status", {"text": worker_status[worker]})
                    break

        answer = result.get("answer") or "I was unable to generate an answer."
        citations = result.get("citations", [])
        suggestions = result.get("suggestions", [])
        routing_log = result.get("routing_log", [])
        provenance = result.get("provenance", "")

    except BaseException:
        # Catch CancelledError (from asyncio task cancellation) and any other
        # unexpected exception so we always emit a done event to the PHP proxy.
        logger.exception("Query stream failed for patient_id=%d", req.patient_id)

    if provenance:
        yield event("provenance", {"text": provenance})
    yield event("citations", {"citations": citations})
    async for chunk in stream_text_in_chunks(answer):
        yield chunk
    yield event("suggestions", {"suggestions": suggestions})
    yield event("routing", {"routing_log": _scrub_routing_log(routing_log)})
    yield event("done", "{}")


def _scrub_routing_log(routing_log: list[dict]) -> list[dict]:
    """Remove the supervisor's free-text reasoning before emitting the log.

    Haiku's reasoning string occasionally includes a paraphrase of the
    physician's query, which can carry PHI through to the UI. Keep the
    machine-readable parts (intent, next_workers, durations, counts,
    tokens, cost) — drop the free-text. The structured intent +
    next_workers list is sufficient to render an audit trace.
    """
    scrubbed: list[dict] = []
    for step in routing_log:
        decision = dict(step.get("decision") or {})
        decision.pop("reasoning", None)
        scrubbed.append({
            "node": step.get("node"),
            "decision": decision,
            "duration_ms": step.get("duration_ms"),
            "tokens": step.get("tokens"),
            "cost_usd": step.get("cost_usd"),
            "model": step.get("model"),
        })
    return scrubbed


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


@app.get("/docs/{doc_id}/page/{page_num}")
def doc_page_image(
    doc_id: int,
    page_num: int,
    x0: float | None = None,
    y0: float | None = None,
    x1: float | None = None,
    y1: float | None = None,
    pw: float | None = None,
    ph: float | None = None,
) -> Any:
    """Return the cached PNG for a given page of an extracted PDF.

    When all six bbox query params are supplied, returns a cropped region
    around the bbox with the cited area highlighted in yellow — that's
    what the citation source drawer asks for. Without them, returns the
    full page (legacy callers + dev tools).

    The PHP module proxies this through; the sidecar is never reachable
    from outside.
    """
    from fastapi.responses import FileResponse, Response
    path = _CACHE_DIR / f"{doc_id}_page{page_num}.png"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Page image not in cache")

    bbox_args = (x0, y0, x1, y1, pw, ph)
    if all(v is not None for v in bbox_args):
        try:
            png = _crop_with_highlight(path, x0, y0, x1, y1, pw, ph)  # type: ignore[arg-type]
            return Response(content=png, media_type="image/png")
        except Exception:
            logger.exception("Crop failed for doc=%d page=%d, falling back to full page",
                             doc_id, page_num)
            # Fall through to full-page render

    return FileResponse(str(path), media_type="image/png")


def _crop_with_highlight(
    png_path: Path,
    x0_pdf: float, y0_pdf: float, x1_pdf: float, y1_pdf: float,
    page_w_pdf: float, page_h_pdf: float,
    padding_pct: float = 0.04,
) -> bytes:
    """Crop a region of the cached page PNG around the given PDF bbox and
    draw a yellow rectangle on the cited area. Returns PNG bytes.

    The bbox is in PDF coords (origin bottom-left, points). The PNG was
    rendered at 150 DPI, so its pixel dimensions are page_size * 150/72.
    We compute the scale from the actual PNG size (robust to render-DPI
    changes) and convert to image-pixel coords (origin top-left).

    Padding is added so the cropped region has visual context around the
    cited value rather than a tight cut.
    """
    from PIL import Image, ImageDraw

    with Image.open(png_path) as src:
        img = src.convert("RGBA")
    img_w, img_h = img.size

    sx = img_w / page_w_pdf
    sy = img_h / page_h_pdf

    px_x0 = x0_pdf * sx
    px_x1 = x1_pdf * sx
    # PDF y-origin is bottom; image y-origin is top — flip.
    px_y0 = (page_h_pdf - y1_pdf) * sy
    px_y1 = (page_h_pdf - y0_pdf) * sy

    # Padding: at least 60 px or padding_pct of the larger image dimension.
    pad = max(60.0, max(img_w, img_h) * padding_pct)
    crop_x0 = max(0.0, px_x0 - pad)
    crop_y0 = max(0.0, px_y0 - pad * 1.5)  # extra room above for context
    crop_x1 = min(float(img_w), px_x1 + pad)
    crop_y1 = min(float(img_h), px_y1 + pad)

    # Defensive: if the bbox is degenerate or off-page, return the whole page
    # rather than a 0-size crop.
    if crop_x1 - crop_x0 < 10 or crop_y1 - crop_y0 < 10:
        crop = img
        rect_offset_x = 0.0
        rect_offset_y = 0.0
    else:
        crop = img.crop((int(crop_x0), int(crop_y0), int(crop_x1), int(crop_y1)))
        rect_offset_x = crop_x0
        rect_offset_y = crop_y0

    draw = ImageDraw.Draw(crop)
    rect = (
        px_x0 - rect_offset_x,
        px_y0 - rect_offset_y,
        px_x1 - rect_offset_x,
        px_y1 - rect_offset_y,
    )
    # Translucent yellow fill + solid yellow outline. Width 3 px reads
    # well at the drawer's typical 200–500 px width.
    draw.rectangle(rect, outline=(247, 178, 0, 255), width=3)

    buf = io.BytesIO()
    crop.convert("RGB").save(buf, format="PNG", optimize=True)
    return buf.getvalue()


@app.get("/patients/{pid}/unprocessed-intakes")
def unprocessed_intakes(pid: int, request: Request) -> dict:
    """Return intake forms that have been ingested but not yet processed by the agent."""
    entries = request.app.state.patient_index.get_unprocessed(pid)
    return {"intakes": entries}


@app.post("/patients/{pid}/intakes/process-pending")
def process_pending_intakes(pid: int, request: Request) -> dict:
    """Retrieve extractions for all unprocessed intake forms, mark them processed.

    Called by the PHP proxy at copilot startup so the UI can display what was
    found and update the patient snapshot before the initial brief runs.
    """
    unprocessed = request.app.state.patient_index.get_unprocessed(pid)
    if not unprocessed:
        return {"processed": []}

    result = []
    for item in unprocessed:
        extraction = request.app.state.extraction_cache.get(item["doc_id"])
        if extraction is not None:
            request.app.state.patient_index.mark_processed(pid, item["doc_id"])
            result.append({
                "doc_id": item["doc_id"],
                "doc_name": item["doc_name"],
                "extraction": extraction,
            })
        else:
            logger.warning(
                "Intake doc_id=%d for pid=%d has no cached extraction; skipping",
                item["doc_id"], pid,
            )

    return {"processed": result}
