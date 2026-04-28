# MVP Demo Script

Target: 4 minutes. Structured around the three things the graders want: decisions + tradeoffs, hardest problems, architecture.

---

## 1. The Problem (30s) — no screen, or show patient demographics page

> "A physician walking between exam rooms has 90 seconds to remember who their next patient is, why they're here, and what's changed since the last visit. OpenEMR has all that information — it requires clicking through 4–6 screens to find it. By the time you're done, you've spent the visit looking at a screen instead of the patient. That's the problem this agent solves."

---

## 2. The Audit Finding That Changed Everything (45s) — show AUDIT.md briefly

> "Before writing a line of agent code I audited OpenEMR's codebase. The most important finding: the REST API checks whether a user has the 'patients' permission — but not whether they're authorized to access *this specific patient*. Dr. Rivera could query Dr. Chen's patients with no ACL violation triggered. That single finding changed the entire architecture. Instead of building on the REST API — which would have inherited that gap — the agent calls OpenEMR's PHP service layer directly, where I can enforce care-relationship checks before any data is retrieved."

---

## 3. Architecture (60s) — show ARCHITECTURE.md diagram or module folder structure

> "The agent is a custom OpenEMR module. When a physician opens a patient chart, the module fires an SSE request to a PHP endpoint. The orchestrator gathers patient data — today's appointment, last encounter SOAP note, active medications, recent labs — and sends it as a structured message to Claude. Critically, PHI only arrives in the tool results, never in the system prompt. The model is instructed to cite a source number for every specific data point it states. Those source numbers are backed by a registry we build at request time from the actual database records — so when a physician clicks a citation, they see the raw EHR row, not more AI prose. Every request is also logged to a copilot_audit_log table — tools called, timing, token cost — which fills the HIPAA chart-access audit gap I found in the audit."

---

## 4. Live Demo (60s) — prod at http://198.211.103.246.nip.io

> "Here's the live system."

- Log in as Dr. Chen: `sarah.chen` / `Sarah1234!`
- Open a patient with a today's appointment
- Watch the brief stream in — point out it starts within a second or two
- Click one of the underlined citation phrases
- Show the source drawer: *"This is the raw database record — not AI interpretation, the actual prescriptions row."*
- Click "View in chart" — show it scrolling to the relevant card on the page

> "The physician never leaves this page. One glance, one tap to verify any claim."

---

## 5. Hardest Problems (45s)

> "Two hard problems worth calling out. First: **errors of omission**. The verification system catches the model citing wrong values — wrong dosage, wrong date. What it can't catch is when something exists outside OpenEMR and was never recorded. The agent will correctly say 'no blood thinner on record' — which is factually true, but potentially dangerous if the physician reads that as a clinical negative. The UI has to communicate this every single time, not just in onboarding. Second: **HIPAA constraints on observability**. Using a managed tracing tool like LangSmith means PHI leaves your infrastructure. The solution is layered: runtime observability stays in our own audit log table with no prompt content stored; the eval harness runs against synthetic demo data only and can use LangSmith without a compliance concern."

---

## 6. What's Next (30s) — show evals/ directory briefly

> "UC-1 is shipped. The eval harness runs 12 test cases — including prompt injection, empty records, and patients with abnormal labs — to catch regressions as we build. UC-2 through UC-5 add medication interaction questions, full encounter history, lab trends, and a day-start schedule scan. The architecture is ready for those; the eval suite is designed to grow with them."

---

## Before You Hit Record

- [ ] Log into prod, confirm a patient has an appointment today (Phil Belford is pinned)
- [ ] Clear the brief cache so it streams live: run in Docker MySQL — `DELETE FROM copilot_brief_cache WHERE patient_id = 1;`
- [ ] Have AUDIT.md, ARCHITECTURE.md, and the module folder open in tabs to cut to
- [ ] Keep DECISIONS.md open as a crib sheet for any question you want to go deeper on

## Crib Sheet — if you go off script

**Why service layer over REST API?** REST layer has no per-patient auth — any credentialed user can query any patient. Service layer is where I can enforce the care-relationship check.

**Why Harvey-style drawer over footnotes?** Footnotes just show a number. The drawer shows the raw EHR record — field by field, from the actual database row. The physician can see it's not more AI output.

**Why not LangGraph?** This agent is single-turn. LangGraph adds stateful graph complexity that has no use case yet. It becomes relevant when we add multi-turn conversation for UC-2 forward.

**Biggest unsolved problem?** Errors of omission. The system can't detect what's missing from the record. A medication prescribed by an outside specialist and never entered into OpenEMR is invisible to the agent — and the agent's "not on record" response looks identical to a genuine negative.

**Cost at scale?** ~$0.005–0.009 per brief at Sonnet pricing. At 1,000 users/day that's ~$1,000/month. Architectural levers: prompt caching on the static system prompt (~90% discount on input tokens), Haiku for bulk UC-5 scans, and pre-computing overnight briefs at high scale.
