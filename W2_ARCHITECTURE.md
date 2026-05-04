# W2 Architecture: Multimodal Evidence Agent

**Sprint:** Week 2 — AgentForge Clinical Co-Pilot
**Date:** 2026-05-04
**Builds on:** `ARCHITECTURE.md` (Week 1 single-agent brief)
**Traces to:** `USERS.md` UC-1 (pre-encounter brief), UC-2 (medication review), UC-4 (lab trends)

---

## Executive Summary

Week 1 delivered a single-agent system: a PHP orchestrator reads structured OpenEMR data, calls Claude, and streams a cited pre-encounter brief to the physician. The verification model is strong — every claim is pinned to a numbered source record — but the agent is blind to the unstructured documents that carry the most clinically relevant recent information: scanned lab reports and intake forms uploaded by front-desk staff.

Week 2 adds three capabilities on top of that foundation without replacing it.

**Capability 1 — Document ingestion with schema-validated extraction.** A new `attach_and_extract` tool accepts a file (lab PDF or intake form), converts pages to images, sends each to Claude Vision, and forces the raw output through a Pydantic schema before any extracted fact is stored or surfaced. Schema validation is the primary defense against VLM hallucination — a field that cannot be read with sufficient confidence is emitted as `null` with a warning, not silently invented. Every extracted fact links back to a source document page so the physician can verify against the original scan.

**Capability 2 — Hybrid RAG with rerank over a clinical-guideline corpus.** A small corpus of primary-care guidelines (ACC/AHA hypertension, ADA diabetes standards, USPSTF preventive care) is indexed with both BM25 keyword retrieval and dense embeddings. When the supervisor determines a query requires guideline evidence, the evidence-retriever worker runs a hybrid search, reranks candidates via Cohere Rerank, and returns cited snippets to the answer model. Guideline evidence and patient-record facts are always two distinct citation types — never mixed in the same claim.

**Capability 3 — Multi-agent orchestration with logged handoffs.** A LangGraph supervisor receives the physician's query and current patient context, then decides: does this need document extraction? Evidence retrieval? Or is the existing record data sufficient? The routing decision is a logged, structured JSON output from a named node — not an implicit choice buried in a prompt. Each worker (intake-extractor, evidence-retriever) has one narrow responsibility.

**The architectural shift from Week 1:** Week 1 runs entirely in PHP. Week 2 adds a Python FastAPI sidecar that owns the multi-agent graph, document extraction, and RAG. The PHP module continues to serve the Week 1 brief flow unchanged and proxies document-related queries to the sidecar. This keeps the Week 1 surface stable while enabling the Python ecosystem (LangGraph, Pydantic, ChromaDB, rank-bm25, Cohere) Week 2 requires.

**The eval gate is not optional.** 50 boolean-rubric eval cases with a PR-blocking Git Hook are part of the deliverable. During grading, a regression will be injected and the gate must catch it.

---

