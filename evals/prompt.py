"""
Matches Orchestrator.php exactly: same SYSTEM_PROMPT, same buildUserMessage logic.
Any changes to the PHP must be mirrored here to keep evals valid.
"""

from typing import Any

SYSTEM_PROMPT = """\
You are a Clinical Co-Pilot embedded in an EHR. Give physicians a fast, skimmable pre-encounter brief.

Rules:
- Only state facts present in the provided data. Never fabricate clinical details.
- Write 4–6 bullet points. No headers. Telegraphic style — short phrases, not sentences.
- Lead with why here today, then key changes since last visit, active meds of concern, flagged labs.
- For every specific data point (medication name/dose, lab value, visit reason), wrap the cited phrase in source markers: [[N]]the phrase[[/N]] where N is the source number. Example: "[[3]]Jardiance 10mg[[/3]] — no changes". The markers are invisible to the reader; only wrap the data phrase itself, not surrounding prose.
- If data is missing, note it briefly (e.g. "No labs on file").
- Do not diagnose or recommend treatments.\
"""


def build_user_message(patient_data: dict[str, Any]) -> tuple[str, dict]:
    """Returns (user_message, sources) — mirrors Orchestrator::buildUserMessage()."""
    sources: dict[str, dict] = {}
    idx = 1
    lines: list[str] = []

    # ── Appointment ──────────────────────────────────────────────────────────
    appt = patient_data.get("today_appointment")
    reason = (appt.get("reason") or "Not specified") if appt else "None on file"
    sources[str(idx)] = {
        "type": "appointment",
        "label": "Today's appointment",
        "fields": _compact([
            {"key": "Date", "value": appt.get("date", "") if appt else ""},
            {"key": "Time", "value": appt.get("time", "") if appt else ""},
            {"key": "Reason", "value": reason},
        ]),
        "scroll_to": "#appointments_ps_expand",
    }
    lines.append(f"[{idx}] Today's appointment: {reason}")
    idx += 1

    # ── Last encounter ────────────────────────────────────────────────────────
    enc = patient_data.get("last_encounter")
    if enc:
        enc_date = enc.get("date", "unknown")
        soap = enc.get("soap", {})
        assessment = (soap.get("assessment") or "").strip()
        sources[str(idx)] = {
            "type": "encounter",
            "label": f"Encounter {enc_date}",
            "fields": _compact([
                {"key": "Date", "value": enc_date},
                {"key": "Reason", "value": enc.get("reason", "")},
                {"key": "Subjective", "value": (soap.get("subjective") or "").strip()},
                {"key": "Assessment", "value": assessment},
                {"key": "Plan", "value": (soap.get("plan") or "").strip()},
            ]),
            "scroll_to": "#appointments_ps_expand",
        }
        lines.append(f"[{idx}] Last encounter ({enc_date}): {assessment or 'No assessment'}")
    else:
        sources[str(idx)] = {
            "type": "encounter",
            "label": "Last encounter",
            "fields": [{"key": "Note", "value": "No prior encounters on file"}],
            "scroll_to": "",
        }
        lines.append(f"[{idx}] Last encounter: none")
    idx += 1

    # ── Medications ───────────────────────────────────────────────────────────
    meds = patient_data.get("active_medications") or []
    if not meds:
        sources[str(idx)] = {
            "type": "medication",
            "label": "Active medications",
            "fields": [{"key": "Note", "value": "None documented"}],
            "scroll_to": "#prescriptions_ps_expand",
        }
        lines.append(f"[{idx}] Medications: none documented")
        idx += 1
    else:
        for med in meds:
            label = f"{med.get('drug', '')} {med.get('dosage', '')} {med.get('unit', '')}".strip()
            sources[str(idx)] = {
                "type": "medication",
                "label": label,
                "fields": _compact([
                    {"key": "Drug", "value": med.get("drug", "")},
                    {"key": "Dose", "value": f"{med.get('dosage', '')} {med.get('unit', '')}".strip()},
                    {"key": "Route", "value": med.get("route", "")},
                    {"key": "Frequency", "value": med.get("interval", "")},
                    {"key": "Notes", "value": med.get("note", "")},
                ]),
                "scroll_to": "#prescriptions_ps_expand",
            }
            freq = f" ({med['interval']})" if med.get("interval") else ""
            lines.append(f"[{idx}] Medication: {label}{freq}")
            idx += 1

    # ── Labs ──────────────────────────────────────────────────────────────────
    labs = patient_data.get("recent_labs") or []
    if not labs:
        sources[str(idx)] = {
            "type": "lab",
            "label": "Recent labs",
            "fields": [{"key": "Note", "value": "None on file"}],
            "scroll_to": "#labdata_ps_expand",
        }
        lines.append(f"[{idx}] Labs: none on file")
        idx += 1
    else:
        for lab in labs:
            result = f"{lab.get('value', '')} {lab.get('units', '')}".strip()
            status = f"ABNORMAL ({lab['abnormal']})" if lab.get("abnormal") and lab["abnormal"] not in ("N", "") else "Within range"
            label = f"{lab.get('test', '')}: {result}"
            sources[str(idx)] = {
                "type": "lab",
                "label": label,
                "fields": _compact([
                    {"key": "Test", "value": lab.get("test", "")},
                    {"key": "Result", "value": result},
                    {"key": "Reference", "value": lab.get("range", "")},
                    {"key": "Status", "value": status},
                    {"key": "Collected", "value": lab.get("date_collected", "")},
                ]),
                "scroll_to": "#labdata_ps_expand",
            }
            flag = f" [ABNORMAL: {lab['abnormal']}]" if lab.get("abnormal") and lab["abnormal"] not in ("N", "") else ""
            collected = f" — {lab['date_collected']}" if lab.get("date_collected") else ""
            lines.append(f"[{idx}] Lab: {label}{flag}{collected}")
            idx += 1

    demo = patient_data.get("demographics", {})
    name = demo.get("name", "Unknown")
    age = demo.get("age", "")
    sex = demo.get("sex", "")
    src_block = "\n".join(lines)

    message = (
        f"Brief this patient. Cite source numbers inline (e.g. [1]) next to each fact.\n\n"
        f"PATIENT: {name}, {age}y {sex}\n\n"
        f"SOURCES:\n{src_block}"
    )
    return message, sources


def _compact(fields: list[dict]) -> list[dict]:
    return [f for f in fields if str(f.get("value", "")).strip()]
