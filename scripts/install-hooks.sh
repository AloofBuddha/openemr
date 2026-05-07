#!/usr/bin/env bash
#
# Install the W2 eval gate Git hooks.
#
# Symlinks .git/hooks/pre-push to scripts/git-hooks/pre-push so the eval
# gate runs before every push to remote. Re-run any time hooks are added
# or .git is recreated.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOOKS_DIR="${REPO_ROOT}/scripts/git-hooks"
GIT_HOOKS_DIR="${REPO_ROOT}/.git/hooks"

if [[ ! -d "${GIT_HOOKS_DIR}" ]]; then
    echo "❌ ${GIT_HOOKS_DIR} does not exist — are you inside a git repo?"
    exit 1
fi

for hook in "${HOOKS_DIR}"/*; do
    name="$(basename "${hook}")"
    target="${GIT_HOOKS_DIR}/${name}"
    chmod +x "${hook}"
    ln -sf "${hook}" "${target}"
    echo "✓ installed ${name} → $(readlink "${target}")"
done

echo
echo "Done. The W2 eval gate will run before every git push."
echo "Bypass with: GAUNTLET_SKIP_GATE=1 git push"
