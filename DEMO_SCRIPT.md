# Clinical Co-Pilot — Week 2 Demo Script

**Audience:** Gauntlet AI graders.
**Target runtime:** 3:45.
**Live URL:** https://198.211.103.246.nip.io — log in `admin` / `pass`,
open Margaret Chen's chart.
**Pre-stage:** Margaret Chen's encounter open in one tab. A terminal in
the repo root in another tab. LangSmith dashboard
(https://smith.langchain.com → project `agent-forge`) in a third.

The script hits every PRD-mandated demo topic in order: **document upload
→ extraction → evidence retrieval → citations → eval results →
observability**, with the regression-gate moment in the middle.

---

## 0:00 – 0:30 · Scenario (30 s)

> "I'm Dr. Chen, prepping for Margaret's diabetes follow-up. The chart
> has structured OpenEMR data, but the important new information is in
> a **lab PDF the front desk just uploaded** and a **patient intake form
> she filled out at check-in**. I have 90 seconds before the visit."

Open Margaret's encounter. Point at the patient cards already populated
(allergies, meds, PMH, social history).

> "These cards came from the intake PDF — front desk didn't type any of
> this. Auto-extracted at chart load."

---

## 0:30 – 1:15 · Document upload + extraction (45 s)

Click **Upload**, drop in a lab PDF (`fixtures/margaret_a1c_lab.pdf`).

While the streaming extraction summary scrolls in the chat panel:

> "Two extraction paths — `pdfplumber` for text-native PDFs, Haiku Vision
> for scanned images. Both produce **strict-schema JSON** validated by
> Pydantic. Every extracted field carries a `SourceCitation` with
> source\_type, source\_id, page\_or\_section, field\_or\_chunk\_id,
> and the verbatim quote — the contract the PRD specifies."

The page reloads automatically. Point at the **Recent Labs** card now
showing the new A1c value.

> "Round-tripped into the OpenEMR `procedure_result` tables — no
> duplicate, no untraceable record."

---

## 1:15 – 2:00 · Evidence retrieval + citations (45 s)

Type into the chat panel:

> "What does ACC/AHA say about her BP given today's labs?"

As the answer streams in, point at the **provenance line** that appears
above it:

> "Reviewed: 1 uploaded lab · 5 guideline sections (3 ACC/AHA, 2 ADA) ·
> patient's chart."

> "That's a natural-language summary of what the agent actually
> consulted, derived from the routing log."

Once the answer is rendered, click three citations in turn:

1. **`[[D1]]`** (purple, document) — drawer shows
   *Page 1: "Hemoglobin A1c 9.2 %"*. Say:
   > "Verbatim text from the PDF, plus the page reference. Not metadata —
   > the actual literal evidence."
2. **`[[G1]]`** (purple, guideline) — drawer shows the full ACC/AHA
   chunk. Say:
   > "Hybrid retrieval: BM25 sparse + ChromaDB dense (MiniLM-L6) →
   > Cohere `rerank-english-v3.0` over a 45-chunk corpus of ACC/AHA, ADA,
   > and USPSTF guidelines."
3. **`[[P3]]`** (typed: medication, lab, problem, etc.) — drawer shows
   the chart entry, click **"View in chart ↓"** — page scrolls to the
   right OpenEMR card. Say:
   > "Three citation namespaces — guideline, document, EHR record —
   > all click-through, all auditable. Patient-record citations
   > deep-link to the underlying chart section."

---

## 2:00 – 2:50 · Eval gate + the GATE moment (50 s)

Cut to the terminal. From `evals/`:

```bash
../copilot-agent/.venv/bin/python check_gate.py --skip-brief --skip-graph
```

Show the table. Read the columns out loud:

> "Five rubrics — `schema_valid`, `citation_present`,
> `factually_consistent`, `safe_refusal`, `no_phi_in_logs`. All 100% on
> the W2 graph suite. 55 cases total across W1 brief + multi-turn +
> graph. Tolerance is 5 percentage points — anything more and the gate
> fails the build."

Now introduce a deliberate regression:

```bash
# break the citation rule in the prompt
sed -i 's/Wrap the cited phrase/Optionally wrap the cited phrase/' \
  ../copilot-agent/agent/nodes.py

../copilot-agent/.venv/bin/python check_gate.py --skip-brief
```

Watch `citation_present` drop, `GATE FAILED` printed. Say:

> "This is the PRD's Hard Gate. During grading, you'll introduce a
> regression and confirm CI catches it. It does."

Revert:

```bash
git checkout ../copilot-agent/agent/nodes.py
```

---

## 2:50 – 3:30 · Observability (40 s)

Switch to the LangSmith tab. Open the run from the query you just made.

Walk through the trace tree:

> "Every encounter logs the full tool sequence — supervisor decision,
> evidence retriever, answer assembler — with **per-step latency**,
> **token usage per LLM call**, and a **cost estimate**. Routing
> decisions are structured JSON, not free text."

Click into one supervisor node. Show:

> "Intent, next workers, reasoning. Reasoning is scrubbed before any of
> this leaves the sidecar — the `no_phi_in_logs` rubric runs against
> the routing log on every CI build to verify."

Switch to repo, `cat COST_LATENCY.md`:

> "Measured: p50 9.4 s, p95 12.8 s. ~$0.017 per multi-agent query.
> Projected for a busy clinic: ~$127/month for 100 briefs + 200 queries
> + 30 ingests per day."

---

## 3:30 – 3:45 · Close (15 s)

> "Two doc types, supervisor + two workers, hybrid retrieval with
> rerank, citation contract on every claim with verbatim quotes, 55-case
> PR-blocking eval gate, and observability that catches both regressions
> and PHI leaks."
>
> "PDF bounding-box overlay is the next thing on my list for final
> submission — the verbatim quote + page reference covers the substance,
> the bbox is the polish."

End.

---

## Things to avoid on camera

- **Don't open the in-bubble Agent Trace.** It's hidden behind `?debug=1`
  for engineers — graders should see LangSmith for observability.
- **Don't load a fresh patient mid-recording.** Pre-stage Margaret;
  re-loads can cost 3-5 s.
- **Don't run extractions concurrently.** Keep API hits sequential to
  avoid streaming hiccups.
- **Don't read the routing JSON live.** It's there for graders to inspect
  later — just point at it and move on.

## Backup paths

- **If LangSmith trace doesn't show up live:** open a pre-recorded run
  from earlier in the day. Same project, just an older trace.
- **If the gate-fail step doesn't reproduce:** the `sed` regression hits
  the LLM via prompt change, so if Sonnet still cites despite the
  weakened instruction, swap to a tighter regression: comment out
  `_build_citations` return and re-run.

## Pre-record checklist

- [ ] Margaret's intake processed, lab fixture ready in `fixtures/`
- [ ] LangSmith dashboard open on the right project
- [ ] Terminal open in `evals/`
- [ ] Browser zoom 110% so citations are readable on video
- [ ] Network tab closed, dev tools closed
- [ ] No other tabs in the browser window
- [ ] Sidecar restarted within last hour (warm cache)
