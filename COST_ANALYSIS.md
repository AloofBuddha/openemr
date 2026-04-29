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

The sprint cost is negligible — below one dollar of LLM usage. The real costs appear at deployment scale.

---

## Token Profile (measured)

Measured from the UC-1 eval harness (12 cases, `claude-haiku-4-5-20251001`):

| Metric | Value |
|--------|-------|
| Avg input tokens / brief | 442 |
| Avg output tokens / brief | 144 |
| Avg total tokens / brief | 586 |

Production uses `claude-sonnet-4-6`. Input token counts are identical (same prompt structure); output may run slightly higher (200–250) given Sonnet's more verbose style.

**Per-brief cost estimates:**

| Model | Input $/MTok | Output $/MTok | Cost/brief |
|-------|-------------|--------------|-----------|
| Sonnet 4.6 (production) | $3.00 | $15.00 | **~$0.0050** |
| Haiku 4.5 (bulk/eval) | $0.80 | $4.00 | **~$0.0009** |

Sonnet production brief cost = (500 × $3.00 + 225 × $15.00) / 1,000,000 ≈ **$0.005/brief**

Cache hit (no LLM call) = **$0.00/brief**. Current cache TTL is appointment-scoped — same physician + same appointment + no data change reuses the cached brief. At a typical clinic with 5–10 patients/hour per physician, cache hit rate is ~70% on repeat page loads.

**Effective cost per brief (with 70% cache):** ~$0.0015

---

## Scale Projections

Assumptions:
- 20 unique patients seen per physician per day
- 1.5 page loads per patient (repeat views partially cached) → ~30 LLM-eligible requests/physician/day
- 70% cache hit rate → ~9 LLM calls/physician/day
- $0.005/call (Sonnet)

| Scale | Physicians | LLM calls/day | API cost/day | API cost/month | Notes |
|-------|-----------|--------------|-------------|---------------|-------|
| 100 users | 5 | 45 | $0.23 | **~$7** | Current demo infra handles this |
| 1K users | 50 | 450 | $2.25 | **~$68** | Single server, read replica helpful |
| 10K users | 500 | 4,500 | $22.50 | **~$675** | DB read replica required; consider Haiku for UC-5 bulk scans |
| 100K users | 5,000 | 45,000 | $225 | **~$6,750** | Model tiering required; semantic cache layer; dedicated async orchestrator |

---

## Architectural Changes by Scale

### 100 users (~$7/month)
Current architecture holds. Single Docker host, synchronous PHP, MariaDB. No changes needed.

### 1K users (~$68/month)
- **DB read replica** — the 8-table encounter join becomes a bottleneck at concurrent load. Route all agent queries to a read replica.
- **Redis brief cache** — move from per-MySQL-row caching to Redis with a 5-minute TTL for faster cache lookups.
- No model changes needed at this tier.

### 10K users (~$675/month)
- **Model tiering** — introduce Haiku for UC-5 schedule-scan (bulk, lower stakes): ~10× cheaper per call, cuts total cost by 30–40% if UC-5 is adopted.
- **Async PHP orchestrator** — PHP's synchronous request lifecycle limits concurrent tool calls. Extract the orchestrator to a dedicated async service (Node/Go) so tool calls run truly in parallel instead of sequentially.
- **Semantic cache** — similar queries within a session (e.g., "brief me" then "what are the meds?") return cached results without a second LLM call.
- **Prompt caching** — the system prompt is static per deployment; enabling Anthropic prompt caching reduces input cost by ~90% for the system prompt portion (~100 tokens cached, ~400 fresh per call).

### 100K users (~$6,750/month)
- All above, plus:
- **Fine-tuned Haiku** — a fine-tuned Haiku on clinic-specific brief format could replace Sonnet for the brief generation step at 80% of quality, 80% less cost.
- **BAA and dedicated tenancy** — Anthropic BAA required; consider dedicated API capacity reservation for SLA guarantees.
- **Horizontal DB sharding** — patient data partitioned by clinic/tenant; agent queries routed to tenant-specific replicas.
- At this scale, infrastructure cost (compute, DB) likely exceeds LLM cost.

---

## Key Levers

| Lever | Impact | When to pull |
|-------|--------|-------------|
| Appointment-scoped cache | −70% LLM calls | Day one (already built) |
| Prompt caching (Anthropic) | −25% input cost | 1K+ users |
| Haiku for UC-5 bulk scan | −30% total cost | 10K+ users |
| Redis cache layer | Latency, not cost | 1K+ users |
| Semantic deduplication | −15% LLM calls | 10K+ users |
| Fine-tuned smaller model | −80% cost at quality parity | 100K+ users |

Token cost does not scale linearly with users — caching and model tiering are the primary architectural levers.
