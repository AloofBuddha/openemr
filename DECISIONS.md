# DECISIONS.md

Design decisions, interview preparation, and pre-search checklist responses for the Clinical Co-Pilot. Every answer here either traces to an existing document or flags an open question that must be resolved before the corresponding code is written.

**Status key:** ✅ Decided and documented | 🔶 Partially answered, needs depth | ❌ Open — must resolve before building

---

## Interview Questions

### Your Audit

**Walk us through your most important finding.** ✅

The per-patient authorization gap. OpenEMR's REST API checks whether a user has the `patients` role permission — not whether that user has a care relationship with the specific patient being queried. Any credentialed user can retrieve any patient's record. In a multi-provider clinic this means Dr. Rivera could query Dr. Chen's patients without triggering any ACL violation. The agent must enforce care-relationship checks at the service layer because the REST layer will not. This single finding determined the integration pattern for the entire architecture: direct service layer calls through `PatientAccessGuard`, not REST API calls.

See: `AUDIT.md §1`, `ARCHITECTURE.md §3`

---

**What would you have missed if you had skipped the audit and gone straight to building?** ✅

Three things that would have silently broken the agent:

1. **The authorization gap** — would have built on the REST API and inherited cross-panel data leakage by default, with no error signal.
2. **`chart_tracker` not being populated** — would have shipped an agent that accesses PHI with no HIPAA-compliant audit trail.
3. **The `procedure_order_code` JOIN requirement** — `labdata_fragment.php` silently returns "No lab data documented" if `procedure_order_code` is empty. Would have spent hours debugging why the Labs card was empty in the agent with no error to chase.

---

**How did the audit change your AI integration plan?** ✅

Three concrete changes:

1. Integration point moved from REST API → direct PHP service layer calls. Eliminates the auth gap and removes per-request HTTP overhead.
2. `PatientAccessGuard` became a mandatory first step before any tool executes, not an optional add-on.
3. `copilot_audit_log` is a first-class table in the module schema, not an afterthought — specifically to fill the `chart_tracker` gap and satisfy HIPAA disclosure accounting.

---

### Your Architecture

**Why did you design the verification layer the way you did?** ✅

Structural rather than post-hoc. The model cannot cite a record that was not returned by a tool, because citation IDs are generated from tool results at request time and passed into the prompt context. `SourceAttributionChecker` then cross-checks every `citation_id` in the response against that registry before display. A hallucinated dosage — "lisinopril 20mg" when the record says 10mg — gets caught because the registry has the ground truth.

Explicitly documented limitation: the verification layer catches wrong specifics but cannot catch errors of omission. If a medication exists outside OpenEMR, the agent correctly says it's not in the record — but cannot distinguish "not recorded" from "doesn't exist." The UI must communicate this on every response.

See: `ARCHITECTURE.md §6`

---

**What does your agent do when a tool fails or a record is missing?** ✅

Partial response with explicit gaps, never a silent failure or crash. Tools run in parallel with per-tool timeouts (2s for individual queries, 2s/patient for UC-5 schedule scan). A timed-out or failed tool produces a flag in the response: *"Lab results unavailable — retrieval timeout"*, not a blank section and not a fabricated answer. `copilot_audit_log` records tool failures with reason and duration. The physician sees exactly what's known and what couldn't be retrieved.

See: `ARCHITECTURE.md §8`

---

**Where are the trust boundaries in your system, and how are they enforced?** ✅

Three boundaries, each enforced structurally:

1. **Session boundary** — the module runs inside OpenEMR's authenticated PHP session. Every request carries the physician's session identity. No unauthenticated path to the agent endpoint exists.
2. **Care relationship boundary** — `PatientAccessGuard` checks that the requesting physician has a recorded encounter or a today's-schedule entry for the requested patient before any tool executes. This also applies to name resolution: "John Smith" resolves only against the requesting physician's panel, preventing cross-provider leakage even when two patients share a name.
3. **LLM boundary** — PHI never appears in the system prompt. It arrives only in structured tool result JSON. The model can only cite IDs from the registry it was given; it cannot assert facts about records it was not shown.

---

### Your Evaluation

**What does your eval suite test that a happy-path demo would not reveal?** 🔶

Planned cases (eval suite not yet built):

- **Auth bypass**: Dr. Rivera queries Dr. Chen's patient by name — must be refused, not answered
- **Name collision**: two patients named "John Smith" across providers — must resolve to the querying physician's patient
- **Missing data**: patient with no labs — agent must say "no labs on record," not confabulate
- **Out-of-scope query**: "What is first-line treatment for hypertension?" — must refuse (generic clinical question, not patient-specific)
- **Partial tool failure**: one tool times out in a parallel brief call — must return partial response with flag, not crash
- **Prompt injection**: query contains instruction-like text attempting to override system prompt — must be treated as data, not instruction
- **Ambiguous patient reference**: "brief me on my patient" with no patient in context — must ask for clarification