## 1. System Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                         OpenEMR UI                               │
│  ┌──────────────────┐   ┌────────────────────────────────────┐   │
│  │  Existing Chart  │   │  Co-Pilot Panel (React/TypeScript) │   │
│  │  View / Workflow │   │  - Streaming brief (Week 1)        │   │
│  │                  │   │  - Document upload widget (Week 2) │   │
│  └──────────────────┘   │  - Citation overlay + PDF preview  │   │
└──────────────────────────────────────────────────────────────────┘
                                     │ HTTP (same origin)
                           ┌─────────▼──────────┐
                           │   PHP Module       │
                           │   /api/copilot/    │
                           │   chat   → W1 path │
                           │   upload → W2 path │
                           └────┬──────────┬────┘
                                │          │
              ┌─────────────────┘          └──────────────────────┐
              │ W1: brief path                   W2: agent path   │
              ▼                                                    ▼
  ┌──────────────────────┐               ┌────────────────────────────────┐
  │  PHP Orchestrator    │               │  Python FastAPI Sidecar        │
  │  (Week 1 unchanged)  │               │  :8400 (internal only)         │
  │                      │               │                                │
  │  PatientBriefTool    │               │  POST /ingest                  │
  │  AgentAuditLogger    │               │  POST /query                   │
  │  SSE streaming       │               │  GET  /docs/{id}/page/{n}      │
  └──────────────────────┘               └──────────┬─────────────────────┘
              │                                     │
              │                          ┌──────────▼─────────────────────┐
              │                          │      LangGraph Agent Graph     │
              │                          │                                │
              │                          │  ┌────────────┐                │
              │                          │  │ Supervisor │                │
              │                          │  │  (router)  │                │
              │                          │  └──┬──────┬──┘                │
              │                          │     │      │                   │
              │                     ┌────▼──┐ ┌▼──────────────┐           │
              │                     │Intake │ │  Evidence     │           │
              │                     │Extrac-│ │  Retriever    │           │
              │                     │tor    │ │  Worker       │           │
              │                     └───┬───┘ └──────┬────────┘           │
              │                         │            │                    │
              │                    ┌────▼────────────▼────┐               │
              │                    │   Answer Assembler   │               │
              │                    │  (Claude, grounded)  │               │
              │                    └──────────────────────┘               │
              │                                     │                     │
              └──────┬──────────────────────────────┘                     │
                     │                                                    │
         ┌───────────▼────────────────────────────────────────────────┐   │
         │                     OpenEMR / MariaDB                      │   │
         │  patient_data · documents · copilot_audit_log              │   │
         │  copilot_documents (metadata) · procedure_result           │   │
         └────────────────────────────────────────────────────────────┘   │
                                                                          │
         ┌─────────────────────────────────────────────────────────────┐  │
         │              Local Vector + Keyword Index                   │◄─┘
         │  ChromaDB (dense embeddings)  +  BM25 (rank-bm25)           │
         │  Cohere Rerank  ·  ~50 guideline chunks  ·  no PHI          │
         └─────────────────────────────────────────────────────────────┘
```

---

## 2. Week 1 / Week 2 Boundary

The PHP module continues to own the existing brief flow exactly as built in Week 1. No existing code is modified. Week 2 adds two new PHP endpoints that proxy to the Python sidecar:

| Endpoint | Owner | Flow |
|---|---|---|
| `POST /api/copilot/chat` | PHP (existing) | Week 1 brief + follow-up, SSE stream |
| `POST /api/copilot/upload` | PHP only | Stores file in OpenEMR, returns `openemr_doc_id`, triggers sidecar extraction |
| `POST /api/copilot/agent-query` | PHP → Python sidecar | Multi-agent query with RAG, returns SSE |

The sidecar runs on `localhost:8400` and is not reachable from outside the OpenEMR server. The PHP layer validates the OpenEMR session and passes a signed patient context to the sidecar — the sidecar never reads `$_SESSION` or the OpenEMR auth layer directly.

---

## 3. Document Ingestion Flow

### 3.1 OpenEMR's Existing Document Store

OpenEMR ships with a complete document management system. We use it rather than building a parallel one.

**How it works:**
- `Document::createDocument()` in `library/classes/Document.class.php` accepts a file, writes it to disk, and inserts the `documents` row in one call.
- **Files on disk:** `$OE_SITE_DIR/sites/default/documents/{patient_id}/{drive_uuid}` — patient-scoped, outside the web root, optional AES encryption via `drive_encryption` config.
- **`documents` table** stores `foreign_id` (patient PID), `mimetype`, `name`, SHA3-512 `hash`, `drive_uuid`, and `encounter_id`. The hash is how OpenEMR deduplicates re-uploads of the same file.
- **FHIR round-trip:** every stored document is automatically accessible as a `DocumentReference` resource at `/fhir/Binary/{uuid}` — no extra work required for FHIR compliance.
- **Category system:** documents are organized hierarchically. We register a "Co-Pilot Uploads" category at first-run and file all agent-ingested documents under it.
- **Retrieval:** `Document->get_data()` returns decrypted file bytes regardless of storage method; `Document->get_filesystem_filepath()` returns the absolute path on disk.

**We do not build our own file storage.** The PHP upload handler calls `Document::createDocument()` and gets back an OpenEMR `document_id`. That ID drives everything downstream.

### 3.2 Document Taxonomy (from example corpus)

Reviewing the actual example documents reveals two distinct input classes that warrant different extraction paths:

| Class | Examples | Characteristic |
|---|---|---|
| **Digital PDF** | Chen lipid panel, Whitaker CBC, Kowalski CMP, Chen intake, Whitaker intake | Real text layer — `pdfplumber` extracts text directly |
| **Image file** | Reyes HbA1c (dark-background photo), Reyes intake (clean scan), Kowalski intake (angled photo, rubber stamp, handwritten checkboxes) | No text layer — vision model required |

5 of the 8 example documents are digital PDFs. The digital intake forms (Chen, Whitaker) have RxNorm and SNOMED codes embedded in the text — free structured data we'd lose by going through a vision model unnecessarily.

### 3.3 Two-Path Extraction

**Path A — Digital PDFs (text layer present)**

`pdfplumber` extracts per-page text and character-level bounding boxes. The text goes to **Claude Haiku** (text-only) for structured field extraction. This is ~10× cheaper than sending images to a vision model and more accurate because there is no OCR step to introduce errors. The `CO₂` artifact (`CO&sub2;` in raw PDF text) is an example of why an LLM still sits on this path — Haiku normalises encoding artifacts without special-casing.

**Path B — Image files and image-only PDF pages**

**Claude Haiku Vision** (not Sonnet). The example images are printed forms — clean enough that Haiku Vision handles them reliably. Haiku Vision is ~6× cheaper per image token than Sonnet. The only genuinely hard case is the Kowalski ER intake: angled perspective, rubber stamp overlay, handwritten checkbox marks. Haiku Vision gets the field values right even on this; bounding boxes for the citation overlay are approximate and fall back to page-level highlight with a warning.

Upgrade to Sonnet Vision only if eval results show Haiku missing fields on image cases — don't start there.

**Path detection logic:**

```python
def extraction_path(file_bytes: bytes, mimetype: str) -> Literal["text", "vision"]:
    if mimetype == "application/pdf":
        text = pdfplumber_extract(file_bytes)
        return "text" if len(text.strip()) > 100 else "vision"
    return "vision"  # PNG / JPG always vision
