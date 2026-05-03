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

## SHORT Demo Flow (3 min target)

Keep each section tight. Say one thing, show it, move on. Don't read from notes.

---

### 1. Problem (20s) — show OpenEMR patient list / chart tabs

> "A physician walking between rooms has 90 seconds to remember who their next patient is. OpenEMR has everything they need — spread across six tabs. The co-pilot collapses it to a 5-bullet brief before they walk in."

---

### 2. Live Demo (80s) — prod at http://198.211.103.246.nip.io

Log in: `sarah.chen` / `Sarah1234!`

1. Open Phil Belford (appointment today). Brief starts streaming immediately.
2. Point out the underlined citation phrases while it streams.
3. When done: click a citation — show the source drawer. Say: *"This is the raw database row — not an interpretation. The physician can verify every claim in one tap."*
4. Click "View in chart" — shows it scrolling to the relevant EHR section.
5. Ask the follow-up: *"Show me his A1C trend"* — show the compact table + new suggestion chips.

> "Never leaves the page. Every claim cited. Multi-turn context preserved in the same session."

---

### 3. Architecture Round Trip (35s) — talk over the code or a diagram

Explain the full call stack verbally:

> "When the page loads, a React bundle bootstraps inside the OpenEMR frame. It reads the patient ID from the DOM, checks localStorage for a same-day cached brief, and on a cache miss fires a POST to the PHP backend.
>
> The PHP endpoint — before touching any data — runs PatientAccessGuard: checks whether this physician has a prior encounter with this patient OR an appointment today. No relationship, 403.
>
> Past the guard, PatientBriefTool runs five SQL queries: demographics, today's appointment, last encounter with its SOAP note, active prescriptions, and recent labs. It builds a source registry — a numbered map from each data point to its raw database row.
>
> That structured block goes to Claude Haiku as a SOURCES message. The model streams back bullets with [[N]]phrase[[/N]] citation markers. The PHP layer pipes it out as Server-Sent Events. The frontend strips the markers as they arrive, renders each bullet live, and on completion resolves citations against the source registry to power the drawer.
>
> Total latency: ~1s to first token. Same patient mid-shift: zero latency — 30-minute server cache."

---

### 4. Evals (25s) — show eval_results.md

> "35 test cases: 25 brief cases and 10 adversarial multi-turn cases. The brief cases cover missing data, six injection vectors — including unicode obfuscation and social engineering — polypharmacy, stale encounter flagging, brand/generic drug aliasing. The multi-turn cases test cross-patient refusal, PII requests, roleplay jailbreaks, system prompt extraction, false diagnosis confirmation. Most checks at 100%. The one interesting find: injection in the appointment reason field was originally failing — the model echoed the injected string. Fixed by explicitly naming the attack surface in the system prompt."

---

### 5. Limitation (10s)

> "The one problem this can't solve: errors of omission. A medication from an outside provider that was never entered is invisible — and 'not on record' looks the same as a genuine negative. The brief says so on every load."

---

## Before You Hit Record

- [ ] Log into prod, confirm Phil Belford has a today appointment
- [ ] Run `DELETE FROM copilot_brief_cache WHERE patient_id = 1;` to clear server cache
- [ ] Open `eval_results.md` tab for the evals cut
- [ ] Practice the architecture paragraph out loud once — it's the hardest part to say cleanly

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
