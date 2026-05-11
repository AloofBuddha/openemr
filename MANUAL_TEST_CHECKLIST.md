# Week 2 Manual Test Checklist

This is the punch list to validate the Final-submission build on prod after deploy. Each item maps to a PRD core requirement.

**Deploy URL:** https://198.211.103.246.nip.io
**Login:** admin / pass

---

## Pre-test setup (one-time after this deploy)

The bbox/PNG fix only takes effect for **fresh** uploads — old cached extractions will not have bboxes, and old uploads have no rendered page PNG on disk. So:

1. SSH to prod and clear the sidecar cache:
   ```bash
   ssh root@198.211.103.246 "rm -f /root/openemr/copilot-agent/extraction_cache/* && systemctl restart copilot-sidecar"
   ```
2. Confirm sidecar restarted: `systemctl status copilot-sidecar` should show `active (running)`.
3. (Optional) clear MySQL `copilot_source_links` table for the demo patient if intake-process has been run previously — old rows will have null bbox columns:
   ```bash
   ssh root@198.211.103.246 "docker exec openemr mysql openemr -e 'DELETE FROM copilot_source_links;'"
   ```

After this, **all uploads will get fresh extraction → bbox → PNG**.

---

## #1 — Document ingestion (lab + intake)

**Goal:** prove the extractor handles both required document types.

- [ ] In OpenEMR, open patient **Margaret Chen** (or any test patient).
- [ ] Open the Co-Pilot panel.
- [ ] Click "Upload document" → select `example-documents/lab-results/p01-chen-lipid-panel.pdf` → mark as **Lab PDF**.
  - **Expect:** sidebar message ~5–10 sec later showing extracted lab values (Total Chol 232, HDL 48, LDL 158, Trig 165), with abnormal flags.
- [ ] Same panel → upload `example-documents/intake-forms/p01-chen-intake-typed.pdf` → mark as **Intake form**.
  - **Expect:** message showing meds (Lisinopril 10mg, Metformin 500mg, Atorvastatin 20mg, Aspirin 81mg), allergies (Penicillin, Sulfa), family history.

## #2 — Schemas (passes by code; nothing to test in UI)

Verified by 18 pytests (`copilot-agent/tests/test_schemas.py`). To re-run:
```bash
cd copilot-agent && .venv/bin/pytest tests/test_schemas.py -v
```

## #3 — Hybrid RAG + Cohere rerank

**Goal:** retrieval returns relevant guideline chunks across all 4 demo patients (not just hypertension/diabetes).

For each patient, ask one question that should hit the new corpus:

- [ ] **Chen** (hypertension + diabetes): "What's the LDL target for someone with diabetes on a moderate-intensity statin?"
  - **Expect:** answer cites `[AHA/ACC 2018 §...]` chunk about statin intensity for diabetes.
- [ ] **Whitaker** (AFib on apixaban): "Should we adjust apixaban dosing given the patient's age and renal function?"
  - **Expect:** cites `[ACC/AHA 2023 §3.2]` apixaban dosing chunk; mentions 2.5 mg BID criteria.
- [ ] **Reyes** (depression on SSRI): "What's the PHQ-9 cutoff for moderate depression?"
  - **Expect:** cites `[USPSTF 2023 §1.2]` PHQ-9 chunk; gives the 10–14 band.
- [ ] **Kowalski** (asthma + alcohol use): "What's the GINA Step 3 treatment for partly-controlled asthma?"
  - **Expect:** cites `[GINA 2024 §2.2]` MART regimen chunk.

To re-run automated coverage tests:
```bash
cd copilot-agent && .venv/bin/pytest tests/test_rag_coverage.py -v
```

## #4 — Supervisor + 2 workers (LangGraph)

**Goal:** routing decisions are visible and worker handoffs are logged.

- [ ] Ask any question that requires both extracted-doc data and guidelines — e.g. for Chen: "Given her LDL of 158, is she on the right statin intensity?"
  - **Expect:** answer references both her recent labs (intake/lab doc) AND a guideline chunk.
