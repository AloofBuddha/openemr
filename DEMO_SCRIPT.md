# Demo Script + Interview Talking Points

Target: 4–5 minutes for the video. Use this doc as a living log — add a bullet under "Decisions worth calling out" every time you make a non-obvious architectural or engineering choice.

---

## Decisions Worth Calling Out

Each entry below is a non-obvious choice made during the build. These are the things to mention in the demo video and defend in the AI interview.

### Security

**PatientAccessGuard — enforced at the HTTP layer, not the service layer**
The OpenEMR REST API checks whether a user has the `patients` permission, but not whether they're authorized to access *this specific patient*. Dr. Rivera could query Dr. Chen's patient with no ACL violation. The agent's PHP endpoint calls `PatientAccessGuard::assertAccess()` before the tool runs — checks both prior encounter relationship and today's schedule. Returns 403 if neither condition is met.
*Interview angle: "The audit finding that changed the architecture."*

**Prompt injection hardened at three vectors**
Appointment reason, SOAP note fields, and medication note fields can all contain arbitrary text entered by clinic staff. The system prompt explicitly instructs the model to treat SOURCES values as data, not instructions — and to flag (not echo) any field that contains instruction-like text. Tested: all three injection vectors pass at 100%.
*Interview angle: "We don't just rely on Claude's robustness — we named the attack surface explicitly."*

### Verification

**Citation markers grounded in a real source registry**
Every `[[N]]phrase[[/N]]` in the brief maps to a source object built from the actual DB records at request time — not inferred from the LLM's output. When a physician clicks a citation, they see the raw EHR row. If the model cites a number that doesn't exist in the registry, the UI silently drops it. The claim can only be verified against real data.
*Interview angle: "Source attribution is mechanical, not conversational."*

**Brand/generic LLM judge for medication verification**
The medication fabrication check uses regex to detect drug names in the brief that aren't in the patient's prescription list. When something is flagged, a second Haiku call determines whether it's a known brand/generic alias (e.g. "Jardiance" → empagliflozin). Passes if all flagged names resolve; only fails on genuine fabrication. This is a deliberate two-pass design: cheap regex handles 95% of cases, LLM only fires on ambiguous positives.
*Interview angle: "Regex first, LLM only on positive — the cheapest path that's still accurate."*

### Observability

**HIPAA-safe observability split**
Using a managed tracing tool (LangSmith) would mean PHI leaves your infrastructure. The split: runtime observability goes to `copilot_audit_log` — tools called, timing, tokens, cost — stored in the same MariaDB as the patient data, no prompt content. The eval harness uses synthetic demo data only and can safely use LangSmith for run tracking without a compliance concern.
*Interview angle: "Observability and HIPAA pull in opposite directions — the architecture addresses both."*

### Cost

**Session cost model, not per-call**
The co-pilot now supports multi-turn follow-up questions. Each follow-up re-sends the patient context plus conversation history, so cost grows with depth. A brief-only session: ~$0.005. Brief + 2 follow-ups: ~$0.015. Blended effective cost at 70% cache hit rate: ~$0.004/encounter. The server-side brief cache (30-min TTL) and same-day localStorage conversation cache are the primary levers — a physician who revisits the same patient mid-shift triggers one LLM call, not two.
*Interview angle: "The caching architecture is also the cost architecture."*

### Evaluation

**Eval suite covers failure modes, not just happy paths**
15 brief cases + 3 adversarial multi-turn cases. Edge cases include: completely empty record, prompt injection in 3 vectors, cross-physician access, brand/generic drug name aliasing, missing lab/med/encounter sections. All adversarial follow-up cases pass at 100% (cross-patient refusal, no clinical prescription advice, out-of-scope pharmacology acknowledged).
*Interview angle: "What did you find when you ran it? The injection cases caught a real gap we fixed."*

**`--report` flag generates readable markdown**
`python run.py --offline --followup --report eval_results.md` writes a narrative markdown with summary tables + per-case collapsible model output. Built because the LangSmith dashboard wasn't readable for understanding what each test case actually represented.
*Interview angle: "Observability applies to the eval harness too."*

---

## Demo Flow (4 min)

