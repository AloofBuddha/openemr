"""PR-blocking eval gate.

Runs both eval suites (W1 brief + multi-turn followup, W2 multi-agent graph)
and compares aggregate pass rates against a committed baseline. Exits 1
if any rubric drops by more than the configured tolerance.

Run:
    cd evals && ../copilot-agent/.venv/bin/python check_gate.py
    add --update-baseline to overwrite baseline.json with current run

The baseline lives next to this file at ``baseline.json``. Tolerance is
TOLERANCE_POINTS percentage points — a rubric is allowed to dip that far
before the gate fails. Set to 5 by default to absorb single-case flakiness
from a 20-case suite (each case is worth 5 percentage points).
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BASELINE_PATH = ROOT / "baseline.json"
BRIEF_RESULTS = ROOT / "brief_gate_results.json"
GRAPH_RESULTS = ROOT / "graph_gate_results.json"

TOLERANCE_POINTS = 5.0


def _run(cmd: list[str], label: str) -> None:
    print(f"\n→ {label}")
    print(f"  $ {' '.join(cmd)}")
    proc = subprocess.run(cmd, cwd=str(ROOT))
    if proc.returncode != 0:
        print(f"  FAIL: {label} exited {proc.returncode}", file=sys.stderr)
        sys.exit(2)


def _load_results() -> dict[str, dict]:
    """Combine brief + followup + graph summaries into one rubric → stats map.

    Rubric keys are namespaced by suite so brief evals' `citation_markers_present`
    cannot collide with graph evals' `citation_present`.
    """
    combined: dict[str, dict] = {}

    if BRIEF_RESULTS.exists():
        brief = json.loads(BRIEF_RESULTS.read_text())
        for k, v in (brief.get("brief_summary") or {}).items():
            combined[f"brief.{k}"] = v
        for k, v in (brief.get("followup_summary") or {}).items():
            combined[f"followup.{k}"] = v

    if GRAPH_RESULTS.exists():
        graph = json.loads(GRAPH_RESULTS.read_text())
        for k, v in (graph.get("summary") or {}).items():
            combined[f"graph.{k}"] = v

    return combined


def _print_table(
    current: dict[str, dict],
    baseline: dict[str, dict],
    skipped_prefixes: tuple[str, ...] = (),
) -> bool:
    """Print rubric-by-rubric comparison. Return True if all rubrics pass.

    `skipped_prefixes` lists the namespace prefixes that were intentionally
    not run (e.g. "brief." and "followup." when --skip-brief is set).
    Rubrics matching those prefixes are reported as SKIP, not FAIL.
    """
    all_keys = sorted(set(current) | set(baseline))
    failures: list[str] = []

    print(f"\n{'Rubric':<46} {'Baseline':>10} {'Current':>10}  Δ")
    print("-" * 80)

    for key in all_keys:
        cur = current.get(key)
        base = baseline.get(key)
        was_skipped = any(key.startswith(p) for p in skipped_prefixes)

        if cur is None:
            label = "skipped" if was_skipped else "missing"
            print(f"{key:<46} {base['pct']:>9.1f}%        --   ({label})")
            if not was_skipped:
                failures.append(f"{key}: missing in current run")
            continue

        cur_pct = cur["pct"]
        cur_count = f"{cur['passed']}/{cur['total']}"
        if base is None:
            print(f"{key:<46} {'--':>10} {cur_pct:>9.1f}%   (new)")
            continue

        base_pct = base["pct"]
        delta = cur_pct - base_pct
        delta_str = f"{delta:+.1f}pp"
        status = "OK"
        if delta < -TOLERANCE_POINTS:
            status = "FAIL"
            failures.append(
                f"{key}: {base_pct:.1f}% → {cur_pct:.1f}% ({delta:+.1f}pp, "
                f"tolerance {TOLERANCE_POINTS}pp)"
            )

        print(
            f"{key:<46} {base_pct:>9.1f}% {cur_pct:>9.1f}%  {delta_str:>7}  "
            f"({cur_count}) {status}"
        )

    print()
    if failures:
        print("REGRESSIONS:")
        for line in failures:
            print(f"  - {line}")
        return False
    return True


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--update-baseline", action="store_true",
                        help="After running, write current results to baseline.json")
    parser.add_argument("--skip-brief", action="store_true",
                        help="Skip the W1 brief + followup suite (run.py)")
    parser.add_argument("--skip-graph", action="store_true",
                        help="Skip the W2 multi-agent graph suite (run_graph.py)")
    args = parser.parse_args()

    # Don't .resolve() — the venv's `bin/python` is a symlink to the
    # system interpreter; resolving would bypass the venv's site-packages.
    venv_python = str(ROOT.parent / "copilot-agent" / ".venv" / "bin" / "python")

    if not args.skip_brief:
        _run(
            [venv_python, "run.py", "--offline", "--followup",
             "--json", str(BRIEF_RESULTS)],
            "Running W1 brief + followup suite",
        )

    if not args.skip_graph:
        _run(
            [venv_python, "run_graph.py", "--json", str(GRAPH_RESULTS)],
            "Running W2 multi-agent graph suite",
        )

    current = _load_results()
    if not current:
        print("No eval results found — did the runs produce JSON?", file=sys.stderr)
        return 2

    if args.update_baseline:
        BASELINE_PATH.write_text(json.dumps(current, indent=2, sort_keys=True))
        print(f"\nBaseline updated: {BASELINE_PATH}")
        return 0

    if not BASELINE_PATH.exists():
        print(f"\nNo baseline at {BASELINE_PATH} — run with --update-baseline first")
        return 0

    baseline = json.loads(BASELINE_PATH.read_text())
    skipped_prefixes: list[str] = []
    if args.skip_brief:
        skipped_prefixes.extend(["brief.", "followup."])
    if args.skip_graph:
        skipped_prefixes.append("graph.")
    passed = _print_table(current, baseline, tuple(skipped_prefixes))

    if not passed:
        print(f"\nGATE FAILED — at least one rubric regressed > {TOLERANCE_POINTS}pp")
        return 1

    print("GATE PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
