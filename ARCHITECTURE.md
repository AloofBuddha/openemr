# Architecture: Clinical Co-Pilot

**Informed by:** AUDIT.md findings
**Traces to:** USERS.md use cases UC-1 through UC-5
**Date:** 2026-04-27

---

## Executive Summary (~500 words)

The Clinical Co-Pilot is a conversational AI agent embedded directly in OpenEMR as a custom module. A physician opens a side panel, asks a question about a patient, and gets a synthesized, source-attributed answer in under 10 seconds — without leaving the encounter workflow.

The architecture rests on three decisions shaped entirely by the audit findings:

**Decision 1 — Integrate at the service layer, not the API layer.** The audit established that OpenEMR's REST API enforces role-level authorization but not patient-level authorization. Rather than accept that gap or attempt to patch the REST layer, the agent calls OpenEMR's PHP service classes directly from within the module (`PatientService`, `EncounterService`, etc.). This means authorization logic lives in one place — the module's data-access layer — where it can enforce that the requesting physician has a care relationship with the patient being queried. No external HTTP calls, no token management overhead, no bypass risk.

**Decision 2 — The agent's tools are narrow, typed, and audited.** Each tool corresponds to one use case from USERS.md. `get_patient_brief` (UC-1), `get_medications` (UC-2), `get_encounter_history` (UC-3), `get_lab_trend` (UC-4), `get_today_schedule` (UC-5). Tools do not exist because they are technically interesting — they exist because a specific user need requires them. Each tool call is logged with timing, result size, and the authenticated physician's ID before the result reaches the LLM. The audit found chart_tracker is not being populated; the module fills this gap by writing an access record for every tool invocation.

**Decision 3 — Verification is structural, not post-hoc.** The agent does not generate a response and then check it. The prompt architecture forces grounding: tool results are passed as structured context, and the system prompt instructs the model to cite the source record for every factual claim. A lightweight post-processing pass checks that no claim in the response references data that was not returned by a tool. Claims that cannot be sourced are either removed or explicitly flagged as unverified. This is the verification approach the PDF describes as non-negotiable for a clinical setting.

**Speed tradeoff:** The 90-second physician window means the agent must stream its first sentence within 3 seconds of the query. Tool calls for the brief (demographics + last encounter + active meds + recent labs) run in parallel at query time. The streamed response begins as soon as the first tool results return, with remaining context appended as it arrives. For UC-5 (day-start schedule scan), all patient queries run concurrently with a per-patient timeout of 2 seconds — incomplete records are flagged rather than blocking the response.

**Known limitations at this stage:** The demo dataset is too thin to validate agent behavior under real clinical volume. The verification pass catches fabrication against retrieved data but cannot catch errors of omission — if a medication wasn't recorded in OpenEMR, the agent won't know it exists. The agent is only as good as the data it can reach.

---

## 1. System Overview

```
┌─────────────────────────────────────────────────────┐
│                    OpenEMR UI                       │
│  ┌─────────────────┐   ┌──────────────────────────┐ │
│  │  Existing Chart  │   │  Co-Pilot Panel          │ │
│  │  View / Workflow │   │  (React/TypeScript IIFE  │ │
│  │                  │   │   bundle, ~187KB)         │ │
│  └─────────────────┘   └──────────┬───────────────┘ │
└─────────────────────────────────────────────────────┘
                                    │ HTTP (same origin)
                          ┌─────────▼──────────┐
                          │  Module PHP Backend│
                          │  /api/copilot/chat │
                          │  (session-authed)  │
                          └─────────┬──────────┘
                                    │
              ┌─────────────────────▼──────────────────┐
              │           Agent Orchestrator           │
              │  - Auth check (care relationship)      │
              │  - Tool dispatch (parallel)            │
              │  - Audit logging                       │
              │  - LLM call (Claude, streaming)        │
              │  - Verification pass                   │
              └──┬──────────────┬──────────────┬───────┘
                 │              │              │
         ┌───────▼──┐   ┌───────▼──┐   ┌──────▼──────┐
         │ Patient  │   │Encounter │   │    Lab /    │
         │ Service  │   │ Service  │   │  Rx Service │
         └───────┬──┘   └───────┬──┘   └──────┬──────┘
                 └──────────────┴─────────────┘
                                │
                         ┌──────▼──────┐
                         │   MariaDB   │
                         └─────────────┘
```