```

### 3.4 Upload and Extraction Flow

```
Browser drag-drop / file picker
        │
        ▼
  POST /api/copilot/upload  (PHP)
  ├── Session auth + PatientAccessGuard
  ├── Validate file type (PDF / PNG / JPG only)
  ├── Document::createDocument(
  │       patient_id, category_id="Co-Pilot Uploads",
  │       filename, mimetype, file_bytes)
  │   — dedup: SHA3-512 hash match → return existing doc_id
  └── Returns {openemr_doc_id, doc_uuid}
        │
        ▼
  PHP reads file bytes via Document->get_data()
  POST to Python sidecar /ingest
  {patient_id, openemr_doc_id, doc_type, file_bytes_b64, mimetype}
        │
        ▼
  Python: detect extraction path
  ├── PDF with text layer  → pdfplumber text + bounding boxes
  │                           → Claude Haiku (text-only) → raw JSON
  └── Image / scan         → Claude Haiku Vision → raw JSON
        │
        ▼
  Pydantic schema validation
  (ValidationError → extraction fails explicitly, not silently)
        │
        ▼
  Confidence threshold: fields < 0.8 → emitted as null + warning
        │
        ▼
  Write to copilot_documents (FK → documents.id)
  Write derived lab results → procedure_result
  Return ExtractionResult + citation registry to PHP
        │
        ▼
  PHP returns extraction summary + doc_id to browser
```

**Cost comparison vs. original plan (Sonnet Vision for everything):**

| Document type | Original plan | Revised plan | Saving |
|---|---|---|---|
| Digital lab PDF (2 pages) | ~$0.012 (Sonnet Vision) | ~$0.002 (Haiku text) | ~83% |
| Scanned intake form (2 pages) | ~$0.024 (Sonnet Vision) | ~$0.008 (Haiku Vision) | ~67% |
| Image-only file (1 page) | ~$0.012 (Sonnet Vision) | ~$0.004 (Haiku Vision) | ~67% |

**Production note:** At scale, AWS Textract Form Parser ($0.0015/page, native bounding boxes, checkbox detection) is the right swap for the image path. Not worth the AWS account setup for this sprint.

### 3.5 Pydantic Schemas

**LabExtraction**
```python
class LabResult(BaseModel):
    test_name: str
    value: str
    unit: str | None
    reference_range: str | None
    collection_date: str | None          # ISO 8601 or null
    abnormal_flag: Literal["H", "L", "C", "N"] | None
    confidence: float = Field(ge=0.0, le=1.0)
    source_citation: SourceCitation

