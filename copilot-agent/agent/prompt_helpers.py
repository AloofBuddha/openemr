"""Formatters that turn structured state into prompt-ready strings.

Two consumers:
    - ``format_guideline_sources`` formats RAG hits as numbered ``[G1]`` refs
    - ``summarise_extracted_docs`` formats extracted lab/intake docs for the answer prompt
"""
from __future__ import annotations

import json
from typing import Any

_GUIDELINE_TRUNCATE_CHARS = 300
_LAB_RESULTS_LIMIT = 10
_INTAKE_LIST_LIMIT = 8


def format_guideline_sources(chunks: list[dict[str, Any]]) -> str:
    """Format retrieved guideline chunks as a numbered reference list.

    Example output::

        [G1] ACC/AHA 2023 §2.1: "For most adults, the target blood pressure..."
        [G2] ADA 2025 §6.5: "For most non-pregnant adults with T2D..."
    """
    if not chunks:
        return ""

    lines: list[str] = []
    for i, chunk in enumerate(chunks, start=1):
        source_ref = chunk.get("source_ref", "Unknown source")
        text = chunk.get("text", "")

        # Strip the source_ref line from the top of the text if present —
        # we render it separately in the bracket label.
        text_lines = text.strip().splitlines()
        if text_lines and text_lines[0].strip() == source_ref:
            body = " ".join(text_lines[1:]).strip()
        else:
            body = " ".join(text_lines).strip()

        if len(body) > _GUIDELINE_TRUNCATE_CHARS:
            body = body[: _GUIDELINE_TRUNCATE_CHARS - 3] + "..."

        lines.append(f'[G{i}] {source_ref}: "{body}"')

    return "\n".join(lines)


def summarise_extracted_docs(extracted_docs: list[dict[str, Any]]) -> str:
    """Convert extracted doc dicts to a human-readable summary for the prompt.

    Each document is prefixed with its ``[[PN]]`` ref so the answer model
    can cite specific docs back.
    """
    if not extracted_docs:
        return "No documents have been extracted yet."

    lines: list[str] = []
    for i, doc in enumerate(extracted_docs, start=1):
        doc_type = doc.get("doc_type", "unknown")
        doc_id = doc.get("openemr_doc_id", "?")

        if doc_type == "lab_pdf":
            lines.extend(_summarise_lab(i, doc_id, doc.get("results", [])))
        elif doc_type == "intake_form":
            lines.extend(_summarise_intake(i, doc_id, doc))
        else:
            lines.append(f"[[P{i}]] Unknown document type (doc_id={doc_id})")

    return "\n".join(lines)


def _summarise_lab(idx: int, doc_id: Any, results: list[dict[str, Any]]) -> list[str]:
    out: list[str] = [f"[[P{idx}]] Lab Report (doc_id={doc_id}):"]
    for r in results[:_LAB_RESULTS_LIMIT]:
        out.append(
            f"  - {r.get('test_name', '?')}: {r.get('value', '?')} {r.get('unit', '')} "
            f"(ref: {r.get('reference_range', 'N/A')}, flag: {r.get('abnormal_flag', 'N/A')})"
        )
    if len(results) > _LAB_RESULTS_LIMIT:
        out.append(f"  ... and {len(results) - _LAB_RESULTS_LIMIT} more results")
    return out


def _summarise_intake(idx: int, doc_id: Any, doc: dict[str, Any]) -> list[str]:
    out: list[str] = [f"[[P{idx}]] Intake Form (doc_id={doc_id}):"]
    out.append(f"  Chief concern: {doc.get('chief_concern') or 'not stated'}")

    demo = doc.get("demographics") or {}
    if demo:
        out.append(f"  Demographics: {json.dumps(demo)}")

    meds = doc.get("current_medications", [])
    if meds:
        med_str = "; ".join(
            f"{m.get('name', '?')} {m.get('dose', '')} {m.get('frequency', '')}".strip()
            for m in meds[:_INTAKE_LIST_LIMIT]
        )
        out.append(f"  Medications: {med_str}")

    allergies = doc.get("allergies", [])
    if allergies:
        allergy_str = "; ".join(
            f"{a.get('allergen', '?')} ({a.get('reaction') or 'reaction unknown'})"
            for a in allergies[:_INTAKE_LIST_LIMIT]
        )
        out.append(f"  Allergies: {allergy_str}")

    return out