- [ ] Open browser dev console → Network tab → click the SSE `/agent-query.php` request → look at the `routing` event in the response.
  - **Expect:** JSON array with at least `[supervisor, intake_extractor, evidence_retriever, answer_assembler]` entries, each with `duration_ms` and `cost_usd`.

## #5 — Citation contract + bounding-box overlay 🔥 PRIMARY DEMO MOMENT

**Goal:** clicking a [[DN]] document citation opens the source drawer, shows the PDF page, and draws a yellow rectangle on the cited value.

- [ ] After uploading Chen's lab PDF (#1), ask: "What's her LDL?"
  - **Expect:** answer like "LDL is [[D1]]158 mg/dL[[/D1]]" with inline citation chip.
- [ ] Click the citation chip.
  - **Expect:**
    - Drawer opens on the right.
    - PDF page renders at top of drawer.
    - **Yellow rectangle overlays the "158" on the page.** ⭐
    - Caption: `Yellow box: LDL Cholesterol = 158`
- [ ] Repeat for Whitaker: ask "What's her current apixaban dose?" after uploading intake form.
  - **Expect:** click → drawer → yellow box on "5 mg" near "Apixaban".
- [ ] Repeat for any [[GN]] guideline citation.
  - **Expect:** drawer shows the chunk text and source ref (no PDF — guidelines are text).

If the **yellow rectangle does not appear**: the file was uploaded before the bbox-fix deploy. Re-upload.

## #6 — Eval-driven CI gate

**Goal:** the PR-blocking gate fires when a regression is introduced. Graders will test this.

Local verification (already automated):
```bash
cd evals && /path/to/.venv/bin/pytest test_gate.py -v
```
- [ ] All 7 `test_gate.py` cases pass: regression on `schema_valid`, `citation_present`, `no_phi_in_logs` each makes the gate exit 1; tolerated 5pp dip passes; baseline covers all 5 PRD rubrics; total case count ≥ 50.

Manual verification of the live gate:
- [ ] Edit `evals/baseline.json`, drop `graph.schema_valid` pct from 100 to 50, save.
- [ ] Run: `cd evals && ../copilot-agent/.venv/bin/python check_gate.py --skip-brief --skip-graph`
- [ ] **Expect:** `GATE FAILED — at least one rubric regressed > 5.0pp`, exit code 1.
- [ ] **Revert** the baseline change.

Pre-push hook:
- [ ] `git push` runs `check_gate.py --skip-brief` automatically (~3 min, hits Claude API). Bypass: `GAUNTLET_SKIP_GATE=1 git push`.

## #7 — Observability + cost tracking

- [ ] After running a query, check the audit log:
  ```bash
  ssh root@198.211.103.246 "docker exec openemr mysql openemr -e 'SELECT physician_id, patient_uuid, query_text, llm_model, input_tokens, output_tokens, total_ms FROM copilot_audit_log ORDER BY id DESC LIMIT 5;'"
  ```
- [ ] **Expect:** `query_text` shows `q_sha256:HASH;len=N` — **NOT** the raw query text. (PHI hygiene per PRD §7.)
- [ ] Tools called and per-step cost are visible in the `routing` SSE event (#4).

---

## Surprise Challenge — Patient Dashboard Port

Not started yet. Tracked separately (`PATIENT_DASHBOARD_MIGRATION.md` to be created).

---

## Quick re-run of everything

```bash
# Sidecar tests (103 cases)
cd copilot-agent && .venv/bin/pytest tests/ -v

# Eval gate tests (7 cases)
cd evals && ../copilot-agent/.venv/bin/pytest test_gate.py -v

# Live eval gate (~3 min, hits Claude API)
cd evals && ../copilot-agent/.venv/bin/python check_gate.py --skip-brief
```

If anything in this checklist fails, screenshot or copy the error and let me know — I'll dig in.
