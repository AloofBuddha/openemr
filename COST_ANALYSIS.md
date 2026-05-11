# AI Cost Analysis — Clinical Co-Pilot

**Last updated:** 2026-05-09 (W2 final-submission revision)

For the per-step measured numbers (p50/p95 latency, per-node tokens, bottleneck analysis) that the W2 PRD requires, see the dedicated **[`COST_LATENCY.md`](./COST_LATENCY.md)** — it is the canonical measurement source. This doc owns the narrative: total spend, scale projections, and the levers that move them.

---

## Actual Dev Spend (W1 + W2 combined)

| Item | Estimate |
|------|----------|
| W1 module development + testing (Sonnet, ~150 briefs) | ~$0.75 |
| W1 eval harness runs (Haiku, ~10 × 12 cases) | ~$0.11 |
| W1 demo seed + QA runs | ~$0.25 |
| W2 multi-agent graph eval runs (Haiku supervisor + Sonnet answer × 20 cases × ~12 runs) | ~$4.10 |
| W2 extraction iteration (pdfplumber + Haiku Vision over 8 demo docs × ~30 reruns) | ~$1.80 |
| W2 RAG / corpus building + Cohere rerank smoke runs | ~$0.20 |
| Demo recording + final-submission rehearsals | ~$0.60 |
| **Total API spend (both sprints)** | **~$7.80** |

Below the cost of one team lunch. The deployment-scale section is where the real numbers show up.

---

## Token Profile (measured)

### W1 brief (`/api/copilot/chat` — Haiku 4.5)

Measured from the UC-1 eval harness (12 cases, `claude-haiku-4-5-20251001`):

| Metric | Value |
|--------|-------|
| Avg input tokens / brief | 442 |
| Avg output tokens / brief | 144 |
| Avg total tokens / brief | 586 |

Production runs Haiku 4.5 for the brief — Sonnet was too verbose and too slow for the 90-second pre-encounter window.

### W2 multi-agent graph (`/api/copilot/agent-query`)

Measured per `COST_LATENCY.md`:

| Component | Model | Tokens (avg) | Cost / call |
|---|---|---|---|
| Supervisor | Haiku 4.5 | ~600 in / ~300 out | ~$0.0021 |
| Evidence retriever (when invoked) | BM25 + ChromaDB + Cohere rerank | — | ~$0.0010 |
| Answer assembler | Sonnet 4.6 | ~1,500 in / ~600 out | ~$0.0135 |
| **Total per query** | | | **~$0.017** |

The supervisor is called 1.65× per query on average (re-invoked after each worker), so ~$0.0035 cumulative supervisor cost is folded into the per-query total.

### W2 extraction (`/api/copilot/upload` → `/ingest`)

| Doc class | Path | Cost / doc |
|---|---|---|
| Digital lab PDF | pdfplumber → no LLM | $0 |
| Image / scanned PDF (lab) | Haiku Vision | ~$0.008 |
| Intake form (image) | Haiku Vision | ~$0.012 |

Extractions are cached on disk by `openemr_doc_id`; re-uploading the same file (SHA3 dedup at OpenEMR layer) returns the cached extraction at $0. Most patient sessions extract zero or one new document.

---

## Session Cost Profile (multi-turn)

> Section covers the **W1 brief flow** (Haiku, no docs, no RAG). For the per-query cost of the W2 multi-agent graph (which is what runs when a physician asks anything beyond the auto-generated brief), see the table above and `COST_LATENCY.md`. A full physician session is typically 1 brief + 0–2 graph queries.

The co-pilot now supports multi-turn conversations. Each follow-up re-sends the patient context plus accumulated conversation history, so cost grows with conversation depth.

**How context accumulates per turn (Sonnet):**

| Turn | What's sent | Approx input tokens | Output tokens | Turn cost |
|------|------------|---------------------|--------------|-----------|
| Brief (T1) | System + patient context + "Brief me" | ~580 | ~225 | ~$0.0051 |
| Follow-up 1 (T2) | System + patient context + T1 history + question | ~800 | ~150 | ~$0.0047 |
| Follow-up 2 (T3) | System + patient context + T1+T2 history + question | ~975 | ~150 | ~$0.0052 |

**Typical session cost (brief + 2 follow-ups): ~$0.015**

This is the realistic per-patient cost when a physician asks about a lab trend or medication after reading the brief. A brief-only session remains ~$0.005.

**Caching reduces this significantly:**

- **Server-side brief cache** (MariaDB, appointment-scoped, 30-min TTL): a cached brief costs $0.00 and still returns sources + suggestions.
- **Client-side conversation cache** (localStorage, same-day): if the physician returns to the same patient mid-shift, the full conversation — including follow-ups — is replayed from localStorage at $0.00.

Effective per-patient cost at a typical 70% cache hit rate on the brief, with ~40% of sessions including 1-2 follow-ups:

> **~$0.004 per patient encounter** (blended across cache hits and follow-up depth)

---

## Scale Projections (W1 + W2 combined)

