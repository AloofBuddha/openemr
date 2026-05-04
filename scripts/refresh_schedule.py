#!/usr/bin/env python3
"""
Refresh demo schedule to today's date.

Moves all of Dr. Sarah Chen's appointments to today so the demo
works regardless of what day it's run. Safe to run repeatedly.

Usage:
    python scripts/refresh_schedule.py

    # Or from the evals directory:
    cd evals && python ../scripts/refresh_schedule.py
"""

import os
import sys
from datetime import date, timedelta

import pymysql
import pymysql.cursors
from dotenv import load_dotenv

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "../docker/development-easy/.env"))
load_dotenv()  # also try cwd/.env

TODAY = date.today().isoformat()

def _db() -> pymysql.Connection:
    return pymysql.connect(
        host=os.getenv("DB_HOST", "127.0.0.1"),
        port=int(os.getenv("DB_PORT", "3306")),
        user=os.getenv("DB_USER", "openemr"),
        password=os.getenv("DB_PASSWORD", "openemr"),
        database=os.getenv("DB_NAME", "openemr"),
        cursorclass=pymysql.cursors.DictCursor,
        autocommit=False,
    )


def refresh(conn: pymysql.Connection) -> None:
    with conn.cursor() as cur:
        # Find Dr. Sarah Chen's user id
        cur.execute("SELECT id FROM users WHERE username = 'sarah.chen' LIMIT 1")
        row = cur.fetchone()
        if not row:
            print("ERROR: sarah.chen not found — run the demo seed first.")
            sys.exit(1)
        physician_id = row["id"]

        # Find what date her appointments are currently on
        cur.execute(
            "SELECT DISTINCT pc_eventDate FROM openemr_postcalendar_events "
            "WHERE pc_aid = %s ORDER BY pc_eventDate DESC LIMIT 1",
            (physician_id,),
        )
        row = cur.fetchone()
        if not row:
            print("No appointments found for sarah.chen. Run demo seed first.")
            sys.exit(1)

        current_date = str(row["pc_eventDate"])

        if current_date == TODAY:
            print(f"Schedule already on today ({TODAY}). Nothing to do.")
            return

        print(f"Moving appointments from {current_date} → {TODAY}")

        # Update all calendar event dates and the datetime field
        cur.execute(
            """UPDATE openemr_postcalendar_events
               SET pc_eventDate = %s,
                   pc_endDate   = %s,
                   pc_time      = CONCAT(%s, ' ', TIME(pc_time))
               WHERE pc_aid = %s AND pc_eventDate = %s""",
            (TODAY, TODAY, TODAY, physician_id, current_date),
        )
        updated = cur.rowcount
        print(f"  Updated {updated} appointment rows.")

        # Also clear the brief cache so stale briefs don't show
        cur.execute(
            "DELETE FROM copilot_brief_cache WHERE physician_id = %s",
            (physician_id,),
        )
        print(f"  Cleared brief cache for physician {physician_id}.")

    conn.commit()
    print(f"Done. Schedule is now on {TODAY}.")


if __name__ == "__main__":
    conn = _db()
    try:
        refresh(conn)
    finally:
        conn.close()
