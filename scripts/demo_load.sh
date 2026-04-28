#!/usr/bin/env bash
# Load Cedar Family Medicine demo data into a running OpenEMR Docker instance.
# Run from any directory. Requires docker compose to be up.
#
# Usage:
#   ./scripts/demo_load.sh              # load/refresh demo data
#   ./scripts/demo_load.sh --reset      # wipe and reload (destroys all existing data)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE_DIR="$REPO_ROOT/docker/development-easy"
SQL_DIR="$REPO_ROOT/sql"
MODULE_SQL="$REPO_ROOT/interface/modules/custom_modules/oe-module-clinical-copilot/sql/install.sql"

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
    DELETE FROM procedure_order             WHERE patient_id BETWEEN 1 AND 18;
    DELETE FROM procedure_report            WHERE procedure_report_id > 0;
    DELETE FROM procedure_result            WHERE procedure_result_id > 0;
    DELETE FROM procedure_order_code        WHERE procedure_order_id > 0;
    DELETE FROM form_vitals                 WHERE pid BETWEEN 1 AND 18;
    SET FOREIGN_KEY_CHECKS = 1;
  "
  # Copilot cache tables only exist after first setup — ignore if not yet created
  $MYSQL_CMD -e "
    DELETE FROM copilot_brief_cache WHERE patient_id BETWEEN 1 AND 18;
    DELETE FROM copilot_audit_log   WHERE patient_id BETWEEN 1 AND 18;
  " 2>/dev/null || true
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

# ── copilot module setup (idempotent) ─────────────────────────────────────────
echo "  setting up copilot module..."
$MYSQL_CMD < "$MODULE_SQL"
$MYSQL_CMD -e "
  INSERT INTO modules
    (mod_name, mod_directory, mod_parent, mod_type, mod_active, mod_ui_name,
     mod_relative_link, mod_ui_order, mod_ui_active, mod_description, mod_nick_name,
     mod_enc_menu, directory, date, sql_version, acl_version)
  VALUES
    ('oe-module-clinical-copilot', 'oe-module-clinical-copilot', '', '0', 1, 'Clinical Co-Pilot',
     'oe-module-clinical-copilot', 0, 1, 'AI pre-encounter brief for physicians', 'copilot',
     'no', 'interface/modules/custom_modules/oe-module-clinical-copilot', NOW(), '1', '1')
  ON DUPLICATE KEY UPDATE mod_active = 1, mod_ui_active = 1;
"
echo "  copilot module registered"

echo ""
echo "Demo data loaded."
echo "  App:        http://localhost:8300"
echo "  Dr. Chen:   sarah.chen / Sarah1234!"
echo "  Dr. Rivera: marcus.rivera / Marcus1234!"
echo "  Admin:      admin / pass"
