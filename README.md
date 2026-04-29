# Clinical Co-Pilot

An AI agent embedded in OpenEMR that gives physicians a 90-second patient briefing between exam rooms. Built as part of the Gauntlet AI Week 1 AgentForge sprint.

**Repo:** https://labs.gauntletai.com/benjamincohen/agentforge  
**Live demo:** http://198.211.103.246.nip.io

---

## What it does

Dr. Sarah Chen sees 18–22 patients a day. Between rooms she has 90 seconds to reconstruct who the next patient is, why they're here, and what changed since the last visit — across 4–6 screens in the EHR. This agent collapses that into a single conversational query.

When a physician opens a patient chart, the **Clinical Co-Pilot widget** appears at the top of the page and automatically streams a 4–6 bullet pre-encounter brief covering:

- Why the patient is here today (from today's appointment)
- What changed since the last visit (delta from the last SOAP note)
- Active medications (flagged concerns)
- Recent labs (flagged abnormals)

Every data point in the brief carries an inline citation number. Clicking one opens a **source drawer** — a Harvey-style right-side panel showing the raw EHR record fields (date, values, reference ranges, SOAP note text verbatim) so the physician can verify the data is from the chart, not hallucinated. Each source includes a "View in chart" link to the native OpenEMR record.

Briefs are cached per-patient per-physician per-day (30-minute TTL) and served from cache on repeat loads. A refresh button forces a new generation.

Use cases documented in [`USERS.md`](USERS.md).

---

## Running locally

### Prerequisites

- Docker + Docker Compose
- ~4 GB free disk space

### Start the stack

```bash
cd docker/development-easy
docker compose up --detach --wait
```

First run takes 3–5 minutes while the container initializes OpenEMR.

### Load demo data

From the repo root:

```bash
scripts/demo_load.sh
```

This loads Cedar Family Medicine — two physicians, 18 patients, full clinical histories. To wipe and reload from scratch:

```bash
scripts/demo_load.sh --reset
```

### Access

| URL | Purpose |
|-----|---------|
| http://localhost:8300 | OpenEMR application |
| http://localhost:8310 | phpMyAdmin (DB browser) |

### Credentials

| Login | Password | Role |
|-------|----------|------|
| `sarah.chen` | `Sarah1234!` | Dr. Sarah Chen — Family Medicine (13 patients) |
| `marcus.rivera` | `Marcus1234!` | Dr. Marcus Rivera — Internal Medicine (5 patients) |
| `admin` | `pass` | Admin |

---

## Demo practice

**Cedar Family Medicine** — 4801 Burnet Road Suite 200, Austin TX 78756

Dr. Chen's panel includes patients across hypertension, diabetes, COPD, CAD, anxiety, and more — all with multi-year encounter histories, lab trends, active medications, and today's appointments pre-loaded on the calendar.

---

## Building the Co-Pilot UI

The widget is a React/TypeScript app built with Vite. Source lives in:

```
interface/modules/custom_modules/oe-module-clinical-copilot/copilot-ui/
```

Output is a single self-contained bundle at `public/js/copilot-bundle.js` (CSS inlined).

**First-time setup:**

```bash
cd interface/modules/custom_modules/oe-module-clinical-copilot/copilot-ui
npm install
```

**Rebuild after UI changes:**

```bash
cd interface/modules/custom_modules/oe-module-clinical-copilot/copilot-ui
npm run build
```

The bundle is committed to the repo so the app runs without a build step for anyone who just clones and runs Docker. Only rebuild when you change files under `copilot-ui/src/`.

---

## Project structure

```
sql/
  demo_seed.sql      Base patients, providers, encounters, labs, meds
  demo_augment.sql   SOAP notes + vitals for all encounters
  demo_augment2.sql  UI config, Dr. Rivera's clinical data, lab fixes
  demo_augment3.sql  procedure_order_code (required for Labs card), SOAP backfill
  demo_augment4.sql  UC-specific data (Wanda referral/Rx, Susan mammogram referral)
scripts/
  demo_load.sh       Single command to load all demo data
interface/modules/custom_modules/oe-module-clinical-copilot/
  src/
    Bootstrap.php              Module entry — hooks into OpenEMR event system
    Agent/Orchestrator.php     LLM orchestration, SSE streaming, cache logic
    Agent/Tools/PatientBriefTool.php  Data gathering (appt, SOAP, meds, labs)
    Observability/AgentAuditLogger.php
  public/
    chat.php                   SSE endpoint (POST → streams events to browser)
    js/copilot-bundle.js       Built React/TS widget (CSS inlined, ~187KB)
  copilot-ui/src/
    main.tsx                   Widget mount + DOM repositioning
    CopilotPanel.tsx           Streaming hook, citation drawer, status badge
    styles.css                 Widget, drawer, citation button styles
USERS.md             Target user, workflow, and use cases
AUDIT.md             Security, performance, and HIPAA audit
ARCHITECTURE.md      AI integration plan
COST_ANALYSIS.md     AI cost analysis — actual dev spend + projections at 100/1K/10K/100K users
evals/               Eval harness — 15 brief cases + 3 adversarial multi-turn cases
```

---

## Development docs

- [`CLAUDE.md`](CLAUDE.md) — full development guide: Docker setup, test commands, PHP coding standards
- [`USERS.md`](USERS.md) — use cases with justification for agent vs. dashboard
- [`AUDIT.md`](AUDIT.md) — audit findings that inform architecture decisions
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — AI integration plan
- [`COST_ANALYSIS.md`](COST_ANALYSIS.md) — AI cost analysis with multi-turn session costs and scale projections
- [`evals/eval_results.md`](evals/eval_results.md) — latest eval run results (15 brief + 3 adversarial cases)
