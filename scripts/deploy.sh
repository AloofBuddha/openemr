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

if [ -d dashboard-ui ]; then
  if [ ! -f dashboard-ui/.env.production ]; then
    echo "-> Skipping dashboard-ui (missing dashboard-ui/.env.production — see .env.production.example)"
  else
    echo "-> Building dashboard-ui..."
    (cd dashboard-ui && npm run build)

    echo "-> Pushing dashboard dist/ to prod..."
    rsync -e "ssh -i $SSH_KEY" -a --delete \
      dashboard-ui/dist/ \
      "$REMOTE_USER@$REMOTE_HOST:$REMOTE_PATH/dashboard/"
  fi
fi

echo ""
echo "Live at https://$REMOTE_HOST.nip.io"
echo "Dashboard: https://$REMOTE_HOST.nip.io/dashboard/"
