# Clinical Co-Pilot

An AI agent embedded in OpenEMR that gives physicians a 90-second patient briefing between exam rooms. Built as part of the Gauntlet AI Week 1 AgentForge sprint.

**Live demo:** http://198.211.103.246.nip.io

---

## What it does

Dr. Sarah Chen sees 18–22 patients a day. Between rooms she has 90 seconds to reconstruct who the next patient is, why they're here, and what changed since the last visit — across 4–6 screens in the EHR. This agent collapses that into a single conversational query.

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
interface/modules/custom_modules/oe-module-clinical-copilot/   (agent module)
USERS.md             Target user, workflow, and use cases
AUDIT.md             Security, performance, and HIPAA audit
ARCHITECTURE.md      AI integration plan
```

---

## Development docs

- [`CLAUDE.md`](CLAUDE.md) — full development guide: Docker setup, test commands, PHP coding standards
- [`USERS.md`](USERS.md) — use cases with justification for agent vs. dashboard
- [`AUDIT.md`](AUDIT.md) — audit findings that inform architecture decisions
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — AI integration plan