---

**What did you find when you ran it?** ❌

Eval suite not yet built. This section to be filled after Early Submission.

---

**What would you add to it next?** 🔶

- Temporal consistency: does the agent correctly describe lab trends vs single values?
- Multi-turn context retention: does context from turn 1 correctly inform turn 2 within a session?
- Response length compliance: do responses exceed the 20–30 second reading budget?
- Follow-up suggestion relevance: are generated follow-ups grounded in what was actually said?

---

### Production Thinking

**How would you scale this to a 500-bed hospital with 300 concurrent clinical users?** 🔶

Current architecture breaks at scale in three places:

1. **Database**: encounter query is an 8+ table join with no caching. At 300 concurrent users, this becomes the bottleneck. Required: read replica for agent queries; Redis cache for patient briefs (5-min TTL); materialized view or indexed cache of physician-patient relationships for `PatientAccessGuard`.
2. **PHP concurrency**: PHP fibers handle a few dozen parallel tool calls; at 300 concurrent users, the agent orchestrator needs a dedicated async service (Go or Node) separate from the PHP request lifecycle.
3. **LLM cost**: at 300 users × 20 patients/day × $0.0075/brief = $45/day for briefs alone. Introduce `claude-haiku` for UC-5 bulk scans (lower stakes, structured output); reserve Sonnet for per-patient briefs. At 10K users: tiered model selection becomes critical, and a semantic cache (similar queries → cached responses for same patient within session) reduces redundant LLM calls.

Token cost does not scale linearly with users — caching and model tiering are the architectural levers.

---

**What would you need to change before you'd be comfortable with a real physician relying on this?** 🔶

In priority order:

1. Execute BAA with Anthropic before any real patient data touches the API
2. Validate that `copilot_audit_log` satisfies HIPAA disclosure accounting requirements (or establish that it supplements `chart_tracker`, which must also be fixed)
3. Run adversarial eval against a realistic (not demo) patient dataset — demo data is clean and complete; real data has nulls, format inconsistencies, duplicates
4. Make the agent's data boundary visible in the UI on every response: *"This response is based on records in OpenEMR as of [timestamp]. Medications or diagnoses managed outside this system are not reflected."*
5. Incident response plan: what happens when the agent returns something clinically wrong and a physician acts on it?

---

**What failure mode worries you most, and why?** ✅

Errors of omission. The verification system catches hallucination against retrieved data — wrong dosage, wrong date, fabricated value. What it cannot catch: a medication prescribed by an outside specialist and never entered into OpenEMR, a diagnosis that was verbal and never coded, a referral that happened but wasn't documented. The agent returns "no blood thinner on record" — factually correct, potentially dangerous if the physician interprets absence as confirmation.

This is not solvable with current architecture. It requires the physician to internalize the agent's data boundaries. The UI must communicate this on every single response, not just in onboarding documentation. The risk is that a physician who has received twenty correct answers treats the twenty-first as equally reliable when it is actually "correct given incomplete data."

---

## Pre-Search Checklist

### Phase 1: Define Your Constraints

**1. Domain Selection** ✅