Assumptions per physician per day:
- 20 unique patients seen
- 1 W1 brief per patient (70% cache hit rate → 6 live Haiku calls/day for briefs)
- 0.55 W1 follow-up Haiku calls per patient on average (40% of sessions get 1 follow-up, 15% get 2)
- **0.5 W2 multi-agent graph queries per patient** (~10/day) — the physician opens the agent panel, asks "what changed since last visit + does ADA recommend Z?" on roughly half of patients
- **0.15 W2 ingests per patient** (~3 docs/day) — typical front-desk-uploaded lab PDFs and intake forms; cached after first extraction so repeat queries hit free
- Cohere rerank charged on the ~10 graph queries/day

Per-physician daily cost: 6 × $0.0035 (briefs) + 11 × $0.0035 (followups, blended) + 10 × $0.017 (graph) + 3 × $0.010 (ingests) + 10 × $0.001 (rerank) ≈ **$0.30/day**.

| Scale | Physicians | API cost/day | API cost/month | Notes |
|-------|-----------|-------------|---------------|-------|
| 100 users | 5 | $1.50 | **~$45** | Current demo infra handles this |
| 1K users | 50 | $15 | **~$450** | DB read replica + Redis brief cache |
| 10K users | 500 | $150 | **~$4,500** | Prompt caching on the W2 system prompt; Haiku for unambiguous-intent answers |
| 100K users | 5,000 | $1,500 | **~$45,000** | Self-hosted reranker, fine-tuned answer model, BAA + dedicated capacity |

The W2 graph query is now the cost driver — ~5× per-call cost vs. the W1 brief, and physicians use it almost as often. Most production levers should be aimed at the answer assembler (Section: Levers).

---

## Architectural Changes by Scale

### 100 users (~$45/month)
Current architecture holds. Single Docker host, synchronous PHP, MariaDB, Python sidecar on systemd. No changes needed.

### 1K users (~$450/month)
- **DB read replica** — the 8-table encounter join becomes a bottleneck under concurrent load. Route all agent queries to a read replica.
- **Redis brief cache** — move from MariaDB row caching to Redis with a 5-minute TTL for lower-latency cache lookups and easier invalidation.
- **Conversation history cap** — limit stored turns to last 6 exchanges to prevent input tokens from growing unbounded in long sessions.

### 10K users (~$4,500/month)
- **Model tiering** — introduce Haiku for follow-up turns (lower stakes than the initial brief): ~10× cheaper per call. Brief uses Sonnet for quality; follow-ups use Haiku. Estimated blended savings: 35–45%.
- **Async PHP orchestrator** — PHP's synchronous request lifecycle limits concurrent tool calls. Extract to a dedicated async service (Node/Go) so tool calls run in parallel.
- **Semantic cache** — similar follow-up questions within a session (e.g., "what are the meds?" after a brief) return cached results without a second LLM call.
- **Anthropic prompt caching** — the system prompt is static per deployment; enabling prompt caching reduces input cost ~90% on the system prompt portion (~120 tokens cached vs. fresh per call).

### 100K users (~$45,000/month)
- All above, plus:
- **Fine-tuned Haiku** — a fine-tuned Haiku on clinic-specific brief format could replace Sonnet for brief generation at 80% quality, 80% less cost.
- **BAA and dedicated tenancy** — Anthropic BAA required; dedicated API capacity for SLA guarantees.
- **Horizontal DB sharding** — patient data partitioned by clinic/tenant; agent queries routed to tenant-specific replicas.
- **Conversation TTL enforcement** — at scale, localStorage caching is insufficient; a server-side conversation store (Redis) with per-session TTL prevents re-fetching context on every tab load.
- At this scale, infrastructure cost (compute, DB) likely exceeds LLM cost.

---

## Key Levers

| Lever | Impact | When to pull |
|-------|--------|-------------|
| Appointment-scoped brief cache | −70% LLM calls on briefs | Day one (already built) |
| Same-day conversation cache (localStorage) | −100% cost on return visits | Day one (already built) |
| Disk-backed extraction cache (`copilot-agent/cache.py`) | −100% repeat-extract cost | Day one (already built) |
| Conversation history cap (6 turns) | Prevents unbounded token growth | 1K+ users |
| Prompt caching on the W2 answer-assembler system prompt (~800 tokens, identical every call) | −50% Sonnet input cost on the W2 graph | 1K+ users |
| Skip supervisor on unambiguous-intent queries (route directly to retriever + answer) | −1 Haiku call/query (~$0.002, ~1 s latency) | 1K+ users |
| Stream the Sonnet answer instead of awaiting full message | −3 s perceived latency | 1K+ users |
| Haiku 4.5 for the W2 answer when no docs were uploaded | −80% answer cost on RAG-only queries | 10K+ users |
| Self-hosted reranker (replaces Cohere) | −100% rerank API cost; eliminates external PHI surface | 10K+ users |
| Fine-tuned smaller model for the answer | −80% cost at quality parity | 100K+ users |

Token cost does not scale linearly with users — caching and model tiering are the primary levers, with prompt caching now the highest-leverage unpicked lever for W2. See `COST_LATENCY.md` for latency-side levers (Sonnet streaming, supervisor short-circuit) measured against the live deployment.