---

## 2. Module Structure

The agent lives entirely within a custom OpenEMR module:

```
interface/modules/custom_modules/oe-module-clinical-copilot/
├── openemr.bootstrap.php           # Module entry point
├── src/
│   ├── Bootstrap.php               # RenderEvent listener — injects widget into demographics.php
│   ├── Agent/
│   │   ├── Orchestrator.php        # Data gather → LLM call → SSE stream
│   │   └── Tools/
│   │       └── PatientBriefTool.php      # UC-1: demographics, appointment, encounter, meds, labs
│   ├── Authorization/
│   │   └── PatientAccessGuard.php        # Care relationship check (encounter or today's schedule)
│   └── Observability/
│       └── AgentAuditLogger.php          # Writes to copilot_audit_log per request
├── public/
│   ├── chat.php                    # SSE endpoint — auth, PatientAccessGuard, Orchestrator
│   └── js/
│       └── copilot-bundle.js       # Compiled React/TypeScript IIFE (~187KB, CSS inlined)
├── copilot-ui/                     # UI source (Vite + React + TypeScript)
│   └── src/
│       ├── main.tsx                # Entry — mounts CopilotPanel into #copilot-widget
│       ├── CopilotPanel.tsx        # Streaming hook, citation rendering, source drawer
│       └── styles.css
└── sql/
    └── install.sql                 # copilot_brief_cache + copilot_audit_log tables
```

**UC-1 is the only implemented use case.** UC-2 through UC-5 tools are planned (see §4) but not yet written.

---

## 3. Authorization — Closing the Audit Gap

The audit's most critical finding: the REST API checks role-level permission, not patient-level access. Every tool call in the agent passes through `PatientAccessGuard` before any data is retrieved:

```php
class PatientAccessGuard
{
    public function assertAccess(int $physicianId, string $patientUuid): void
    {
        // Check: does this physician have a recorded encounter with this patient,
        // or is this patient on their schedule today?
        $hasRelationship = $this->hasEncounterRelationship($physicianId, $patientUuid)
            || $this->isOnTodaySchedule($physicianId, $patientUuid);

        if (!$hasRelationship) {
            throw new UnauthorizedPatientAccessException($physicianId, $patientUuid);
        }
    }
}
```

Name resolution — turning a physician's free-text query ("brief me on John Smith") into a PID — runs through the same guard. The lookup queries only patients with a care relationship to the requesting physician. If two physicians each have a patient named John Smith, each sees only their own. If the name is ambiguous within a single physician's panel (two patients with the same name), the agent asks for clarification rather than guessing.

```php
```

This runs before any tool executes. An unauthorized access attempt logs the attempt and returns a refusal to the agent, not a data result.

---

## 4. Tools

Each tool maps directly to a USERS.md use case. Tools have no side effects — they are read-only queries.

| Tool | Use Case | Data Sources | Max Latency Target |
|------|----------|-------------|-------------------|
| `get_patient_brief` | UC-1 | patient_data, form_encounter, prescriptions, procedure_result, lists | 800ms |
| `get_medications` | UC-2 | prescriptions, lists (type=medication), procedure_result (renal labs) | 300ms |
| `get_encounter_history` | UC-3 | form_encounter (full history + SOAP notes) | 500ms |
| `get_lab_trend` | UC-4 | procedure_result (filtered by LOINC code, ordered by date) | 400ms |
| `get_today_schedule` | UC-5 | openemr_postcalendar_events + lightweight per-patient scan | 2000ms |

For UC-1 (the only implemented case), `PatientBriefTool::gather()` runs the four queries sequentially — demographics, appointment, last encounter, medications, labs. This is sufficient at demo scale (<500ms total). Parallel execution via PHP fibers is the planned path for production, where query volume and panel size make sequential latency unacceptable.

---

## 5. LLM Integration

**Model:** `claude-sonnet-4-6` (Anthropic)
**Rationale:** Tool use support, 200K context window (handles full encounter histories), strong instruction-following for source attribution, streaming support.

**Prompt architecture:**

