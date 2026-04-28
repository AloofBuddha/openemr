"""
Python replica of PatientBriefTool.php — exact same SQL queries.
Used by the eval harness to gather patient data without going through PHP/OpenEMR.
"""

import hashlib
import json
from datetime import date, datetime
from typing import Any

import pymysql
import pymysql.cursors


def _age_from_dob(dob: str) -> str:
    if not dob:
        return ""
    try:
        birth = datetime.strptime(dob, "%Y-%m-%d").date()
        today = date.today()
        age = today.year - birth.year - ((today.month, today.day) < (birth.month, birth.day))
        return str(age)
    except ValueError:
        return ""


def gather(conn: pymysql.Connection, patient_id: int, physician_id: int) -> dict[str, Any]:
    demographics = _fetch_demographics(conn, patient_id)
    appointment = _fetch_today_appointment(conn, patient_id, physician_id)
    encounter = _fetch_last_encounter(conn, patient_id)
    medications = _fetch_active_medications(conn, patient_id)
    labs = _fetch_recent_labs(conn, patient_id)

    data = dict(
        demographics=demographics,
        appointment=appointment,
        encounter=encounter,
        medications=medications,
        labs=labs,
    )
    data_hash = hashlib.sha256(json.dumps(data, default=str).encode()).hexdigest()

    return {
        "demographics": demographics,
        "today_appointment": appointment,
        "last_encounter": encounter,
        "active_medications": medications,
        "recent_labs": labs,
        "data_hash": data_hash,
    }


def _fetch_demographics(conn: pymysql.Connection, patient_id: int) -> dict:
    with conn.cursor() as cur:
        cur.execute(
            """SELECT pid, fname, lname, DOB, sex, phone_cell, phone_home,
                      street, city, state
               FROM patient_data WHERE pid = %s LIMIT 1""",
            (patient_id,),
        )
        row = cur.fetchone()
    if not row:
        return {}
    return {
        "pid": int(row["pid"]),
        "name": f"{row['fname'] or ''} {row['lname'] or ''}".strip(),
        "dob": row["DOB"] or "",
        "age": _age_from_dob(str(row["DOB"] or "")),
        "sex": row["sex"] or "",
        "phone": row["phone_cell"] or row["phone_home"] or "",
    }


def _fetch_today_appointment(conn: pymysql.Connection, patient_id: int, physician_id: int) -> dict | None:
    with conn.cursor() as cur:
        cur.execute(
            """SELECT pc_eid, pc_eventDate, pc_startTime, pc_title, pc_hometext
               FROM openemr_postcalendar_events
               WHERE pc_pid = %s AND pc_aid = %s AND pc_eventDate = CURDATE()
               ORDER BY pc_startTime ASC LIMIT 1""",
            (patient_id, physician_id),
        )
        row = cur.fetchone()
    if not row:
        return None
    return {
        "appointment_id": int(row["pc_eid"]),
        "date": str(row["pc_eventDate"] or ""),
        "time": str(row["pc_startTime"] or ""),
        "reason": row["pc_hometext"] or row["pc_title"] or "",
    }


def _fetch_last_encounter(conn: pymysql.Connection, patient_id: int) -> dict | None:
    with conn.cursor() as cur:
        cur.execute(
            """SELECT fe.encounter, fe.date, fe.reason,
                      fs.subjective, fs.objective, fs.assessment, fs.plan
               FROM form_encounter fe
               LEFT JOIN forms f
                 ON f.encounter = fe.encounter AND f.pid = fe.pid AND f.formdir = 'soap'
               LEFT JOIN form_soap fs ON fs.id = f.form_id
               WHERE fe.pid = %s
               ORDER BY fe.date DESC LIMIT 1""",
            (patient_id,),
        )
        row = cur.fetchone()
    if not row:
        return None
    return {
        "encounter_id": int(row["encounter"]),
        "date": str(row["date"] or ""),
        "reason": row["reason"] or "",
        "soap": {
            "subjective": row["subjective"] or "",
            "objective": row["objective"] or "",
            "assessment": row["assessment"] or "",
            "plan": row["plan"] or "",
        },
    }


def _fetch_active_medications(conn: pymysql.Connection, patient_id: int) -> list[dict]:
    with conn.cursor() as cur:
        cur.execute(
            """SELECT id, drug, dosage, quantity, unit, route, `interval`, `note`
               FROM prescriptions
               WHERE patient_id = %s AND active = 1
               ORDER BY drug ASC""",
            (patient_id,),
        )
        rows = cur.fetchall()
    return [
        {
            "id": int(r["id"]),
            "drug": r["drug"] or "",
            "dosage": r["dosage"] or "",
            "unit": r["unit"] or "",
            "route": r["route"] or "",
            "interval": r["interval"] or "",
            "note": r["note"] or "",
        }
        for r in rows
    ]


def _fetch_recent_labs(conn: pymysql.Connection, patient_id: int) -> list[dict]:
    with conn.cursor() as cur:
        cur.execute(
            """SELECT pr.result_code, pr.result_text, pr.result, pr.units,
                      pr.range, pr.abnormal, prep.date_collected
               FROM procedure_result pr
               JOIN procedure_report prep
                 ON prep.procedure_report_id = pr.procedure_report_id
               JOIN procedure_order po
                 ON po.procedure_order_id = prep.procedure_order_id
               WHERE po.patient_id = %s AND prep.date_collected IS NOT NULL
               ORDER BY prep.date_collected DESC LIMIT 20""",
            (patient_id,),
        )
        rows = cur.fetchall()
    return [
        {
            "test": r["result_text"] or r["result_code"] or "",
            "value": r["result"] or "",
            "units": r["units"] or "",
            "range": r["range"] or "",
            "abnormal": r["abnormal"] or "",
            "date_collected": str(r["date_collected"] or ""),
        }
        for r in rows
    ]
