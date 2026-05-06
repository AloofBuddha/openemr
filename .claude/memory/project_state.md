---
name: W2 Project State
description: Current build status for Week 2 AgentForge Clinical Co-Pilot — what's built vs missing
type: project
---

# Week 2 Build State (as of 2026-05-05)

**Deployed at:** http://198.211.103.246.nip.io (via scripts/deploy.sh — git push + ssh pull)

## What's Built (Week 1 + partial W2 scaffolding)

- PHP module: `public/chat.php` — Week 1 brief flow, SSE streaming, multi-turn, citations, source drawer
- PHP module: `public/upload.php` — stores files in OpenEMR documents table, returns doc ID (no extraction yet)
- UI: `CopilotPanel.tsx` — full chat UI, upload modal (drag-drop), patient snapshot card, citation drawer
- `AgentAuditLogger.php`, `PatientAccessGuard.php`, `Orchestrator.php`, `PatientBriefTool.php`
- Eval harness: `evals/run.py` — ~25 cases (Week 1 brief + multi-turn adversarial), NO W2 cases yet
- `W2_ARCHITECTURE.md` — comprehensive design doc for the sidecar, LangGraph graph, RAG, schemas

## What's NOT Built (W2 Gaps)

### Blocking MVP tonight (Tue 11:59PM):
1. **Python FastAPI sidecar** (`copilot-agent/`) — does not exist yet:
   - `main.py` — FastAPI with `/ingest`, `/query`, `/docs/{id}/page/{n}`
   - `agent/graph.py` — LangGraph supervisor + 2 workers
   - `agent/intake_extractor.py` — pdfplumber text path + Claude Haiku Vision path
   - `agent/evidence_retriever.py` — hybrid BM25 + ChromaDB + Cohere rerank
   - `schemas/lab.py`, `schemas/intake.py`, `schemas/citation.py` — Pydantic models
   - `rag/` — guideline corpus, indexer, retriever
   - `requirements.txt`
2. **upload.php does NOT call sidecar** — stores file but skips extraction step
3. **No agent-query.php** — PHP proxy to sidecar `/query` endpoint missing
4. **UI shows no extraction results** — upload modal marks "done" but never shows extracted data

### Needed for Early Submission (Thu 11:59PM):
5. 50-case eval suite with W2 boolean rubrics (schema_valid, citation_present, factually_consistent, no_phi_in_logs)
6. PR-blocking Git Hook (`.git/hooks/pre-push` running eval suite)
7. Demo video (3-5 min)
8. Cost and latency report

## MVP Minimum (tonight):
- Sidecar `/ingest` endpoint working (pdfplumber text path + basic vision path)
- upload.php calls sidecar after storing file, returns extraction summary
- UI surfaces extraction result (even just a toast or inline confirmation)
- Basic evidence retrieval via `/query` (can be simple, just needs to work)

## Key Design Decisions (from W2_ARCHITECTURE.md):
- Two extraction paths: pdfplumber for digital PDFs (>100 chars text), Claude Haiku Vision for scans/images
- Sidecar runs on localhost:8400, PHP proxies to it
- LangGraph supervisor with max 3 iterations cap
- BM25 (rank-bm25) + ChromaDB + Cohere Rerank for hybrid RAG
- `copilot_documents` table as metadata sidecar to OpenEMR `documents` table

**Why:** W2 adds multimodal ingestion + multi-agent graph. Python sidecar isolates LangGraph/Pydantic/ChromaDB from PHP.
**How to apply:** Build sidecar first — it's the entire critical path for tonight's MVP.