```
[System prompt — static, no PHI]
You are a Clinical Co-Pilot embedded in an EHR. Give physicians a fast,
skimmable pre-encounter brief.

Rules:
- Only state facts present in the provided data. Never fabricate clinical details.
- Write 4–6 bullet points. No headers. Telegraphic style.
- Lead with why here today, then key changes since last visit, active meds
  of concern, flagged labs.
- For every specific data point, wrap the cited phrase in source markers:
  [[N]]the phrase[[/N]] where N is the source number.
- If data is missing, note it briefly (e.g. "No labs on file").
- Do not diagnose or recommend treatments.

[User turn — numbered SOURCES list, PHI arrives here only]
Brief this patient. Cite source numbers inline next to each fact.

PATIENT: Phil Belford, 54y M

SOURCES:
[1] Today's appointment: Hypertension follow-up
[2] Last encounter (2025-11-15): HTN — BP improving on lisinopril
[3] Medication: Lisinopril 10 mg (QD)
[4] Lab: Hemoglobin A1c: 7.5 % [ABNORMAL: H] — 2024-10-10
```

PHI never appears in the system prompt — it arrives only in the user turn as a numbered source list. The `[[N]]phrase[[/N]]` markers in the response are stripped from the rendered text; the phrase itself becomes a clickable citation button in the UI.

**Streaming:** The response streams token-by-token to the UI. The physician sees the first sentence within ~3 seconds of submitting the query.

---

## 6. Verification System

Every factual claim in the agent's response is clickable. Clicking opens the source record in a side panel with the relevant field highlighted — the same pattern used in legal AI tools like Harvey and Casetext. A physician who sees "Phil is taking lisinopril 10mg" can click it and see the actual prescriptions row, lisinopril highlighted. There is no ambiguity about whether a claim is sourced.

### Output Format — Streaming Markdown with Inline Citation Markers

The model streams markdown bullet points. Every specific data phrase is wrapped in `[[N]]phrase[[/N]]` markers keyed to a source number from the SOURCES list:

```
• [[1]]Hypertension follow-up[[/1]] — returning visit
• [[3]]Lisinopril 10mg[[/3]] QD — no changes since last visit
• [[4]]A1C 7.5%[[/4]] — flagged high, up from prior baseline
• No prior encounter SOAP notes on file
```

During streaming, markers are stripped so the text reads cleanly. Once streaming completes, each cited phrase becomes a clickable inline button. Clicking opens the source drawer.

### Source Registry

`Orchestrator::buildUserMessage()` builds the source registry before the LLM call — a map from source number to the structured EHR record fields:

```json
{
  "3": {
    "type": "medication",
    "label": "Lisinopril 10 mg",
    "fields": [
      { "key": "Drug",      "value": "Lisinopril" },
      { "key": "Dose",      "value": "10 mg" },
      { "key": "Frequency", "value": "QD" }
    ],
    "scroll_to": "#prescriptions_ps_expand"
  }
}
```

Sources are emitted to the browser as an SSE `sources` event before streaming begins, so citation buttons are interactive from the first token. The "View in chart" button in the drawer uses `scroll_to` to expand and scroll to the relevant OpenEMR card on the same page.

### Verification Layers

**Layer 1 — Prompt-enforced sourcing:** The model is instructed to wrap every specific data point with `[[N]]...[[/N]]`. A claim without a marker is prose context, not a sourced fact.

**Layer 2 — Visual ground truth:** The source drawer shows the raw database record fields — not AI rephrasing of them. The physician can compare the claim in the brief against the actual record row directly.

**What this catches:** Fabrication against retrieved data — if the model states a value not in the source list, there will be no citation wrapping it, making it visually distinct.

**What this does not catch:** Errors of omission — if a medication exists outside OpenEMR and was never recorded, the agent correctly says "not on file" but cannot distinguish that from "does not exist." Disclosed in the UI footer on every response.

**Not yet built:** A post-processing `SourceAttributionChecker` that programmatically cross-checks cited values against the registry (planned for Early Submission).

---

## 7. Observability

Every agent request writes a structured record to `copilot_audit_log`:

