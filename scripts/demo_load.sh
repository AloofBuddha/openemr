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
  echo "Resetting demo data (re-seeding from scratch)..."
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
