#!/usr/bin/env bash
# Load Cedar Family Medicine demo data into a running OpenEMR Docker instance.
# Run from any directory. Requires docker compose to be up.
#
# Usage:
#   ./scripts/demo_load.sh              # load demo data
#   ./scripts/demo_load.sh --reset      # wipe and reload (destroys all existing data)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE_DIR="$REPO_ROOT/docker/development-easy"
SQL_DIR="$REPO_ROOT/sql"

MYSQL_CMD="docker compose -f $COMPOSE_DIR/docker-compose.yml exec -T mysql mariadb -uopenemr -popenemr openemr"

# ── optional reset ────────────────────────────────────────────────────────────
if [[ "${1:-}" == "--reset" ]]; then
  echo "Resetting demo data (clearing existing rows then re-seeding)..."
  $MYSQL_CMD -e "
    SET FOREIGN_KEY_CHECKS = 0;
    DELETE FROM patient_data                WHERE pid BETWEEN 4 AND 18;
    DELETE FROM openemr_postcalendar_events WHERE pc_pid BETWEEN 1 AND 18;
    DELETE FROM form_encounter              WHERE pid BETWEEN 1 AND 18;
    DELETE FROM forms                       WHERE pid BETWEEN 1 AND 18;
    DELETE FROM form_soap                   WHERE id > 0;
    DELETE FROM prescriptions               WHERE patient_id BETWEEN 1 AND 18;
    DELETE FROM lists                       WHERE pid BETWEEN 1 AND 18;
    DELETE FROM issue_encounter             WHERE pid BETWEEN 1 AND 18;
    DELETE FROM allergy                     WHERE pid BETWEEN 1 AND 18;
    DELETE FROM procedure_order             WHERE patient_id BETWEEN 1 AND 18;
    DELETE FROM procedure_report            WHERE procedure_report_id > 0;
    DELETE FROM procedure_result            WHERE procedure_result_id > 0;
    DELETE FROM procedure_order_code        WHERE procedure_order_id > 0;
    DELETE FROM copilot_brief_cache         WHERE patient_id BETWEEN 1 AND 18;
    DELETE FROM copilot_audit_log           WHERE patient_id BETWEEN 1 AND 18;
    SET FOREIGN_KEY_CHECKS = 1;
  "
  $MYSQL_CMD < "$SQL_DIR/demo_seed.sql"
  echo "  seed applied"
fi

# ── augments (idempotent via INSERT IGNORE / ON DUPLICATE KEY) ────────────────
for f in demo_augment demo_augment2 demo_augment3 demo_augment4; do
  echo "  applying $f.sql..."
  $MYSQL_CMD < "$SQL_DIR/${f}.sql"
done

# ── pin appointments to today (seed dates go stale as the calendar advances) ──
$MYSQL_CMD -e "UPDATE openemr_postcalendar_events SET pc_eventDate = CURDATE() WHERE pc_aid IN (10, 11);"
echo "  appointments pinned to today"

echo ""
echo "Demo data loaded."
echo "  App:        http://localhost:8300"
echo "  Dr. Chen:   sarah.chen / Sarah1234!"
echo "  Dr. Rivera: marcus.rivera / Marcus1234!"
echo "  Admin:      admin / pass"
