"""Extraction eval harness — exercises ``extract_document`` against real
PDF/PNG fixtures in ``example-documents/`` and verifies the result against
ground-truth expectations.

Distinct from ``run_graph.py`` which seeds a hand-crafted extraction into
the cache to test agent downstream behavior. THIS harness tests the
extractor itself: schema, field count, specific value presence, bbox
capture rate, and PHI-in-logs.

Run:
    cd evals && ../copilot-agent/.venv/bin/python run_extraction.py --report extraction_results.md
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import re
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

# Make the sidecar package importable.
_SIDECAR_DIR = Path(__file__).resolve().parent.parent / "copilot-agent"
if str(_SIDECAR_DIR) not in sys.path:
    sys.path.insert(0, str(_SIDECAR_DIR))

import anthropic  # noqa: E402
from dotenv import load_dotenv  # noqa: E402

from agent.extractor import extract_document  # noqa: E402
from schemas.intake import IntakeExtraction  # noqa: E402
from schemas.lab import LabExtraction  # noqa: E402
from schemas.other import OtherExtraction  # noqa: E402

load_dotenv()
logging.basicConfig(level=logging.WARNING)


# ---------------------------------------------------------------------------
# Case definition
# ---------------------------------------------------------------------------


@dataclass
class ExtractionCase:
    id: str
    description: str
    file: Path           # absolute path to the fixture
    mimetype: str
    doc_type: str        # 'lab_pdf' | 'intake_form'
    patient_id: int
    openemr_doc_id: int

    # Rubric inputs
    expected_field_count: int = 0     # min number of structured items expected
    expected_values: list[str] = field(default_factory=list)   # substrings that must appear in any extracted field
    bbox_min_ratio: float = 0.0       # min fraction of items that should have a bbox (0 = no requirement)
    phi_strings: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


_FIXTURES_DIR = Path(__file__).resolve().parent.parent / "example-documents"


def _build_cases() -> list[ExtractionCase]:
    cases: list[ExtractionCase] = []

    # ── Lab PDFs (text-extraction path with pdfplumber) ─────────────────────
    cases.append(ExtractionCase(
        id="lab_lipid_panel_typed_pdf",
        description="Typed lipid-panel PDF — multiple results, all should get bboxes via pdfplumber",
        file=_FIXTURES_DIR / "lab-results" / "p01-chen-lipid-panel.pdf",
        mimetype="application/pdf",
        doc_type="lab_pdf",
        patient_id=20,
        openemr_doc_id=900_001,
        expected_field_count=4,
        expected_values=["Cholesterol", "LDL"],
        bbox_min_ratio=0.8,
        phi_strings=[],
    ))

    cases.append(ExtractionCase(
        id="lab_cbc_typed_pdf",
        description="Typed CBC PDF — many results, schema must validate",
        file=_FIXTURES_DIR / "lab-results" / "p02-whitaker-cbc.pdf",
        mimetype="application/pdf",
        doc_type="lab_pdf",
        patient_id=21,
        openemr_doc_id=900_002,
        expected_field_count=4,
        expected_values=["WBC"],
        bbox_min_ratio=0.5,
    ))

    cases.append(ExtractionCase(
        id="lab_hba1c_image",
        description="HbA1c lab as PNG — Vision-only path, no bbox expected",
        file=_FIXTURES_DIR / "lab-results" / "p03-reyes-hba1c.png",
        mimetype="image/png",
        doc_type="lab_pdf",
        patient_id=22,
        openemr_doc_id=900_003,
        expected_field_count=1,
        expected_values=["A1c"],
        bbox_min_ratio=0.0,
    ))

    cases.append(ExtractionCase(
        id="lab_cmp_typed_pdf",
        description="Typed CMP PDF — multi-test panel, bboxes from pdfplumber",
        file=_FIXTURES_DIR / "lab-results" / "p04-kowalski-cmp.pdf",
        mimetype="application/pdf",
        doc_type="lab_pdf",
        patient_id=23,
        openemr_doc_id=900_004,
        expected_field_count=6,
        expected_values=["Sodium", "Potassium"],
        bbox_min_ratio=0.5,
    ))

    # ── Intake forms ────────────────────────────────────────────────────────
    cases.append(ExtractionCase(
        id="intake_chen_typed_pdf",
        description="Margaret Chen's typed intake — meds + allergies should yield bboxes",
        file=_FIXTURES_DIR / "intake-forms" / "p01-chen-intake-typed.pdf",
        mimetype="application/pdf",
        doc_type="intake_form",
        patient_id=20,
        openemr_doc_id=900_005,
        expected_field_count=3,            # at least 3 meds
        expected_values=["Metformin", "Lisinopril", "Penicillin"],
        bbox_min_ratio=0.5,
        phi_strings=["Margaret Chen"],
    ))

    cases.append(ExtractionCase(
        id="intake_whitaker_typed_pdf",
        description="Whitaker intake (typed PDF) — schema valid + chief concern present",
        file=_FIXTURES_DIR / "intake-forms" / "p02-whitaker-intake.pdf",
        mimetype="application/pdf",
        doc_type="intake_form",
        patient_id=21,
        openemr_doc_id=900_006,
        expected_field_count=1,
        expected_values=[],
        bbox_min_ratio=0.0,
    ))

    cases.append(ExtractionCase(
        id="intake_reyes_image",
        description="Reyes intake as PNG — Vision-only, bbox not required",
        file=_FIXTURES_DIR / "intake-forms" / "p03-reyes-intake.png",
        mimetype="image/png",
        doc_type="intake_form",
        patient_id=22,
        openemr_doc_id=900_007,
        expected_field_count=1,
        bbox_min_ratio=0.0,
    ))

    cases.append(ExtractionCase(
        id="intake_kowalski_image",
        description="Kowalski intake as PNG — Vision-only fallback",
        file=_FIXTURES_DIR / "intake-forms" / "p04-kowalski-intake.png",
        mimetype="image/png",
        doc_type="intake_form",
        patient_id=23,
        openemr_doc_id=900_008,
        expected_field_count=1,
        bbox_min_ratio=0.0,
    ))

    return cases


# ---------------------------------------------------------------------------
# Rubric evaluators
# ---------------------------------------------------------------------------


def _items(result: dict) -> list[dict]:
    """Return the list of structured items the extractor produced — meds +
    allergies for intake; lab results for lab. Anything with a per-item
    source_citation counts."""
    if result.get("doc_type") == "lab_pdf":
        return list(result.get("results") or [])
    if result.get("doc_type") == "intake_form":
        return list(result.get("current_medications") or []) + \
               list(result.get("allergies") or [])
    return []


def _eval_schema_valid(case: ExtractionCase, result: dict) -> dict:
    try:
        if result.get("doc_type") == "lab_pdf":
            LabExtraction.model_validate(result)
        elif result.get("doc_type") == "intake_form":
            IntakeExtraction.model_validate(result)
        elif result.get("doc_type") == "other":
            OtherExtraction.model_validate(result)
        else:
            return {"key": "schema_valid", "score": 0,
                    "comment": f"unknown doc_type {result.get('doc_type')}"}
    except Exception as exc:
        return {"key": "schema_valid", "score": 0, "comment": str(exc)[:200]}
    return {"key": "schema_valid", "score": 1, "comment": "ok"}


def _eval_expected_count(case: ExtractionCase, result: dict) -> dict:
    if case.expected_field_count <= 0:
        return {"key": "expected_count_matched", "score": 1, "comment": "n/a"}
    n = len(_items(result))
    score = 1 if n >= case.expected_field_count else 0
    return {"key": "expected_count_matched", "score": score,
            "comment": f"got {n}, expected ≥{case.expected_field_count}"}


def _eval_expected_values(case: ExtractionCase, result: dict) -> dict:
    if not case.expected_values:
        return {"key": "expected_values_present", "score": 1, "comment": "n/a"}
    blob = json.dumps(result, default=str).lower()
    missing = [v for v in case.expected_values if v.lower() not in blob]
    score = 1 if not missing else 0
    return {"key": "expected_values_present", "score": score,
            "comment": "all present" if score else f"missing: {missing}"}


def _eval_bbox_capture(case: ExtractionCase, result: dict) -> dict:
    if case.bbox_min_ratio <= 0:
        return {"key": "bbox_capture", "score": 1,
                "comment": "n/a (image input or no bbox required)"}
    items = _items(result)
    if not items:
        return {"key": "bbox_capture", "score": 0, "comment": "no items extracted"}
    with_bbox = sum(
        1 for it in items
        if (it.get("source_citation") or {}).get("bbox") is not None
    )
    ratio = with_bbox / len(items)
    score = 1 if ratio >= case.bbox_min_ratio else 0
    return {"key": "bbox_capture", "score": score,
            "comment": f"{with_bbox}/{len(items)} ({ratio:.0%}) ≥ {case.bbox_min_ratio:.0%}"}


_PHI_PATTERNS = [
    re.compile(r"\b\d{3}-\d{2}-\d{4}\b"),                 # SSN
    re.compile(r"\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b"),     # phone
]


def _eval_no_phi_in_logs(case: ExtractionCase, log_blob: str) -> dict:
    leaked: list[str] = []
    for phi in case.phi_strings:
        if phi and phi in log_blob:
            leaked.append(phi)
    for pat in _PHI_PATTERNS:
        for m in pat.finditer(log_blob):
            leaked.append(m.group())
    return {
        "key": "no_phi_in_logs",
        "score": 1 if not leaked else 0,
        "comment": "ok" if not leaked else f"leaked: {sorted(set(leaked))}",
    }


RUBRICS = [
    _eval_schema_valid,
    _eval_expected_count,
    _eval_expected_values,
    _eval_bbox_capture,
    # _eval_no_phi_in_logs is special — it inspects the captured log buffer
]


# ---------------------------------------------------------------------------
# Runner
# ---------------------------------------------------------------------------


async def _run_one(case: ExtractionCase, client: anthropic.AsyncAnthropic) -> dict:
    if not case.file.exists():
        return {"case_id": case.id, "error": f"missing fixture: {case.file}"}

    # Capture extractor logs so the no_phi_in_logs rubric can inspect them.
    captured: list[str] = []

    class _CapturingHandler(logging.Handler):
        def emit(self, record: logging.LogRecord) -> None:
            captured.append(self.format(record))

    handler = _CapturingHandler()
    handler.setFormatter(logging.Formatter("%(name)s %(levelname)s %(message)s"))
    root = logging.getLogger()
    root.addHandler(handler)

    pdf = case.file.read_bytes()
    t0 = time.monotonic()
    try:
        result = await extract_document(
            file_bytes=pdf,
            mimetype=case.mimetype,
            doc_type=case.doc_type,
            patient_id=case.patient_id,
            openemr_doc_id=case.openemr_doc_id,
            anthropic_client=client,
            doc_name=case.file.name,
        )
        result_dict = result.model_dump()
    finally:
        root.removeHandler(handler)
    duration_ms = int((time.monotonic() - t0) * 1000)

    return {
        "case_id": case.id,
        "duration_ms": duration_ms,
        "result": result_dict,
        "log_blob": "\n".join(captured),
    }


def _make_client() -> anthropic.AsyncAnthropic:
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY not set")
    client = anthropic.AsyncAnthropic(api_key=api_key)
    if os.environ.get("LANGCHAIN_TRACING_V2", "").lower() == "true" \
            and os.environ.get("LANGCHAIN_API_KEY"):
        from langsmith.wrappers import wrap_anthropic
        client = wrap_anthropic(client)
    return client


async def _main_async(case_filter: str | None, report_path: str | None,
                      json_path: str | None) -> int:
    cases = _build_cases()
    if case_filter:
        cases = [c for c in cases if c.id == case_filter]
        if not cases:
            print(f"No case with id {case_filter!r}", file=sys.stderr)
            return 2

    client = _make_client()
    print(f"\nRunning {len(cases)} extraction eval cases\n{'='*60}")

    total_scores: dict[str, list[int]] = {}
    case_results: list[dict] = []

    for case in cases:
        print(f"\n[{case.id}]")
        print(f"  {case.description}")
        try:
            run_out = await _run_one(case, client)
            if "error" in run_out:
                print(f"  ERROR: {run_out['error']}")
                case_results.append({
                    "case_id": case.id, "description": case.description,
                    "error": run_out["error"],
                })
                continue

            result = run_out["result"]
            log_blob = run_out["log_blob"]
            checks = []
            for rubric in RUBRICS:
                r = rubric(case, result)
                checks.append(r)
                total_scores.setdefault(r["key"], []).append(r["score"])
                symbol = "✓" if r["score"] == 1 else "✗"
                print(f"  {symbol} {r['key']}: {r['comment']}")
            phi_check = _eval_no_phi_in_logs(case, log_blob)
            checks.append(phi_check)
            total_scores.setdefault(phi_check["key"], []).append(phi_check["score"])
            symbol = "✓" if phi_check["score"] == 1 else "✗"
            print(f"  {symbol} {phi_check['key']}: {phi_check['comment']}")

            print(f"  ({run_out['duration_ms']}ms, {len(_items(result))} items extracted)")

            case_results.append({
                "case_id": case.id,
                "description": case.description,
                "duration_ms": run_out["duration_ms"],
                "checks": checks,
                "result": result,
            })
        except Exception as exc:
            logging.exception("case %s crashed", case.id)
            print(f"  CRASH: {exc}")
            case_results.append({
                "case_id": case.id, "description": case.description,
                "error": str(exc),
            })

    print(f"\n{'='*60}\nExtraction eval summary:")
    summary: dict[str, dict] = {}
    for key, scores in total_scores.items():
        passed = sum(scores)
        total = len(scores)
        pct = passed / total * 100 if total else 0.0
        print(f"  {key}: {passed}/{total} ({pct:.0f}%)")
        summary[key] = {"passed": passed, "total": total, "pct": pct}

    if json_path:
        Path(json_path).write_text(json.dumps({
            "summary": summary,
            "cases": case_results,
        }, indent=2, default=str))
        print(f"\nResults JSON written to {json_path}")

    if report_path:
        _write_markdown_report(case_results, summary, report_path)

    return 0


def _write_markdown_report(case_results: list[dict],
                           summary: dict[str, dict],
                           path: str) -> None:
    from datetime import datetime as dt

    lines: list[str] = [
        "# Clinical Co-Pilot — Extraction Eval Results",
        f"*{dt.now().strftime('%Y-%m-%d %H:%M')}*",
        "",
        "Tests ``extract_document`` against real PDF/PNG fixtures in",
        "``example-documents/``. Distinct from ``run_graph.py`` which seeds a",
        "hand-crafted extraction. This harness validates the extractor itself.",
        "",
        "## Summary",
        "",
        "| Rubric | Pass | Total | % |",
        "|--------|------|-------|---|",
    ]
    for key, s in summary.items():
        icon = "✅" if s["pct"] == 100 else ("⚠️" if s["pct"] >= 70 else "❌")
        lines.append(f"| {icon} `{key}` | {s['passed']} | {s['total']} | {s['pct']:.0f}% |")

    lines += ["", "---", "## Cases", ""]
    for r in case_results:
        lines.append(f"### `{r['case_id']}`")
        lines.append(f"**{r['description']}**")
        if "error" in r:
            lines.append(f"> ❌ ERROR: `{r['error']}`")
            lines.append("")
            continue

        ms = r.get("duration_ms", 0)
        lines.append(f"_{ms}ms_")
        lines.append("")

        # Show what got extracted
        result = r.get("result") or {}
        if result.get("doc_type") == "lab_pdf":
            results = result.get("results") or []
            lines += ["<details><summary>Extracted lab results</summary>", "", "```"]
            for lab in results[:10]:
                sc = lab.get("source_citation") or {}
                bbox_marker = " ✓bbox" if sc.get("bbox") else ""
                lines.append(f"  {lab.get('test_name','?'):28s} = {lab.get('value','?')} {lab.get('unit') or ''}{bbox_marker}")
            lines += ["```", "</details>", ""]
        elif result.get("doc_type") == "intake_form":
            meds = result.get("current_medications") or []
            allergies = result.get("allergies") or []
            lines += ["<details><summary>Extracted intake fields</summary>", "", "```"]
            for m in meds[:10]:
                sc = m.get("source_citation") or {}
                bbox_marker = " ✓bbox" if sc.get("bbox") else ""
                lines.append(f"  med:     {m.get('name','?'):20s} {m.get('dose') or ''} {m.get('frequency') or ''}{bbox_marker}")
            for a in allergies[:10]:
                sc = a.get("source_citation") or {}
                bbox_marker = " ✓bbox" if sc.get("bbox") else ""
                lines.append(f"  allergy: {a.get('allergen','?'):20s} {a.get('reaction') or ''}{bbox_marker}")
            lines += ["```", "</details>", ""]

        lines += ["| Rubric | Result | Detail |", "|--------|--------|--------|"]
        for c in r.get("checks", []):
            icon = "✅" if c["score"] == 1 else "❌"
            lines.append(f"| `{c['key']}` | {icon} | {c['comment']} |")
        lines.append("")

    Path(path).write_text("\n".join(lines))
    print(f"Markdown report written to {path}")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--case", help="Run only the case with this id")
    parser.add_argument("--report", metavar="FILE", help="Write a markdown report to FILE")
    parser.add_argument("--json", dest="json_path", metavar="FILE",
                        help="Write raw results JSON to FILE")
    args = parser.parse_args()

    rc = asyncio.run(_main_async(args.case, args.report, args.json_path))
    sys.exit(rc)
