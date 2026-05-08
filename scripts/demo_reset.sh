#!/usr/bin/env bash
# Reset Margaret Chen (pid=20) to a new-patient state for demos.
#
# What this does:
#   1. Clears Margaret's clinical history (encounters, vitals, meds, allergies,
#      problems, lab orders) via sql/reset_margaret.sql.
#   2. Inserts a pre-seeded intake form document record (doc_id=9901).
#   3. Writes sidecar JSON files so the copilot auto-detects and processes
#      that intake form on first load (without hitting Claude Vision/pdfplumber).
#
# Usage:
#   ./scripts/demo_reset.sh            # local Docker
#   ./scripts/demo_reset.sh --prod     # prod server (198.211.103.246)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SQL_FILE="$REPO_ROOT/sql/reset_margaret.sql"

PROD_HOST="198.211.103.246"
PROD_USER="root"
PROD_PATH="/root/openemr"
SSH_KEY="$HOME/.ssh/id_ed25519"

INTAKE_DOC_ID=9901
PATIENT_PID=20

# ── Pre-baked extraction JSON ─────────────────────────────────────────────────
# This matches the IntakeExtraction Pydantic schema exactly.
# The intake form describes a new patient with exertional chest tightness,
# T2DM/HTN meds self-reported, Penicillin + Sulfa allergies, and today's vitals.

read -r -d '' EXTRACTION_JSON << 'EXTRACTION_EOF' || true
{
  "doc_type": "intake_form",
  "patient_id": 20,
  "openemr_doc_id": 9901,
  "demographics": {
    "name": "Margaret Chen",
    "dob": "1967-08-14",
    "sex": "Female",
    "address": "4421 Magnolia Ave Apt 3B, Austin TX 78704",
    "phone": "510-555-0148"
  },
  "chief_concern": "Chest tightness on exertion x3 weeks, worse going up stairs",
  "current_medications": [
    {
      "name": "Metformin",
      "dose": "1000 mg",
      "frequency": "twice daily",
      "confidence": 0.97,
      "source_citation": {
        "source_type": "intake_form",
        "source_id": "9901",
        "page_or_section": "page 2",
        "field_or_chunk_id": "medications_0",
        "quote_or_value": "Metformin 1000mg twice daily"
      }
    },
    {
      "name": "Lisinopril",
      "dose": "10 mg",
      "frequency": "once daily",
      "confidence": 0.97,
      "source_citation": {
        "source_type": "intake_form",
        "source_id": "9901",
        "page_or_section": "page 2",
        "field_or_chunk_id": "medications_1",
        "quote_or_value": "Lisinopril 10mg daily"
      }
    },
    {
      "name": "Atorvastatin",
      "dose": "20 mg",
      "frequency": "at bedtime",
      "confidence": 0.95,
      "source_citation": {
        "source_type": "intake_form",
        "source_id": "9901",
        "page_or_section": "page 2",
        "field_or_chunk_id": "medications_2",
        "quote_or_value": "Atorvastatin 20mg at bedtime"
      }
    }
  ],
  "allergies": [
    {
      "allergen": "Penicillin",
      "reaction": "Hives",
      "confidence": 0.98,
      "source_citation": {
        "source_type": "intake_form",
        "source_id": "9901",
        "page_or_section": "page 1",
        "field_or_chunk_id": "allergies_0",
        "quote_or_value": "Penicillin — hives"
      }
    },
    {
      "allergen": "Sulfa drugs",
      "reaction": "Rash",
      "confidence": 0.95,
      "source_citation": {
        "source_type": "intake_form",
        "source_id": "9901",
        "page_or_section": "page 1",
        "field_or_chunk_id": "allergies_1",
        "quote_or_value": "Sulfa — rash"
      }
    }
  ],
  "vitals": {
    "blood_pressure": "138/88",
    "heart_rate": "82",
    "weight": "165 lbs",
    "height": "64 in",
    "bmi": "28.3",
    "temperature": null,
    "oxygen_saturation": "98%"
  },
  "family_history": [
    "Father: myocardial infarction at age 61",
    "Mother: type 2 diabetes mellitus"
  ],
  "past_medical_history": [
    "Type 2 diabetes mellitus (diagnosed 2018)",
    "Essential hypertension (diagnosed 2016)",
    "Hyperlipidemia (diagnosed 2020)"
  ],
  "surgical_history": [
    "Cholecystectomy 2014",
    "Tonsillectomy (childhood)"
  ],
  "social_history": {
    "tobacco": "Never smoker",
    "alcohol": "Occasional, 1-2 drinks/week",
    "exercise": "Walks 20-30 min, 3x/week (less recently due to chest tightness)",
    "occupation": "Retired schoolteacher"
  },
  "source_citation": {
    "source_type": "intake_form",
    "source_id": "9901",
    "page_or_section": "page 1",
    "field_or_chunk_id": "document",
    "quote_or_value": "Patient intake form — Margaret Chen"
  },
  "extraction_warnings": []
}
EXTRACTION_EOF

# Patient intake index entry — list format matching PatientIntakeIndex._load()
read -r -d '' INDEX_JSON << 'INDEX_EOF' || true
[{"doc_id": 9901, "doc_name": "margaret-intake.pdf", "ingested_at": "2026-05-06T10:00:00+00:00", "processed_at": null}]
INDEX_EOF

# ── Local reset ───────────────────────────────────────────────────────────────

