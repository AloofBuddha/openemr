#!/usr/bin/env bash
# Deploy to prod: push to GitLab, then pull on the droplet.
# PHP files and the JS bundle are volume-mounted in Docker — no restart needed.
set -euo pipefail

REMOTE_USER="root"
REMOTE_HOST="198.211.103.246"
REMOTE_PATH="/root/openemr"
SSH_KEY="$HOME/.ssh/id_ed25519"

echo "-> Pushing to GitLab..."
git push origin master

echo "-> Pulling on prod ($REMOTE_HOST)..."
ssh -i "$SSH_KEY" "$REMOTE_USER@$REMOTE_HOST" \
  "cd $REMOTE_PATH && git pull origin master"

echo ""
echo "Live at https://$REMOTE_HOST.nip.io"