```sql
CREATE TABLE copilot_audit_log (
    id          BIGINT AUTO_INCREMENT PRIMARY KEY,
    session_id  VARCHAR(64) NOT NULL,
    physician_id INT NOT NULL,
    patient_uuid VARCHAR(64),
    query_text  TEXT NOT NULL,          -- physician's question
    tools_called JSON NOT NULL,         -- [{name, duration_ms, success, result_size}]
    llm_model   VARCHAR(64) NOT NULL,
    input_tokens INT NOT NULL,
    output_tokens INT NOT NULL,
    total_ms    INT NOT NULL,
    verified    TINYINT(1) NOT NULL,    -- did verification pass?
    flagged_claims INT NOT NULL DEFAULT 0,
    created_at  DATETIME NOT NULL
);
```

This answers the four observability questions from the PDF:
- **What did the agent do, in what order?** → `tools_called` JSON array with sequence
- **How long did each step take?** → `duration_ms` per tool + `total_ms` for the full request
- **Did any tools fail?** → `success` flag per tool entry
- **How many tokens, at what cost?** → `input_tokens`, `output_tokens`, model pricing applied at query time

This table also fills the chart_tracker gap identified in the audit: every agent-initiated patient data access is recorded with physician ID, patient UUID, and timestamp.

---

## 8. Speed vs. Completeness Tradeoff

The audit found no caching layer in OpenEMR. The agent addresses this at two levels:

**Per-request:** Tools for a patient brief run in parallel. The UI begins streaming as soon as the first results return. If a tool times out (>2s), the response notes the missing data rather than waiting.

**Brief cache (`copilot_brief_cache` table):** The patient brief is cached per `(patient_id, physician_id, appointment_id)`. On patient page load, the module checks for a valid cache entry before firing any LLM call. Cache validity requires: (1) the brief was generated for the same upcoming appointment, (2) it was generated after the last data change to that patient's encounters, prescriptions, or labs (checked via `data_snapshot_hash`), and (3) the appointment has not yet passed. A stale cache shows the prior brief with a "⚠ Data may have changed" banner rather than silently serving outdated content. The physician can always force a refresh. This eliminates redundant LLM calls for physicians who open and close a patient chart multiple times before a visit.

**For UC-5 (day-start scan):** All patient queries run concurrently with a 2-second per-patient timeout. The scan completes in roughly `max(individual query time)` rather than `sum(individual query times)`.

---

## 9. HIPAA Constraints on the LLM Integration

Per the audit's compliance findings:

1. **BAA:** Anthropic provides a BAA for API customers. This must be executed before any real patient data (beyond demo data) is used.
2. **PHI minimization:** Tool results are structured to include only fields required for the query. Full record dumps are never passed to the LLM.
3. **Log sanitization:** `copilot_audit_log` stores `query_text` (the physician's question, which may contain patient names) but not the full LLM response. Response text is not logged — only whether verification passed and how many claims were flagged.
4. **Retention:** Access logs are retained per the practice's HIPAA retention policy (minimum 6 years). The `created_at` field supports automated purge schedules.

---

## 10. Known Tradeoffs and Limitations

| Tradeoff | Decision | Rationale |
|----------|----------|-----------|
| Service layer vs. REST API | Service layer | Avoids per-patient auth gap; lower latency; no token management |
| PHP + LLM vs. Python sidecar | PHP for now | Keeps module self-contained; avoids deployment complexity at this stage |
| Single agent vs. multi-agent | Single agent | UC-1 through UC-5 all fit a single-turn tool-calling pattern; multi-agent adds complexity without a use case |
| Streaming vs. complete response | Streaming | Physician needs to start reading in <3s; full response takes 5–8s |
| claude-sonnet-4-6 vs. haiku | Sonnet | Clinical accuracy > cost at this stage; haiku can be introduced for UC-5 bulk scan |
| No RAG / vector search | No RAG | All data is structured and queryable via SQL; RAG adds latency and complexity without benefit here |

**Biggest open risk:** The verification system catches hallucination against retrieved data, but cannot catch hallucination about what data *should* exist. If a physician asks "is Phil on any blood thinners?" and the answer is no — either because he isn't, or because a prescription wasn't recorded — the agent returns the same response. The agent must consistently communicate this limitation in its responses.