reset_local() {
  echo "==> Resetting Margaret (local Docker)..."

  COMPOSE_DIR="$REPO_ROOT/docker/development-easy"
  MYSQL_CMD="docker compose -f $COMPOSE_DIR/docker-compose.yml exec -T mysql mariadb -uopenemr -popenemr openemr"

  echo "  Running reset_margaret.sql..."
  $MYSQL_CMD < "$SQL_FILE"
  echo "  SQL applied."

  SIDECAR_DIR="$REPO_ROOT/copilot-agent"
  INDEX_DIR="$SIDECAR_DIR/patient_intake_index"
  CACHE_DIR="$SIDECAR_DIR/extraction_cache"

  mkdir -p "$INDEX_DIR" "$CACHE_DIR"
  echo "$INDEX_JSON" > "$INDEX_DIR/${PATIENT_PID}.json"
  echo "$EXTRACTION_JSON" > "$CACHE_DIR/${INTAKE_DOC_ID}.json"
  echo "  Sidecar JSON files written."

  echo ""
  echo "Done. Open Dr. Chen's chart for Margaret Chen — copilot will auto-process her intake form."
}

# ── Prod reset ────────────────────────────────────────────────────────────────

reset_prod() {
  echo "==> Resetting Margaret (prod: $PROD_HOST)..."

  echo "  Wiping Margaret's document files on disk + sidecar caches..."
  # Lab uploads from prior demo runs leave PDFs in OpenEMR's documents
  # storage even after the DB rows are dropped. Same with rendered page
  # PNGs in the sidecar cache and orphaned extraction JSONs. Clear all
  # of them so the next run starts from the same baseline every time.
  ssh -i "$SSH_KEY" "$PROD_USER@$PROD_HOST" bash -s << WIPEEOF
set -euo pipefail
docker exec development-easy-openemr-1 sh -c "rm -f /var/www/localhost/htdocs/openemr/sites/default/documents/${PATIENT_PID}/* 2>/dev/null || true"
SIDECAR=$PROD_PATH/copilot-agent
# Drop every cached extraction + page render except the seed intake (9901).
find "\$SIDECAR/extraction_cache" -maxdepth 1 -type f \\
    \\( -name '*.json' -o -name '*.png' \\) \\
    ! -name '${INTAKE_DOC_ID}.json' \\
    ! -name '${INTAKE_DOC_ID}_page*.png' \\
    -delete 2>/dev/null || true
rm -f "\$SIDECAR/patient_intake_index/${PATIENT_PID}.json"
WIPEEOF

  echo "  Running reset_margaret.sql on prod..."
  ssh -i "$SSH_KEY" "$PROD_USER@$PROD_HOST" \
    "cd $PROD_PATH && docker compose -f docker/development-easy/docker-compose.yml exec -T mysql mariadb -uopenemr -popenemr openemr" \
    < "$SQL_FILE"
  echo "  SQL applied."

  echo "  Writing sidecar JSON files on prod..."
  ssh -i "$SSH_KEY" "$PROD_USER@$PROD_HOST" bash -s << SSHEOF
set -euo pipefail
SIDECAR="$PROD_PATH/copilot-agent"
mkdir -p "\$SIDECAR/patient_intake_index" "\$SIDECAR/extraction_cache"
cat > "\$SIDECAR/patient_intake_index/${PATIENT_PID}.json" << 'JSONEOF'
${INDEX_JSON}
JSONEOF
cat > "\$SIDECAR/extraction_cache/${INTAKE_DOC_ID}.json" << 'JSONEOF'
${EXTRACTION_JSON}
JSONEOF
echo "  Files written."
SSHEOF

  # The intake PDF must exist at OpenEMR's documents path AND be rendered to
  # PNGs so the source drawer can show the bbox overlay. /ingest renders on
  # upload; this script bypasses /ingest, so we render explicitly.
  PDF_LOCAL="$REPO_ROOT/example-documents/intake-forms/p01-chen-intake-typed.pdf"
  if [[ -f "\$PDF_LOCAL" ]]; then
    PDF_LOCAL="$PDF_LOCAL"
  fi
  PDF_LOCAL="$REPO_ROOT/example-documents/intake-forms/p01-chen-intake-typed.pdf"
  if [[ -f "$PDF_LOCAL" ]]; then
    echo "  Pushing intake PDF to OpenEMR documents path on prod..."
    scp -i "$SSH_KEY" "$PDF_LOCAL" "$PROD_USER@$PROD_HOST:/tmp/margaret-intake.pdf" >/dev/null
    ssh -i "$SSH_KEY" "$PROD_USER@$PROD_HOST" \
      "docker cp /tmp/margaret-intake.pdf development-easy-openemr-1:/var/www/localhost/htdocs/openemr/sites/default/documents/${PATIENT_PID}/margaret-intake.pdf && \
       docker exec development-easy-openemr-1 chown apache:apache /var/www/localhost/htdocs/openemr/sites/default/documents/${PATIENT_PID}/margaret-intake.pdf"

    echo "  Rendering page PNGs into the sidecar cache so bbox overlays work..."
    ssh -i "$SSH_KEY" "$PROD_USER@$PROD_HOST" bash -s << RENDEREOF
set -euo pipefail
cd $PROD_PATH/copilot-agent
.venv/bin/python -c "
from cache import render_pdf_pages_to_cache
from pathlib import Path
pdf = Path('/tmp/margaret-intake.pdf').read_bytes()
n = render_pdf_pages_to_cache(Path('extraction_cache'), ${INTAKE_DOC_ID}, pdf)
print(f'  rendered {n} page(s)')
"
RENDEREOF
  fi

  echo ""
  echo "Done. Open Dr. Chen's chart for Margaret Chen on https://$PROD_HOST.nip.io"
}

# ── Entry point ───────────────────────────────────────────────────────────────

if [[ "${1:-}" == "--prod" ]]; then
  reset_prod
else
  reset_local
fi
