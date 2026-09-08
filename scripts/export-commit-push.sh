#!/usr/bin/env bash
# Export this host's Payload DB -> data/db/<host>-payload.json, then commit + push.
# Runs on each host (system cron) so every DB edit leaves a git footprint (#153).
# Pushes to the host's current branch (staging / designer246 / designer247).
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT" || exit 1

HOST_LABEL=$(hostname -I 2>/dev/null | tr ' ' '\n' | grep -oE '192\.168\.[0-9]+\.[0-9]+' | head -1 | grep -oE '[0-9]+$')
[ -z "$HOST_LABEL" ] && HOST_LABEL=$(hostname)

BRANCH=$(git branch --show-current 2>/dev/null)
[ -z "$BRANCH" ] && BRANCH="staging"

# Sync before commit (best-effort; avoid silently diverging from origin).
git fetch origin "$BRANCH" 2>/dev/null || true
git pull --ff-only origin "$BRANCH" 2>/dev/null || true

OUT="data/db/${HOST_LABEL}-payload.json"
mkdir -p data/db

if ! AOIN_HOST_LABEL="$HOST_LABEL" mongosh --quiet scripts/export-payload.js > "$OUT" 2>/dev/null; then
  echo "export-commit-push: export failed" >&2
  exit 1
fi

if git diff --quiet -- "$OUT"; then
  echo "export-commit-push: no change in ${HOST_LABEL}-payload.json"
  exit 0
fi

git add "$OUT"
git commit -m "data: refresh ${HOST_LABEL}-payload.json" --no-verify
git push origin "$BRANCH" 2>&1 | tail -2