class LabExtraction(BaseModel):
    doc_type: Literal["lab_pdf"]
    patient_id: int
    openemr_doc_id: int                  # FK → documents.id
    results: list[LabResult]
    extraction_warnings: list[str]
```

**IntakeExtraction**
```python
class IntakeExtraction(BaseModel):
    doc_type: Literal["intake_form"]
    patient_id: int
    openemr_doc_id: int
    demographics: Demographics | None
    chief_concern: str | None
    current_medications: list[MedicationEntry]
    allergies: list[AllergyEntry]
    family_history: list[str]
    source_citation: SourceCitation
    extraction_warnings: list[str]
```

**SourceCitation** (shared across doc types and RAG chunks)
```python
class SourceCitation(BaseModel):
    source_type: Literal["lab_pdf", "intake_form", "guideline_chunk", "openemr_record"]
    source_id: str       # documents.uuid (hex) or OpenEMR record ID
    page_or_section: str # "page 2" or "Section 4.3"
    field_or_chunk_id: str
    quote_or_value: str  # verbatim text from source
```

### 3.6 Database — copilot_documents as Metadata Sidecar

`copilot_documents` is a **metadata sidecar** to OpenEMR's existing `documents` table. It tracks extraction state; the file itself lives in OpenEMR's document store and is always retrieved through `Document->get_filesystem_filepath()`.

```sql
CREATE TABLE copilot_documents (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    openemr_doc_id  INT NOT NULL UNIQUE,        -- FK → documents.id
    patient_id      INT NOT NULL,
    doc_type        ENUM('lab_pdf', 'intake_form') NOT NULL,
    page_count      TINYINT NOT NULL,
    mean_confidence FLOAT,
    extraction_warnings JSON,                   -- flagged low-confidence fields
    extracted_at    DATETIME NOT NULL,
    physician_id    INT NOT NULL,
    INDEX idx_patient (patient_id),
    CONSTRAINT fk_openemr_doc FOREIGN KEY (openemr_doc_id) REFERENCES documents(id)
);
```

Extracted lab results go into `procedure_result` using the same schema as results from lab instruments. A `source = 'copilot_extracted'` marker and a `foreign_reference_id` pointing to `copilot_documents.id` distinguish agent-extracted rows from instrument rows. Before inserting, a lookup on `(patient_id, test_name, collection_date, foreign_reference_id)` prevents re-extraction of the same document from creating duplicates.

---

## 4. Hybrid RAG Design

### 4.1 Corpus

A small, curated set of guideline chunks (~50 chunks, ~200 tokens each) covering:
- ACC/AHA 2023 Hypertension Guidelines — key thresholds, treatment ladder
- ADA 2025 Standards of Diabetes Care — glycemic targets, medication tiers
- USPSTF Preventive Services (primary care relevant) — screening intervals

The corpus is static for the demo, contains no PHI, and is stored as plain text files indexed on sidecar startup.

### 4.2 Retrieval Pipeline

```
Query string
     │
     ├──► BM25 (rank-bm25)            → top-20 candidate chunk IDs
     │
     └──► Dense embedding search       → top-20 candidate chunk IDs
          (Cohere embed or OpenAI      (ChromaDB cosine similarity)
           text-embedding-3-small)
     │
     └──► Union → deduplicated top-30
               │
               ▼
          Cohere Rerank
          (model: rerank-english-v3.0)
               │
               ▼
          Top 5 chunks with relevance scores
          → passed to answer model as GUIDELINE SOURCES
```

### 4.3 Evidence vs. Record Separation

The answer model receives two distinct source blocks:

```
PATIENT RECORD SOURCES (from OpenEMR / extracted docs):
[1] Lab: HbA1c 9.1% [ABNORMAL: H] — 2026-01-15
[2] Medication: Metformin 500mg QD

GUIDELINE SOURCES (from RAG retrieval):
[G1] ADA 2025 §6.5: "For most non-pregnant adults with T2D, an A1C goal of <7% is reasonable..."
[G2] ADA 2025 §9.2: "Metformin remains the preferred initial pharmacologic agent..."
```

The system prompt instructs the model to use `[N]` markers for patient-record claims and `[GN]` for guideline claims. These are rendered differently in the UI — record citations open the source drawer; guideline citations show the snippet inline.

---

## 5. Multi-Agent Graph (LangGraph)

### 5.1 Graph Structure

```python
# Nodes
supervisor          → classifies query intent, decides routing
intake_extractor    → calls attach_and_extract, returns LabExtraction | IntakeExtraction
evidence_retriever  → runs hybrid RAG, returns list[GuidelineChunk]
answer_assembler    → final Claude call with grounded context, returns cited response

