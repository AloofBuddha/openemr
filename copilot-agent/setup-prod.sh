#!/usr/bin/env bash
# Run on the production server (as root) to install and start the sidecar.
# Usage: cd /root/openemr/copilot-agent && bash setup-prod.sh
set -euo pipefail

SIDECAR_DIR="$(cd "$(dirname "$0")" && pwd)"
VENV="$SIDECAR_DIR/.venv"

echo "-> Installing Python deps..."
python3 -m venv "$VENV"
"$VENV/bin/pip" install --quiet -r "$SIDECAR_DIR/requirements.txt"

echo "-> Writing systemd unit..."
cat > /etc/systemd/system/copilot-agent.service <<EOF
[Unit]
Description=Clinical Co-Pilot Python Sidecar
After=network.target

[Service]
Type=simple
WorkingDirectory=$SIDECAR_DIR
EnvironmentFile=$SIDECAR_DIR/.env
ExecStart=$VENV/bin/uvicorn main:app --host 127.0.0.1 --port 8400 --log-level info
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable copilot-agent
systemctl restart copilot-agent
echo "-> Waiting for sidecar to start..."
sleep 8
systemctl status copilot-agent --no-pager | head -15
curl -sf http://127.0.0.1:8400/health && echo "-> Sidecar healthy"