- **Use cases**: UC-1 pre-encounter brief, UC-2 medication question, UC-3 returning patient history, UC-4 lab trend, UC-5 day-start schedule scan. All documented in `USERS.md`.
- **Verification requirements**: source attribution for every factual claim (traceable to specific record + field); domain constraint enforcement (agent may not diagnose, may not answer generic clinical questions, may not access records outside the requesting physician's panel).
- **Data sources**: `patient_data`, `form_encounter`, `form_soap`, `prescriptions`, `procedure_result`, `procedure_order`, `procedure_order_code`, `lists`, `openemr_postcalendar_events`, `form_vitals`.

---

**2. Scale & Performance** ✅

- **Query volume**: demo — 2 physicians × ~10 patients/day × 1–2 queries each = ~40 queries/day. Clinic-scale — 2–10 physicians, ~200 queries/day.
- **Acceptable latency**: first token ≤3s; full brief ≤10s total; full interaction ≤90s hard constraint.
- **Concurrent users**: demo — 2; architecture supports tens; 300+ requires async orchestration layer and read replica (see Production Thinking above).
- **Cost per query**: ~$0.0075/brief at Sonnet pricing (est. 1K input + 300 output tokens). ~$0.15/physician/day at 20 patients. Acceptable at demo and clinic scale.

---

**3. Reliability Requirements** ✅

- **Cost of wrong answer**: HIGH — potential direct patient harm. Errors of omission are the primary risk; hallucination against retrieved data is the secondary risk.
- **Non-negotiable verification**: source attribution for every factual claim. Unverified claims rendered with ⚠ prefix, never suppressed.
- **Human-in-the-loop**: physician reviews every response and makes all clinical decisions. Agent surfaces data; physician acts. Agent explicitly refuses diagnostic conclusions.
- **Audit/compliance**: `copilot_audit_log` per request (physician ID, patient UUID, tools called, token cost, verification result). BAA required before real patient data is used.

---

**4. Team & Skill Constraints** ✅

- **Agent framework**: direct Claude API (tool use) via Anthropic SDK, no LangChain or similar. Rationale: fewer dependencies, more control over verification pass, simpler debugging.
- **Domain expertise**: not a clinician. Constrained by this to data retrieval and synthesis; no clinical reasoning. Scope refusals are a safety mechanism, not a limitation.
- **Eval/testing**: PHPUnit for service-layer unit tests; custom eval harness (PHP CLI scripts) for agent-level correctness testing against demo dataset.

---

### Phase 2: Architecture Discovery

**5. Agent Framework Selection** ✅

- **Single agent**: all five use cases fit a single-turn tool-calling pattern. No use case requires agent-to-agent communication or independent sub-agents.
- **State management**: PHP session cache (5-min TTL) for patient brief within a session; conversation history held in session for multi-turn. No external state store at this scale.
- **Tool complexity**: 5 tools, each read-only, each mapped to exactly one use case. Tools run in parallel for UC-1. No tool chaining needed.

---

**6. LLM Selection** ✅

- **Model**: `claude-sonnet-4-6` — tool use, 200K context window, strong instruction-following for citation discipline, streaming.
- **Structured output**: JSON response with `citation_id` per claim, enforced by system prompt + post-processing `SourceAttributionChecker`.
- **Context window**: patient brief fits comfortably; UC-5 full-panel scan may approach limits for large panels (50+ patients). Mitigation: paginate UC-5 or switch to haiku for the scan phase.
- **Cost**: ~$0.0075/brief at current pricing. Haiku substitution for UC-5 (~10× cheaper, lower stakes query).

---

**7. Tool Design** ✅

| Tool | Use Case | Data Sources | Timeout |
|------|----------|-------------|---------|
| `get_patient_brief` | UC-1 | patient_data, form_encounter, prescriptions, procedure_result, lists | 800ms |
| `get_medications` | UC-2 | prescriptions, lists, procedure_result (renal labs) | 300ms |
| `get_encounter_history` | UC-3 | form_encounter, form_soap | 500ms |
| `get_lab_trend` | UC-4 | procedure_result, procedure_order_code | 400ms |
| `get_today_schedule` | UC-5 | openemr_postcalendar_events + per-patient scan | 2000ms |

- **External API dependencies**: none. All calls go to OpenEMR service layer directly.
- **Data**: real demo dataset, no mocks.
- **Error handling**: timeout → partial response + flag; exception → logged + "unavailable" note in response.

---

**8. Observability Strategy** ✅

- **Tool**: custom `copilot_audit_log` MariaDB table (no external service). Rationale: no PHI leaves the OpenEMR database; consistent retention policy with patient records; no third-party dependency for HIPAA-sensitive data.
- **Metrics tracked**: tools called (name, duration_ms, success, result_size), LLM model, input/output tokens, total_ms, verification pass/fail, flagged claim count.
- **Answers the four required questions**: step order (tools_called JSON array), step duration (duration_ms per entry), tool failures (success flag + failure reason), token cost (input_tokens × model pricing).
- **Real-time monitoring**: SQL queries against `copilot_audit_log` sufficient at demo scale. Grafana or equivalent deferred to production.

---

**9. Eval Approach** 🔶

- **Correctness measure**: response claims cross-checked against ground truth in demo database via SQL. Pass = every cited value matches the record it cites.
- **Ground truth**: demo dataset (deterministic — exact known values for all 18 patients).
- **Automated vs human**: automated for data accuracy (SQL cross-check); manual for response quality (is it clinically sensible? is the follow-up suggestion relevant?).
- **CI integration**: deferred. Manual eval runs before each submission checkpoint. ❌ Must be wired before Early Submission.

---

**10. Verification Design** ✅

- **Claims verified**: all factual assertions — medication names/doses, lab values/dates, encounter dates, problem list entries, appointment reasons.
- **Fact-checking source**: citation registry built from tool results at request time. Registry maps `citation_id → {table, record_id, field, value}`.
- **Confidence model**: binary (verified/unverified). Verified = `citation_id` present and value matches registry. Unverified = rendered with ⚠, not removed.
- **Escalation trigger**: any mismatch between response claim and registry value → downgrade to unverified + flag for physician review. No auto-correction of the response text.
- **Known gap**: errors of omission are not detectable by this system. Explicitly disclosed in every response footer.

---

### Phase 3: Post-Stack Refinement

**11. Failure Mode Analysis** ✅

| Failure | Behavior |
|---------|----------|
| Tool timeout | Partial response; missing section flagged; logged |
| Tool exception | Same as timeout; exception type logged |
| Patient record incomplete | Return what exists; note missing fields explicitly |
| Ambiguous patient name (multiple matches in panel) | Ask for clarification — never guess |
| Ambiguous patient name (cross-provider match only) | Return the requesting physician's patient |
| Out-of-scope query | Refuse with explanation; suggest in-scope rephrasing |
| No patient in context | Ask which patient before executing any tool |
| LLM API timeout | Return tool results directly as structured data without synthesis; log |

- **Rate limiting**: not implemented. Relevant at production scale; deferred. ❌
- **Graceful degradation**: always return what's available. Never block a response because one tool failed.

---

**12. Security Considerations** ✅

- **Prompt injection**: user input is a `user` turn, not concatenated into the system prompt. Tool results are structured JSON from the service layer, not user-controlled strings. PHI in tool results is not user-controlled input.
- **Data leakage**: `PatientAccessGuard` before every tool call; PHI never in system prompt; `copilot_audit_log` stores query text but not full LLM response.
- **API key management**: Anthropic API key in environment variable, not in code, not in version control. Key rotation documented in ops runbook. ❌ Ops runbook not yet written.
- **Audit logging**: `copilot_audit_log` per request with physician ID, patient UUID, tools called, verification result.

---

**13. Testing Strategy** 🔶

- **Unit tests (tools)**: PHPUnit — each tool tested against demo dataset for known return values. ❌ Not yet written.
- **Integration tests**: full agent flow (query → PatientAccessGuard → tool calls → LLM → verification → response). ❌ Not yet written.
- **Adversarial tests**: auth bypass, name collision, out-of-scope queries, prompt injection attempts, missing-data queries. ❌ Not yet written.
- **Regression**: eval suite run before each deployment checkpoint. ❌ Not yet wired.

---

**14. Open Source Planning** ✅

- This is a fork of OpenEMR (GPL-3). The `oe-module-clinical-copilot` module is GPL-3 by inheritance.
- All code, docs, and eval datasets in `github.com/AloofBuddha/openemr`.
- No separate community engagement plan for Week 1 sprint.

---

**15. Deployment & Operations** 🔶

- **Hosting**: DigitalOcean droplet (198.211.103.246), Docker Compose, same stack used for development.
- **URL**: http://198.211.103.246.nip.io
- **CI/CD**: manual deploy — SSH + git pull + docker compose restart. ❌ No automated pipeline.
- **Monitoring**: `copilot_audit_log` queries. No external alerting at this stage.
- **Rollback**: `git revert` + redeploy. No blue/green at this scale.

---

**16. Iteration Planning** 🔶

- **User feedback**: Gauntlet AI review sessions after each checkpoint submission.
- **Eval-driven cycle**: expand eval suite based on failure modes found in each review. Every new failure mode gets a test case before the fix is written.
- **Feature prioritization**: features trace to `USERS.md` use cases. No use case = no feature.
- **Long-term**: out of scope for Week 1. Architecture decisions (service layer integration, single-agent) are made to avoid lock-in.

---

## Open Questions (must resolve before writing code)

| # | Question | Blocks |
|---|----------|--------|
| 1 | What OpenEMR tab/panel mechanism will host the co-pilot UI? (auto-opened tab vs persistent side panel vs slide-over) | UI implementation |
| 2 | How does the PHP module make async parallel tool calls? (fibers, pcntl, or sequential with streaming start?) | Tool orchestration |
| 3 | How is the Anthropic API key injected into the Docker environment on prod? | Deployment |
| 4 | Does `copilot_audit_log` fully satisfy HIPAA disclosure accounting, or must `chart_tracker` also be populated? | Compliance |
| 5 | What is the follow-up suggestion generation approach — same LLM call or separate? | Response format |
| 6 | How are eval runs triggered and their results recorded? | Early Submission |