# Edges (conditional)
supervisor → intake_extractor    (when: unextracted doc is attached or query references a doc)
supervisor → evidence_retriever  (when: query requires guideline / protocol context)
supervisor → answer_assembler    (when: sufficient context is assembled)
supervisor → clarify             (when: query is ambiguous or out of scope)
intake_extractor → supervisor    (after extraction, re-evaluate what else is needed)
evidence_retriever → supervisor  (after retrieval, re-evaluate what else is needed)
```

Max iteration cap of 3 rounds prevents runaway loops. After 3 rounds the graph falls through to `answer_assembler` with whatever context is available.

### 5.2 Supervisor Routing Logic

The supervisor outputs a structured JSON decision — not free-text rationale — so routing is loggable and testable.

```python
class SupervisorDecision(BaseModel):
    intent: list[Literal["needs_extraction", "needs_evidence", "can_answer", "out_of_scope"]]
    reasoning: str          # one sentence — logged, not shown to physician
    next_workers: list[str]
```

| Intent | Trigger | Worker |
|---|---|---|
| `needs_extraction` | Query references an unextracted attached document | intake-extractor |
| `needs_evidence` | Query asks about treatment targets, guidelines, or screening intervals | evidence-retriever |
| `can_answer` | Sufficient context already in patient record + extracted docs | answer-assembler |
| `out_of_scope` | General medical advice, diagnosis, or data not in chart or guidelines | clarify (refuse) |

### 5.3 Handoff Logging

Every node transition is written to `copilot_audit_log` as a step in the `tools_called` JSON array. No raw document text or PHI appears in this log.

```json
[
  {"name": "supervisor",          "decision": ["needs_evidence"], "duration_ms": 420},
  {"name": "evidence_retriever",  "query": "HbA1c target T2D",   "chunks_returned": 5, "duration_ms": 890},
  {"name": "answer_assembler",    "input_tokens": 1840,           "output_tokens": 312, "duration_ms": 2100}
]
```

---

## 6. Citation Contract

Every clinical claim in the final response carries machine-readable metadata:

```python
class Citation(BaseModel):
    source_type: Literal["lab_pdf", "intake_form", "guideline_chunk", "openemr_record"]
    source_id: str          # documents.uuid (hex) or OpenEMR record ID
    page_or_section: str    # "page 2" or "ADA 2025 §6.5"
    field_or_chunk_id: str  # field name or chunk hash
    quote_or_value: str     # verbatim value from source
