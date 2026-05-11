#!/usr/bin/env bash
# Push all three eval datasets to LangSmith and run an experiment per suite.
# After this completes, the suites are visible at https://smith.langchain.com/
# under Datasets & Experiments in the LANGCHAIN_PROJECT (default: agent-forge).
#
# Each dataset's examples are upserted; pass --reset to delete and recreate
# (use this when DATASET / FOLLOWUP_DATASET / GraphCase / ExtractionCase has
# changed shape — otherwise existing examples are kept).
#
# Requires evals/.env with LANGCHAIN_API_KEY + ANTHROPIC_API_KEY set.
#
# Usage:
#   bash scripts/sync_langsmith.sh           # incremental (datasets created if missing)
#   bash scripts/sync_langsmith.sh --reset   # delete + recreate datasets
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENV_PYTHON="${REPO_ROOT}/copilot-agent/.venv/bin/python"

if [[ ! -x "${VENV_PYTHON}" ]]; then
    echo "ERROR: ${VENV_PYTHON} missing. Run: cd copilot-agent && python -m venv .venv && .venv/bin/pip install -r requirements.txt" >&2
    exit 1
fi

RESET_FLAG=""
if [[ "${1:-}" == "--reset" ]]; then
    RESET_FLAG="--reset-dataset"
    echo "==> Reset mode: existing datasets will be deleted before re-upload"
fi

cd "${REPO_ROOT}/evals"

echo "==> uc1-pre-encounter-brief (25 cases · brief + multi-turn followup)"
"${VENV_PYTHON}" run.py --followup ${RESET_FLAG}

echo
echo "==> w2-document-extraction (8 cases · pdfplumber + Haiku Vision)"
"${VENV_PYTHON}" run_extraction.py --langsmith ${RESET_FLAG}

echo
echo "==> w2-multi-agent-graph (20 cases · supervisor + workers + answer)"
"${VENV_PYTHON}" run_graph.py --langsmith ${RESET_FLAG}

echo
echo "Done. All three datasets are at https://smith.langchain.com/ under project '${LANGCHAIN_PROJECT:-agent-forge}'."
