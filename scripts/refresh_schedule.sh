#!/usr/bin/env bash
# Move all of Dr. Sarah Chen's appointments to today.
#
# Why: demo seed data is pinned to a specific date. The PatientBriefTool
# query filters pc_eventDate >= today, so once the seed date is in the
# past, no appointments surface and the brief shows "None on file".
#
# Pure-shell alternative to refresh_schedule.py — needs no pymysql.
# Safe to run repeatedly.
#
# Usage:
#   bash scripts/refresh_schedule.sh
set -euo pipefail

CONTAINER="${MYSQL_CONTAINER:-development-easy-mysql-1}"
DB_USER="${DB_USER:-root}"
DB_PASS="${DB_PASS:-root}"
DB_NAME="${DB_NAME:-openemr}"
PHYSICIAN_USERNAME="${PHYSICIAN_USERNAME:-sarah.chen}"

if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
    echo "ERROR: container '${CONTAINER}' is not running."
    echo "Set MYSQL_CONTAINER if your container name differs."
    exit 1
fi

docker exec "${CONTAINER}" mariadb \
    -u"${DB_USER}" -p"${DB_PASS}" "${DB_NAME}" \
    -e "
        UPDATE openemr_postcalendar_events e
        JOIN users u ON u.id = e.pc_aid
        SET e.pc_eventDate = CURDATE(),
            e.pc_endDate   = CURDATE(),
            e.pc_time      = CONCAT(CURDATE(), ' ', TIME(e.pc_time))
        WHERE u.username = '${PHYSICIAN_USERNAME}';

        DELETE c FROM copilot_brief_cache c
        JOIN users u ON u.id = c.physician_id
        WHERE u.username = '${PHYSICIAN_USERNAME}';

        SELECT COUNT(*) AS appts_today_for_${PHYSICIAN_USERNAME//./_}
        FROM openemr_postcalendar_events e
        JOIN users u ON u.id = e.pc_aid
        WHERE u.username = '${PHYSICIAN_USERNAME}' AND e.pc_eventDate = CURDATE();
    " 2>/dev/null