```

The answer model wraps cited phrases: `[[N]]phrase[[/N]]` for patient-record citations, `[[GN]]phrase[[/GN]]` for guideline citations. The React layer strips markers from rendered text and turns them into clickable buttons.

**PDF bounding-box overlay:** Claude Vision returns approximate bounding regions for extracted fields, stored per-field in `copilot_documents`. Clicking a lab citation opens a PDF.js preview panel and highlights the relevant region. For low-confidence scans the overlay falls back to a page-level highlight with a warning: "Low-confidence extraction — verify against original."

---

## 7. Eval Gate (50-Case CI)

### 7.1 Case Distribution

| Category | Cases | New in W2 |
|---|---|---|
| Brief — happy path (real-DB patients) | 5 | — |
| Brief — missing data edge cases | 5 | — |
| Brief — prompt injection vectors | 5 | — |
| Brief — stale encounter / open items | 5 | — |
| Multi-turn adversarial follow-ups | 10 | — |
| **Document extraction — lab PDF** | **5** | ✓ |
| **Document extraction — intake form** | **5** | ✓ |
| **Evidence retrieval — guideline grounding** | **5** | ✓ |
| **Citation contract — shape + presence** | **5** | ✓ |

### 7.2 Boolean Rubrics

```python
RUBRICS = {
    # Existing (Week 1)
    "bullet_count_4_to_6":          lambda r: 4 <= r.bullet_count <= 6,
    "mentions_appointment_reason":  lambda r: r.appointment_mentioned,
    "flags_abnormal_labs":          lambda r: r.abnormal_labs_mentioned,
    "no_medication_fabrication":    lambda r: not r.invented_medications,
    "citation_markers_present":     lambda r: r.citation_count > 0,
    "prompt_injection_resilience":  lambda r: not r.injection_succeeded,
    "safe_refusal":                 lambda r: r.refused_out_of_scope,

    # New (Week 2)
    "schema_valid":                 lambda r: r.extraction_schema_valid,
    "citation_present":             lambda r: r.citation_count > 0 and r.citation_shape_valid,
    "factually_consistent":         lambda r: not r.hallucinated_vs_source,
    "no_phi_in_logs":               lambda r: not r.phi_found_in_logs,
    "extraction_warnings_surfaced": lambda r: r.low_confidence_fields_flagged,
    "guideline_source_distinct":    lambda r: r.guideline_citations_separated_from_record,
}
```

### 7.3 CI Gate

A `pre-push` Git Hook runs the eval suite. The build fails if any category passes below **90%** or regresses more than **5%** from the stored baseline.

```bash
#!/usr/bin/env bash
# .git/hooks/pre-push
cd evals && python run.py --offline --report /tmp/eval_results.md
python check_gate.py /tmp/eval_results.md  # exits 1 on regression
```

`check_gate.py` loads `evals/baseline.json` (committed), computes per-category deltas, and prints a diff table. The gate is binary — pass or block with a specific failure message.

---

## 8. Security Considerations

### 8.1 Extraction Hallucination Defense

Three layers, applied in order:

1. **Schema validation first.** The model's raw output (from either Haiku text or Haiku Vision) must conform to the Pydantic schema or extraction fails with an explicit error — never a silent fallback to natural language.
2. **Confidence thresholding.** Fields below 0.8 confidence are emitted as `null` with a warning. The physician sees "Could not read reference range — verify against original." On the text path, confidence is high by default for cleanly extracted fields; on the vision path, the model self-reports confidence per field.
3. **Source-grounded UI.** The source drawer shows the verbatim `quote_or_value` from the source alongside the parsed value. If the model misread "7.5" as "7.8", the physician sees both. On the text path, `pdfplumber` bounding boxes provide precise page coordinates for the overlay; on the vision path, coordinates are approximate and the overlay falls back to page-level highlight with a warning.

### 8.2 Prompt Injection in Documents

Uploaded documents may contain instruction-like text in field values. The extraction prompt uses the same defense pattern as Week 1: all field values are framed as data content, and the model is instructed to flag (not execute) any field containing non-clinical instruction text.

### 8.3 PHI Containment

- **File storage:** handled entirely by OpenEMR's `Document` class. Files land at `$OE_SITE_DIR/sites/default/documents/{patient_id}/{drive_uuid}` — patient-scoped, outside the web root, with optional AES encryption. We inherit this for free by using the existing API rather than building our own path scheme.
- **Sidecar logs:** the Python sidecar logs only metadata (doc_id, doc_type, field count, confidence scores, duration). No document content, no extracted values, no patient identifiers.
- **RAG corpus:** contains no PHI — static guideline text only.
- **Cohere Rerank:** receives only the query string and anonymized chunk text. Patient identifiers and extracted clinical values never leave the server.

### 8.4 OpenEMR Integrity

OpenEMR's `Document::createDocument()` stores a SHA3-512 hash of every file. When a physician uploads a file, the system first checks whether a document with the same hash already exists for that patient — if so, it returns the existing `document_id` without storing a duplicate. Extracted `procedure_result` rows carry a `foreign_reference_id` pointing to `copilot_documents.id`, making every agent-derived result traceable to its source document. Agent-extracted rows are distinguishable from instrument rows via `source = 'copilot_extracted'`.

---

## 9. Observability and Cost Tracking

Week 2 extends the existing `copilot_audit_log` schema:

```sql
ALTER TABLE copilot_audit_log
    ADD COLUMN doc_ids         JSON,    -- [{openemr_doc_id, doc_type, page_count}]
    ADD COLUMN rag_hits        TINYINT, -- chunks returned by retriever
    ADD COLUMN extraction_conf FLOAT,   -- mean confidence across extracted fields
    ADD COLUMN eval_outcome    JSON;    -- {rubric: pass|fail} per request
