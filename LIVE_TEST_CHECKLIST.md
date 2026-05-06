# Live walkthrough checklist

A list of behaviors to exercise after the review is complete and the system
is redeployed. Each item names what to do and what should happen — Claude
can't see the rendered UI or test multi-tab flows, so these need a human
hand on the keyboard.

Group by section so you can defer or skip individual items.

---

## Section 3 — Agent layer

- [ ] **Upload a structured intake form PDF** and confirm the response
      JSON has per-medication and per-allergy `source_citation` blocks
      (with non-empty `quote_or_value`). Earlier we changed the schema to
      require these.
- [ ] **Upload a scanned (image-based) lab PDF** and confirm the vision
      path produces results with `page_or_section` like `"page N"`.
- [ ] **Upload a digital (text-extractable) lab PDF** and confirm the text
      path produces results with `page_or_section` of `"text extraction"`.
- [ ] **Upload a PNG/JPEG** of a lab report and confirm the single-image
      vision path works end-to-end.
- [ ] **Ask a clinical-decision query** ("what dose of metformin should I
      prescribe?") and confirm the safe-refusal preamble appears.
- [ ] **Ask a question that doesn't need extraction** (e.g. "what's the BP
      target for adults?") and confirm the supervisor skips the
      `intake_extractor` node — check the routing log emitted with the
      response.

## Section 5 — PHP security boundary

- [ ] **Try to access another physician's patient** — e.g. log in as
      physician A, manually craft a request to `/agent-query.php?pid=N`
      where N is patient with no encounter or schedule with A. Expect 403
      Forbidden, and a row in `copilot_audit_log` with action `denied`.
- [ ] **Confirm guard fires from inside Orchestrator** — even if you
      somehow bypass the endpoint check (theoretical), the orchestrator's
      defence-in-depth call should still 403.
- [ ] **Spot-check `form_encounter` query** — the queries now go through
      `QueryUtils::fetchSingleValue`. Open phpMyAdmin, find a patient with
      encounters, and confirm a positive auth check actually works.

## Section 7 — PHP endpoints

- [ ] **Idle the page past the session timeout, then send a chat** —
      should now 401 (chat.php was missing the `SessionTracker::isSessionExpired()`
      check; this verifies the fix landed).
- [ ] **Upload a doc and immediately query** — confirms `_bootstrap.php`
      loads correctly across all three endpoints (a typo would surface
      as a fatal "class not found").
- [ ] **Send a CSRF-stripped request** to each endpoint — should reject.
- [ ] **Send a request with no `pid`** to each endpoint — should reject.

## Section 6 — PHP business logic

- [ ] **Open chat for a fresh patient** — confirm the W1 flow still
      produces a snapshot card, sources panel, streamed bullets, and 3
      suggestion chips. (No behavior change intended; this verifies the
      Orchestrator refactor.)
- [ ] **Send a follow-up question** — confirm the FOLLOWUP prompt fires
      (1-2 chips, terser answer) and citations still resolve.
- [ ] **Confirm session caching still works** — second open of the same
      patient on the same day should not re-run the brief tool (no `tools_called` entry on second turn).
- [ ] **Verify all snapshot fields populate** — meds, labs, allergies,
      problems, documents. The PatientBriefTool now goes through QueryUtils;
      a typo in any query would surface here.
- [ ] **Check upcoming appointment lookup** — patient with appointment
      tomorrow (not today) should still surface in the snapshot.

## Section 4 — FastAPI surface

- [ ] **Verify the `/query` SSE event sequence** is unchanged: order should
      be `status → citations → delta* → suggestions → done`. Open browser
      devtools network tab and inspect the EventStream messages.
- [ ] **First `/ingest` after deploy rebuilds the cache** — the disk dir was
      wiped during the refactor.
- [ ] **Send an `/ingest` with `doc_type="referral_letter"`** (a value not
      in the Literal set) and confirm a 422 with a Pydantic error.
- [ ] **Send a `/query` with a 600-char query** and confirm 422.
- [ ] **Hit `/health`** during startup before lifespan completes — should
      either fail or queue until the graph is ready (FastAPI's behaviour).

