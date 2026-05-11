"""Tests for the eval CI gate (check_gate.py).

The PRD's hard gate test: graders will plant a regression and confirm the
gate blocks it. This file automates that exact check so we know it works
before they try.

Runs check_gate.py in --skip-brief --skip-graph mode (operates on whatever
results JSON is on disk). We swap in a synthetic regression, run the gate,
restore, and assert the exit code.
"""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent
BASELINE = ROOT / "baseline.json"
GRAPH_RESULTS = ROOT / "graph_gate_results.json"
BRIEF_RESULTS = ROOT / "brief_gate_results.json"


def _run_gate(extra_args: list[str] | None = None) -> tuple[int, str]:
    """Run check_gate.py and return (exit_code, stdout)."""
    args = [sys.executable, str(ROOT / "check_gate.py"),
            "--skip-brief", "--skip-extraction", "--skip-graph",
            "--no-report"]
    if extra_args:
        args.extend(extra_args)
    proc = subprocess.run(args, cwd=str(ROOT), capture_output=True, text=True)
    return proc.returncode, proc.stdout + proc.stderr


@pytest.fixture
def graph_results_backup():
    """Snapshot graph_gate_results.json so each test can mutate freely."""
    if not GRAPH_RESULTS.exists():
        pytest.skip("graph_gate_results.json missing — run check_gate.py first")
    backup = GRAPH_RESULTS.read_bytes()
    yield
    GRAPH_RESULTS.write_bytes(backup)


def test_gate_passes_against_baseline(graph_results_backup) -> None:
    """No regression planted: gate exits 0."""
    code, _ = _run_gate()
    assert code == 0, "gate should pass against committed baseline"


def test_gate_fires_on_schema_valid_regression(graph_results_backup) -> None:
    """Drop schema_valid 100% → 50%. Gate must exit 1 (regression detected)."""
    data = json.loads(GRAPH_RESULTS.read_text())
    data["summary"]["schema_valid"] = {"passed": 10, "pct": 50.0, "total": 20}
    GRAPH_RESULTS.write_text(json.dumps(data))

    code, output = _run_gate()
    assert code == 1, f"gate should fire on regression (got {code})"
    assert "graph.schema_valid" in output
    assert "FAIL" in output
    assert "REGRESSIONS" in output


def test_gate_fires_on_citation_regression(graph_results_backup) -> None:
    """Citation rubric is critical — verify it's gated too."""
    data = json.loads(GRAPH_RESULTS.read_text())
    data["summary"]["citation_present"] = {"passed": 14, "pct": 70.0, "total": 20}
    GRAPH_RESULTS.write_text(json.dumps(data))

    code, output = _run_gate()
    assert code == 1
    assert "graph.citation_present" in output


def test_gate_fires_on_phi_regression(graph_results_backup) -> None:
    """no_phi_in_logs is the strictest rubric. Any drop must fail."""
    data = json.loads(GRAPH_RESULTS.read_text())
    data["summary"]["no_phi_in_logs"] = {"passed": 18, "pct": 90.0, "total": 20}
    GRAPH_RESULTS.write_text(json.dumps(data))

    code, output = _run_gate()
    # 100 → 90 = -10pp, exceeds 5pp tolerance
    assert code == 1
    assert "no_phi_in_logs" in output


def test_gate_tolerates_within_5pp_dip(graph_results_backup) -> None:
    """Single-case flake (5pp on a 20-case suite) shouldn't fire the gate."""
    data = json.loads(GRAPH_RESULTS.read_text())
    # 100% → 95% is exactly the 5pp tolerance — should still pass per
    # check_gate's `delta < -TOLERANCE_POINTS` strict-less check.
    data["summary"]["safe_refusal"] = {"passed": 19, "pct": 95.0, "total": 20}
    GRAPH_RESULTS.write_text(json.dumps(data))

    code, _ = _run_gate()
    assert code == 0, "5pp dip is within tolerance — gate should pass"


def test_baseline_covers_required_rubrics() -> None:
    """All five PRD rubrics must be in the committed baseline."""
    baseline = json.loads(BASELINE.read_text())
    required = {
        "graph.schema_valid",
        "graph.citation_present",
        "graph.factually_consistent",
        "graph.safe_refusal",
        "graph.no_phi_in_logs",
    }
    missing = required - set(baseline.keys())
    assert not missing, f"baseline missing required rubrics: {missing}"


def test_total_case_count_meets_50_minimum() -> None:
    """PRD requires a 50-case golden set. Currently brief + followup + graph."""
    baseline = json.loads(BASELINE.read_text())
    suite_totals: dict[str, int] = {}
    for key, val in baseline.items():
        suite = key.split(".", 1)[0]
        suite_totals[suite] = max(suite_totals.get(suite, 0), val["total"])
    total = sum(suite_totals.values())
    assert total >= 50, f"baseline has only {total} cases ({suite_totals})"