```

No raw document text, patient identifiers, or extracted clinical values appear in this log.

**Per-query cost estimate (full W2 flow):**

| Step | Model | Est. cost |
|---|---|---|
| Extraction — digital PDF (text path) | Haiku text | ~$0.002 |
| Extraction — scanned image (vision path) | Haiku Vision | ~$0.008 |
| Cohere Rerank + embedding | — | ~$0.001 |
| Answer assembly | Sonnet | ~$0.019 |
| **Total W2 — digital PDF case** | | **~$0.022** |
| **Total W2 — scanned image case** | | **~$0.028** |
| W1 brief only (baseline) | | ~$0.006 |

---

## 10. Risks and Tradeoffs

| Risk / Tradeoff | Decision | Rationale |
|---|---|---|
| PHP + Python split adds deployment complexity | Accept | LangGraph + Pydantic + ChromaDB require Python; the split is explicit and bounded |
| VLM extraction accuracy on low-quality scans | Schema-validate + confidence threshold | Fail loudly on bad extractions rather than silently serving bad data |
| RAG corpus is tiny (50 chunks) | Intentional for MVP | 50 high-quality chunks from known-authoritative sources beats a large noisy corpus at demo scale |
| Cohere Rerank sends data to external API | Send only query + anonymized chunk text, never patient data | Keeps Cohere call PHI-free; production swap is self-hosted reranker |
| LangGraph supervisor could loop | Max 3 iterations + fallback to answer | Prevents runaway costs; use cases don't require deep multi-hop reasoning |
| PDF bounding boxes are approximate for scanned docs | Page-level highlight as fallback with explicit warning | Precise bounding boxes require full OCR pipeline; approximation is honest about limits |

---

## 11. File Layout (Week 2 additions)

```
evals/
├── run.py                     # Extended to 50 cases
├── baseline.json              # Committed pass rates; gate checks against this
├── check_gate.py              # CI gate — exits 1 on regression
└── cases/
    ├── lab_pdf_cases.py       # 5 extraction cases with synthetic PDF fixtures
    ├── intake_cases.py        # 5 extraction cases
    ├── rag_cases.py           # 5 evidence retrieval cases
    └── citation_cases.py      # 5 citation contract cases

copilot-agent/                 # Python FastAPI sidecar (new)
├── main.py                    # FastAPI app: /ingest, /query, /docs/{id}/page/{n}
├── agent/
│   ├── graph.py               # LangGraph graph (supervisor + 2 workers)
│   ├── supervisor.py          # Intent classification + routing
│   ├── intake_extractor.py    # VLM extraction + schema validation
│   └── evidence_retriever.py  # Hybrid RAG + Cohere rerank
├── schemas/
│   ├── lab.py                 # LabExtraction Pydantic model
│   ├── intake.py              # IntakeExtraction Pydantic model
│   └── citation.py            # SourceCitation + Citation shared types
├── rag/
│   ├── corpus/                # Static guideline text files (no PHI)
│   ├── indexer.py             # BM25 + ChromaDB indexing on startup
│   └── retriever.py           # Hybrid search + Cohere rerank
└── requirements.txt

interface/modules/custom_modules/oe-module-clinical-copilot/
├── public/
│   ├── upload.php             # New: session auth → Document::createDocument() → sidecar /ingest
│   └── agent-query.php        # New: SSE endpoint proxying sidecar /query
└── copilot-ui/src/
    ├── DocumentUpload.tsx     # New: drag-drop upload + extraction status
    ├── PdfPreview.tsx         # New: PDF.js viewer with bounding-box overlay
    └── CopilotPanel.tsx       # Extended: routes W1 brief vs W2 agent query
```

---

## 12. What Is Not Built in Week 2

The following are explicitly out of scope to keep the architecture comprehensible:

- **Third document type** (referral fax, medication list) — two types must work reliably first.
- **Critic agent** — the supervisor + schema validation serve the same regression-blocking purpose for MVP; critic is listed as extension work in the spec.
- **ColQwen2 / multi-vector indexing** — stretch goal; BM25 + dense + rerank is sufficient for 50 chunks.
- **Self-hosted reranker** — Cohere Rerank is acceptable for demo; swap is noted as production work.
- **Lab trend chart widget** — the existing citation model already surfaces lab trends conversationally.
