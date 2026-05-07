# Cost & Latency Report — Clinical Co-Pilot W2

Measurements taken from `evals/run_graph.py` over 20 grounded multi-agent
graph cases, run sequentially against the deployed model stack
(Anthropic Sonnet 4.6 + Haiku 4.5, Cohere `rerank-english-v3.0`, local
ChromaDB MiniLM-L6 embeddings + BM25). Cohere rerank was disabled for
this run (no API key in dev env), so the retrieval timings are a lower
bound for the score-based fallback path. Rerank typically adds ~150–250 ms.

## End-to-end query latency (`POST /query`)

| Percentile | Latency |
|------------|---------|
| min        | 5.1 s   |
| p50        | 9.4 s   |
| p95        | 12.8 s  |
| max        | 12.8 s  |
| mean       | 9.3 s   |

## Per-step latency

Each query traverses supervisor → optional workers → answer assembler.
Aggregated across all 20 cases × all invocations of each node:

| Node                  | n   | p50      | p95      | mean     |
|-----------------------|-----|----------|----------|----------|
| supervisor (Haiku)    | 33  | 1.18 s   | 1.79 s   | 1.21 s   |
| evidence\_retriever   | 13  | 0.20 s   | 0.36 s   | 0.21 s   |
| answer\_assembler (Sonnet) | 20 | 6.75 s | 9.93 s   | 7.15 s   |

**Bottleneck:** `answer_assembler` is ~75% of total latency. The
supervisor is called 1–3 times per query (1.65 calls/query average) so
its cumulative cost is ~2.0 s. Retrieval is essentially free (BM25 + a
local 45-chunk ChromaDB collection).

## Per-query cost (developer measurements)

Token counts are estimates from the live prompts; actual usage logged in
LangSmith when `LANGCHAIN_API_KEY` is set.

### W2 multi-agent graph (`/query`)

| Component                     | Tokens (avg) | Unit price ($/M) | Cost      |
|-------------------------------|--------------|------------------|-----------|
| Supervisor — Haiku 4.5 input  | ~600         | 1.00             | $0.0006   |
| Supervisor — Haiku 4.5 output | ~300         | 5.00             | $0.0015   |
| Answer — Sonnet 4.6 input     | ~1 500       | 3.00             | $0.0045   |
| Answer — Sonnet 4.6 output    | ~600         | 15.00            | $0.0090   |
| Cohere rerank (when enabled)  | ~20 docs     | flat rate        | ~$0.0010  |
| **Total per query**           |              |                  | **~$0.017** |

### W1 pre-encounter brief (`/chat.php`)

| Component                | Tokens (avg) | Unit price ($/M) | Cost      |
|--------------------------|--------------|------------------|-----------|
| Brief — Haiku 4.5 input  | ~1 500       | 1.00             | $0.0015   |
| Brief — Haiku 4.5 output | ~400         | 5.00             | $0.0020   |
| **Total per brief**      |              |                  | **~$0.0035** |

### Document ingest (`/ingest`)

| Doc type   | Path                   | Tokens (in/out) | Cost / doc |
|------------|------------------------|-----------------|-----------|
| Lab PDF    | pdfplumber (no LLM)    | 0               | $0        |
| Lab PDF    | Haiku Vision fallback  | ~2 000 / ~1 200 | ~$0.008   |
| Intake form| Haiku Vision           | ~3 000 / ~1 800 | ~$0.012   |

Extractions are cached on disk by `openemr_doc_id`, so the model is
called once per document — repeat queries hit the cache for free.

## Projected production cost

For a clinic running 100 patient briefs + 200 follow-up queries per day:

| Workload                          | Per call  | Per day | Per month |
|-----------------------------------|-----------|---------|-----------|
| 100 W1 briefs                     | $0.0035   | $0.35   | $10.50    |
| 200 W2 graph queries              | $0.017    | $3.40   | $102.00   |
| 30 ingests (mixed doc types)      | ~$0.010   | $0.30   | $9.00     |
| Cohere rerank (200 queries)       | $0.001    | $0.20   | $6.00     |
| **Total**                         |           | **~$4.25** | **~$127** |

## Levers we have not yet pulled

1. **Prompt caching on the system prompt for the answer assembler** —
   the 800-token "CITATION RULES + MEDICAL ADVICE RULE" preamble is
   identical across every query. Anthropic's prompt cache (5-minute
   TTL, 90% discount on cached input tokens) would drop the Sonnet
   input cost by ~50%.
2. **Stream the Sonnet response** — currently the sidecar awaits the
   full Sonnet message before chunking. Streaming would shave ~3 s of
   perceived latency at the start of the answer.
3. **Skip the supervisor when intent is unambiguous** — pure RAG queries
   (no docs uploaded, query mentions "guideline"/"target"/"recommend")
   could route directly to evidence\_retriever + answer\_assembler,
   removing one Haiku call (~1 s, ~$0.002).
4. **Increase the BM25/dense candidate pool, decrease the rerank top-k**
   — currently 20+20 candidates → top 5 reranked. Could test 30+30 → top
   3 to widen recall without increasing prompt size.
