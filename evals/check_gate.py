"""PR-blocking eval gate + consolidated report writer.

Runs all three eval suites (W1 brief + multi-turn followup, document
extraction against real PDF/PNG fixtures, W2 multi-agent graph) and
compares aggregate pass rates against a committed baseline. Exits 1 if
any rubric drops by more than the configured tolerance.

When ``--report PATH`` is given, also writes a single consolidated
markdown report at PATH covering every suite that actually ran. That is
the canonical "all evals in one place" file (default:
``evals/eval_results.md``).

Run:
    cd evals && ../copilot-agent/.venv/bin/python check_gate.py
    add --update-baseline to overwrite baseline.json with current run
    add --skip-brief / --skip-extraction / --skip-graph to skip a suite
    add --no-report to skip writing the consolidated markdown

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
import tempfile
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BASELINE_PATH = ROOT / "baseline.json"
BRIEF_RESULTS = ROOT / "brief_gate_results.json"
EXTRACTION_RESULTS = ROOT / "extraction_gate_results.json"
GRAPH_RESULTS = ROOT / "graph_gate_results.json"
DEFAULT_REPORT = ROOT / "eval_results.md"

TOLERANCE_POINTS = 5.0


def _run(cmd: list[str], label: str) -> None:
    print(f"\n→ {label}")
    print(f"  $ {' '.join(cmd)}")
    proc = subprocess.run(cmd, cwd=str(ROOT))
    if proc.returncode != 0:
        print(f"  FAIL: {label} exited {proc.returncode}", file=sys.stderr)
        sys.exit(2)


def _load_results() -> dict[str, dict]:
    """Combine brief + followup + extraction + graph summaries into one
    rubric → stats map.

    Rubric keys are namespaced by suite so brief evals' `citation_markers_present`
    cannot collide with graph evals' `citation_present`, and extraction's
    `schema_valid` cannot collide with graph's.

    Reads whatever JSON files exist on disk — whichever suites were run by
    `main()` will have written fresh files and any --skip-ed suites will be
    absent (because `main` deletes their JSONs before running).
    """
    combined: dict[str, dict] = {}

    if BRIEF_RESULTS.exists():
        brief = json.loads(BRIEF_RESULTS.read_text())
        for k, v in (brief.get("brief_summary") or {}).items():
            combined[f"brief.{k}"] = v
        for k, v in (brief.get("followup_summary") or {}).items():
            combined[f"followup.{k}"] = v

    if EXTRACTION_RESULTS.exists():
        extraction = json.loads(EXTRACTION_RESULTS.read_text())
        for k, v in (extraction.get("summary") or {}).items():
            combined[f"extraction.{k}"] = v

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


def _write_combined_report(
    target: Path,
    sections: list[tuple[str, Path]],
    summary: dict[str, dict],
) -> None:
    """Concatenate per-suite markdown reports into one canonical file.

    Each per-suite report is produced by passing ``--report`` to its runner.
    We just glue them together with a single combined header + summary
    table at the top so the reader has one document to look at instead of
    three.
    """
    # Sum cases across suites (one count per suite, not per rubric — every rubric in
    # a suite scores the same cases, so we dedupe by taking the max `total` per
    # suite namespace)
    suite_totals: dict[str, int] = {}
    for key, val in summary.items():
        suite = key.split(".", 1)[0]
        suite_totals[suite] = max(suite_totals.get(suite, 0), val["total"])
    total_cases = sum(suite_totals.values())

    lines: list[str] = []
    lines.append("# Clinical Co-Pilot — Combined Eval Results")
    lines.append("")
    lines.append(f"_{datetime.now():%Y-%m-%d %H:%M} · "
                 f"{total_cases} cases across {len(suite_totals)} suites · "
                 f"{len(summary)} rubrics_")
    lines.append("")
    lines.append("Single source of truth for every Clinical Co-Pilot eval suite. "
                 "Three rubric-namespaced suites share this file: W1 brief + multi-turn "
                 "follow-up (`brief.*` / `followup.*`), document extraction against real "
                 "PDF/PNG fixtures (`extraction.*`), and the W2 multi-agent graph "
                 "(`graph.*`).")
    lines.append("")
    lines.append(f"For latency / cost, see `../COST_LATENCY.md`. The PR-blocking gate "
                 f"(`check_gate.py`) operates on the same JSON these sections were "
                 f"rendered from; failing it requires a >{TOLERANCE_POINTS:.0f}pp drop "
                 f"vs `baseline.json`.")
    lines.append("")

    # Combined rubric summary so the reader sees the whole picture at a glance
    lines.append("## All rubrics — at a glance")
    lines.append("")
    lines.append("| Rubric | Pass | Total | % |")
    lines.append("|--------|------|-------|---|")
    for key in sorted(summary):
        s = summary[key]
        icon = "✅" if s["pct"] >= 95 else ("⚠️" if s["pct"] >= 80 else "❌")
        lines.append(f"| {icon} `{key}` | {s['passed']} | {s['total']} | {s['pct']:.0f}% |")
    lines.append("")

    # Per-suite detail — read each runner's --report output verbatim. Strip the
    # runner's H1 since we already have one above; everything else stays.
    for title, src in sections:
        if not src.exists():
            continue
        body = src.read_text()
        body_lines = body.splitlines()
        # Drop the runner's H1 (first line starting with `# `) and any
        # immediately-following italic-date stamp — our combined header replaces them.
        i = 0
        while i < len(body_lines) and body_lines[i].startswith("# "):
            i += 1
            # also skip the *date* italic line if present
            if i < len(body_lines) and body_lines[i].startswith("*") and body_lines[i].endswith("*"):
                i += 1
            # and any immediately-following blank line
            if i < len(body_lines) and not body_lines[i].strip():
                i += 1
            break
        lines.append(f"---\n\n# {title}\n")
        lines.extend(body_lines[i:])
        lines.append("")

    target.write_text("\n".join(lines))
    print(f"\n→ Combined report written: {target}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--update-baseline", action="store_true",
                        help="After running, write current results to baseline.json")
    parser.add_argument("--skip-brief", action="store_true",
                        help="Skip the W1 brief + followup suite (run.py)")
    parser.add_argument("--skip-extraction", action="store_true",
                        help="Skip the extraction suite (run_extraction.py)")
    parser.add_argument("--skip-graph", action="store_true",
                        help="Skip the W2 multi-agent graph suite (run_graph.py)")
    parser.add_argument("--report", metavar="PATH", default=str(DEFAULT_REPORT),
                        help=f"Where to write the combined markdown report "
                             f"(default: {DEFAULT_REPORT.name}). Pass --no-report to skip.")
    parser.add_argument("--no-report", action="store_true",
                        help="Don't write a combined markdown report.")
    args = parser.parse_args()

    # Don't .resolve() — the venv's `bin/python` is a symlink to the
    # system interpreter; resolving would bypass the venv's site-packages.
    venv_python = str(ROOT.parent / "copilot-agent" / ".venv" / "bin" / "python")

    # Each runner gets its own temp report path so we can concatenate them
    # afterwards. Temp files are cleaned up at the end.
    tmp_dir = Path(tempfile.mkdtemp(prefix="eval_reports_"))
    brief_md = tmp_dir / "brief.md"
    extraction_md = tmp_dir / "extraction.md"
    graph_md = tmp_dir / "graph.md"

    # Delete the JSON for any suite we're about to re-run so a stale file from
    # a previous run can't leak into the gate decision if this run crashes.
    # Files belonging to skipped suites are left in place so callers like the
    # test_gate.py harness can fixture them up explicitly.
    if not args.skip_brief and BRIEF_RESULTS.exists():
        BRIEF_RESULTS.unlink()
    if not args.skip_extraction and EXTRACTION_RESULTS.exists():
        EXTRACTION_RESULTS.unlink()
    if not args.skip_graph and GRAPH_RESULTS.exists():
        GRAPH_RESULTS.unlink()

    if not args.skip_brief:
        _run(
            [venv_python, "run.py", "--offline", "--followup",
             "--json", str(BRIEF_RESULTS),
             "--report", str(brief_md)],
            "Running W1 brief + followup suite",
        )

    if not args.skip_extraction:
        _run(
            [venv_python, "run_extraction.py",
             "--json", str(EXTRACTION_RESULTS),
             "--report", str(extraction_md)],
            "Running extraction suite (real PDF/PNG fixtures)",
        )

    if not args.skip_graph:
        _run(
            [venv_python, "run_graph.py",
             "--json", str(GRAPH_RESULTS),
             "--report", str(graph_md)],
            "Running W2 multi-agent graph suite",
        )

    skipped_prefixes: list[str] = []
    if args.skip_brief:
        skipped_prefixes.extend(["brief.", "followup."])
    if args.skip_extraction:
        skipped_prefixes.append("extraction.")
    if args.skip_graph:
        skipped_prefixes.append("graph.")

    current = _load_results()
    if not current:
        print("No eval results found — did the runs produce JSON?", file=sys.stderr)
        return 2

    if args.update_baseline:
        BASELINE_PATH.write_text(json.dumps(current, indent=2, sort_keys=True))
        print(f"\nBaseline updated: {BASELINE_PATH}")
        # still write the combined report below if the caller wants one
    else:
        if not BASELINE_PATH.exists():
            print(f"\nNo baseline at {BASELINE_PATH} — run with --update-baseline first")
        else:
            baseline = json.loads(BASELINE_PATH.read_text())
            passed = _print_table(current, baseline, tuple(skipped_prefixes))

            if not passed:
                print(f"\nGATE FAILED — at least one rubric regressed > {TOLERANCE_POINTS}pp")
                # write the report anyway so the failure is documented
                if not args.no_report:
                    _write_combined_report(
                        Path(args.report),
                        [
                            ("W1 brief + multi-turn follow-up", brief_md),
                            ("Document extraction (real PDF/PNG fixtures)", extraction_md),
                            ("W2 multi-agent graph", graph_md),
                        ],
                        current,
                    )
                return 1

            print("GATE PASSED")

    if not args.no_report:
        _write_combined_report(
            Path(args.report),
            [
                ("W1 brief + multi-turn follow-up", brief_md),
                ("Document extraction (real PDF/PNG fixtures)", extraction_md),
                ("W2 multi-agent graph", graph_md),
            ],
            current,
        )

    return 0


if __name__ == "__main__":
    sys.exit(main())
