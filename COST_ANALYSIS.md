# AI Cost Analysis — Clinical Co-Pilot

**Last updated:** 2026-04-29

---

## Actual Dev Spend

| Item | Estimate |
|------|----------|
| Module development + testing (Sonnet, ~150 briefs) | ~$0.75 |
| Eval harness runs (Haiku, ~10 × 12 cases) | ~$0.11 |
| Demo seed + QA runs | ~$0.25 |
| **Total API spend (sprint)** | **< $2** |

The sprint cost is negligible — below two dollars of LLM usage. The real costs appear at deployment scale.

---

## Token Profile (measured)

Measured from the UC-1 eval harness (12 cases, `claude-haiku-4-5-20251001`):

| Metric | Value |
|--------|-------|
| Avg input tokens / brief | 442 |
| Avg output tokens / brief | 144 |
| Avg total tokens / brief | 586 |

Production uses `claude-sonnet-4-6`. Input token counts are identical (same prompt structure); output runs slightly higher (~225 tokens) given Sonnet's more verbose style.

---

## Session Cost Profile (multi-turn)

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

## Scale Projections

Assumptions:
- 20 unique patients seen per physician per day
- Avg 1.4 LLM-eligible requests per patient (brief + ~0.4 follow-ups on average, accounting for sessions with no follow-up)
- 70% brief cache hit rate → ~6 live LLM calls/physician/day for briefs
- 40% of sessions include 1 follow-up, 15% include 2 → avg 0.55 extra calls/patient
- Combined: ~8.5 LLM calls/physician/day
- Blended avg cost per call: ~$0.005 (mix of brief and follow-up token profiles)

| Scale | Physicians | LLM calls/day | API cost/day | API cost/month | Notes |
|-------|-----------|--------------|-------------|---------------|-------|
| 100 users | 5 | 43 | $0.21 | **~$6** | Current demo infra handles this |
| 1K users | 50 | 425 | $2.13 | **~$64** | Single server, read replica helpful |
| 10K users | 500 | 4,250 | $21.25 | **~$638** | DB read replica required; consider Haiku for follow-ups |
| 100K users | 5,000 | 42,500 | $212.50 | **~$6,375** | Model tiering, semantic cache, dedicated async orchestrator |

---

## Architectural Changes by Scale

### 100 users (~$6/month)
Current architecture holds. Single Docker host, synchronous PHP, MariaDB. No changes needed.

### 1K users (~$64/month)
- **DB read replica** — the 8-table encounter join becomes a bottleneck under concurrent load. Route all agent queries to a read replica.
- **Redis brief cache** — move from MariaDB row caching to Redis with a 5-minute TTL for lower-latency cache lookups and easier invalidation.
- **Conversation history cap** — limit stored turns to last 6 exchanges to prevent input tokens from growing unbounded in long sessions.

### 10K users (~$638/month)
- **Model tiering** — introduce Haiku for follow-up turns (lower stakes than the initial brief): ~10× cheaper per call. Brief uses Sonnet for quality; follow-ups use Haiku. Estimated blended savings: 35–45%.
- **Async PHP orchestrator** — PHP's synchronous request lifecycle limits concurrent tool calls. Extract to a dedicated async service (Node/Go) so tool calls run in parallel.
- **Semantic cache** — similar follow-up questions within a session (e.g., "what are the meds?" after a brief) return cached results without a second LLM call.
- **Anthropic prompt caching** — the system prompt is static per deployment; enabling prompt caching reduces input cost ~90% on the system prompt portion (~120 tokens cached vs. fresh per call).

### 100K users (~$6,375/month)
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
| Conversation history cap (6 turns) | Prevents unbounded token growth | 1K+ users |
| Prompt caching (Anthropic) | −25% input cost | 1K+ users |
| Haiku for follow-up turns | −35–45% total cost | 10K+ users |
| Semantic deduplication | −15% LLM calls | 10K+ users |
| Fine-tuned smaller model | −80% cost at quality parity | 100K+ users |

Token cost does not scale linearly with users — caching and model tiering are the primary levers. The conversation cache is especially high-leverage: a physician who glances at a patient's chart twice during a shift triggers one LLM session, not two.