### 1. The Problem (30s) — show patient demographics page

> "A physician walking between exam rooms has 90 seconds to remember who their next patient is, why they're here, and what's changed since the last visit. OpenEMR has all that information — finding it requires clicking through 4–6 screens. By the time you're done, you've spent the visit looking at a screen instead of the patient."

---

### 2. The Audit Finding That Shaped the Architecture (30s) — show AUDIT.md briefly

> "Before writing a line of agent code I audited OpenEMR's codebase. Key finding: the REST API has no per-patient authorization — Dr. Rivera could query Dr. Chen's patients with no ACL violation. That single finding drove the architecture: the agent calls the PHP service layer directly, where I enforce a care-relationship check before any data is retrieved."

---

### 3. Live Demo (90s) — prod at http://198.211.103.246.nip.io

Log in as Dr. Chen: `sarah.chen` / `Sarah1234!`

1. Open a patient with a today's appointment (Phil Belford or Marcus Johnson)
2. Watch the brief stream — point out it starts within ~1s
3. Click an underlined citation phrase
4. Show the source drawer: *"This is the raw database record — not AI interpretation, the actual prescriptions row."*
5. Click "View in chart" — show it scrolling to the relevant EHR card
6. Ask a follow-up question (e.g. "Show me Marcus's A1C trend")
7. Show the multi-turn response with a compact table + new suggestion chips

> "The physician never leaves this page. Inline citations so every claim is verifiable in one tap. Follow-up questions answered in context."

---

### 4. How We Know It Works (45s) — show eval_results.md

> "The eval harness runs 18 cases including prompt injection in three vectors, cross-physician access, brand/generic drug name aliasing, and multi-turn adversarial follow-ups. Most checks run at 100%. The one interesting case: when the model uses a brand name — Jardiance — that isn't in the prescriptions table, a second LLM call determines it's an alias for empagliflozin, which is. Regex first, LLM only on ambiguous positives."

---

### 5. The Hard Problem We Haven't Solved (30s)

> "Errors of omission. The system can't detect what's missing from the record. A medication prescribed by an outside specialist and never entered into OpenEMR is invisible — and the agent's 'not on record' response looks identical to a genuine negative. The UI communicates this limitation on every brief, but it's a constraint the physician must internalize."

---

## Before You Hit Record

- [ ] Log into prod, confirm a patient has an appointment today
- [ ] Clear brief cache so it streams live: `DELETE FROM copilot_brief_cache WHERE patient_id = 1;`
- [ ] Have `eval_results.md` open to cut to for the eval section
- [ ] Have AUDIT.md open to cut to for the audit section

---

## Interview Crib Sheet

**Why service layer over REST API?**
REST layer has no per-patient authorization — any credentialed user can query any patient. Service layer is where the care-relationship check lives.

**Why Harvey-style source drawer over footnotes?**
Footnotes show a number. The drawer shows the raw EHR record — field by field, from the actual database row. The physician can see it's not more AI output.

**Why not stream the brief from a queue / background job?**
The physician opens the chart and needs context immediately. A background job adds latency and complexity with no benefit — the SSE stream starts within one second of page load, and the brief completes in 3–5s. Cache handles repeat loads at $0.00.

**Why not LangGraph or an agent framework?**
This agent is single-pass with a fixed tool set. LangGraph adds stateful graph complexity that has no use case here. It becomes relevant if we add dynamic tool selection or multi-step reasoning chains (UC-3 lab trend analysis).

**Biggest unsolved problem?**
Errors of omission. The system can't detect what's missing from the record.

**Cost at scale?**
~$0.004/encounter blended (70% cache hit rate, ~40% of sessions include follow-ups). At 10K users: ~$638/month on LLM alone. Key levers: appointment-scoped brief cache, same-day localStorage conversation cache, Haiku for follow-up turns at scale. Full breakdown in `COST_ANALYSIS.md`.

**What did you find when you ran the evals?**
The prompt injection case in the appointment reason field was initially failing — the model echoed the injected string verbatim. Fixed by adding an explicit system prompt instruction to flag (not echo) field values containing instruction-like text. All three injection vectors now pass.
