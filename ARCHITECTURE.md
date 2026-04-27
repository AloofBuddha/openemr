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
│  │  Existing Chart  │   │  Co-Pilot Side Panel     │ │
│  │  View / Workflow │   │  (Angular component in   │ │
│  │                  │   │   oe-module-copilot)      │ │
│  └─────────────────┘   └──────────┬───────────────┘ │
└──────────────────────────────────────────────────────┘
                                    │ HTTP (same origin)
                          ┌─────────▼──────────┐
                          │  Module PHP Backend │
                          │  /api/copilot/chat  │
                          │  (session-authed)   │
                          └─────────┬──────────┘
                                    │
              ┌─────────────────────▼──────────────────┐
              │           Agent Orchestrator            │
              │  - Auth check (care relationship)       │
              │  - Tool dispatch (parallel)             │
              │  - Audit logging                        │
              │  - LLM call (Claude, streaming)         │
              │  - Verification pass                    │
              └──┬──────────────┬──────────────┬───────┘
                 │              │              │
         ┌───────▼──┐   ┌───────▼──┐   ┌──────▼──────┐
         │ Patient  │   │Encounter │   │    Lab /    │
         │ Service  │   │ Service  │   │  Rx Service │
         └───────┬──┘   └───────┬──┘   └──────┬──────┘
                 └──────────────┴──────────────┘
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
├── ModuleManagerListener.php       # Module registration
├── src/
│   ├── Bootstrap.php               # Event subscriptions, route registration
│   ├── Controller/
│   │   └── CopilotController.php   # POST /api/copilot/chat handler
│   ├── Agent/
│   │   ├── Orchestrator.php        # Tool dispatch loop + LLM call
│   │   ├── Tools/
│   │   │   ├── PatientBriefTool.php      # UC-1
│   │   │   ├── MedicationsTool.php       # UC-2
│   │   │   ├── EncounterHistoryTool.php  # UC-3
│   │   │   ├── LabTrendTool.php          # UC-4
│   │   │   └── ScheduleTool.php          # UC-5
│   │   ├── Verification/
│   │   │   └── SourceAttributionChecker.php
│   │   └── Observability/
│   │       └── AgentAuditLogger.php
│   └── Authorization/
│       └── PatientAccessGuard.php        # Care relationship check
├── public/
│   └── js/
│       └── copilot-panel.js              # Streaming chat UI component
└── sql/
    └── install.sql                       # copilot_audit_log table
```

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

For UC-1 (the most common case), the first four tools run in parallel using PHP fibers or concurrent HTTP sub-requests to the service layer. The brief is assembled from whichever results return within the latency budget; missing data is explicitly noted rather than silently omitted.

---

## 5. LLM Integration

**Model:** `claude-sonnet-4-6` (Anthropic)  
**Rationale:** Tool use support, 200K context window (handles full encounter histories), strong instruction-following for source attribution, streaming support.

**Prompt architecture:**

```
[System prompt — static, no PHI]
You are a Clinical Co-Pilot embedded in OpenEMR. You assist physicians
by synthesizing patient data from their EHR. Rules:
- Only state facts present in the tool results provided.
- Cite the source for every factual claim (e.g., "[from: last encounter 2026-03-12]").
- If data is missing or incomplete, say so explicitly.
- Do not diagnose. Do not recommend treatments. Surface data only.
- Refuse questions about patients not in the provided context.

[Tool results — structured, patient data arrives here only]
<tool_result name="get_patient_brief">
{ ...structured JSON from PatientBriefTool... }
</tool_result>

[User turn]
"Brief me on my next patient."
```

PHI never appears in the system prompt. It arrives only in tool results, which are structured JSON. The model is instructed to treat tool results as the sole source of truth.

**Streaming:** The response streams token-by-token to the UI. The physician sees the first sentence within ~3 seconds of submitting the query.

---

## 6. Verification System

Two layers, applied before the response reaches the physician:

**Layer 1 — Source attribution (prompt-enforced):**  
The system prompt requires the model to cite a source record for every factual claim. This is enforced by instruction, not post-hoc parsing. A claim without a citation is an implicit signal to the physician that it is the model's inference, not a record fact.

**Layer 2 — Structural fact-checking (post-processing):**  
`SourceAttributionChecker` extracts all cited data points from the response and verifies each against the tool results that were actually returned. If the model cites a medication that was not in the `get_medications` result, the claim is flagged with a warning before display:

```
⚠ "lisinopril 20mg" — not found in current medication records. Verify manually.
```

**What this catches:** Hallucinated specifics (wrong dosages, wrong dates, fabricated lab values).  
**What this does not catch:** Errors of omission — if a medication exists in a system the agent doesn't query (e.g., an external pharmacy system), the agent won't know to flag its absence. This limitation is documented in the UI.

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

**Per-session:** The patient brief result is cached in the PHP session for 5 minutes. If a physician asks two questions about the same patient within the same session, the second query reuses cached demographics, problems, and medications. Only lab/encounter queries re-run (most likely to change mid-session).

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
