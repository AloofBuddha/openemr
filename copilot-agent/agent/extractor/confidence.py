"""Confidence-score thresholding for extraction results.

When Claude reports low confidence on a field, we keep the entry but null
out the uncertain value(s) and surface a warning so the physician knows to
verify against the source document.
"""
from __future__ import annotations

from typing import Any

CONFIDENCE_THRESHOLD = 0.7


def threshold_warnings_lab(
    results: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[str]]:
    """Null out lab values below the confidence threshold and emit warnings.

    Returns ``(cleaned_results, warnings)``. ``cleaned_results`` is a new
    list — the input is not mutated.
    """
    warnings: list[str] = []
    cleaned: list[dict[str, Any]] = []
    for r in results:
        confidence = float(r.get("confidence", 1.0))
        if confidence < CONFIDENCE_THRESHOLD:
            test_name = r.get("test_name", "unknown")
            warnings.append(
                f"Low confidence for field '{test_name}' (score={confidence:.2f}) "
                "— verify against source"
            )
            r = dict(r)
            r["value"] = None
        cleaned.append(r)
    return cleaned, warnings


def threshold_warnings_intake(data: dict[str, Any]) -> list[str]:
    """Null out low-confidence medication/allergy details and emit warnings.

    Mutates ``data`` in place — callers already own this dict.
    """
    warnings: list[str] = []
    for med in data.get("current_medications", []):
        confidence = float(med.get("confidence", 1.0))
        if confidence < CONFIDENCE_THRESHOLD:
            warnings.append(
                f"Low confidence for medication '{med.get('name', 'unknown')}' "
                f"(score={confidence:.2f}) — verify against source"
            )
            med["dose"] = None
            med["frequency"] = None
    for allergy in data.get("allergies", []):
        confidence = float(allergy.get("confidence", 1.0))
        if confidence < CONFIDENCE_THRESHOLD:
            warnings.append(
                f"Low confidence for allergy '{allergy.get('allergen', 'unknown')}' "
                f"(score={confidence:.2f}) — verify against source"
            )
            allergy["reaction"] = None
    return warnings
