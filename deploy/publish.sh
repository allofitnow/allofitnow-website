#!/usr/bin/env bash
set -euo pipefail
cd /root/projects/aoin-deploy
git pull --ff-only origin integration
# Only reinstall deps if package-lock.json changed since last pull (or first run)
git diff --quiet HEAD~1 package-lock.json frontend/package-lock.json 2>/dev/null || npm ci
npm run build --workspace frontend
rm -rf /opt/aoin-astro/*
cp -r frontend/dist/client/* /opt/aoin-astro/

# --- post-publish fan-out (M5 + production leg; additive) ---
AOIN_PUBLISH_ID="$(date +%s)-$(git rev-parse --short HEAD)"
bash deploy/hooks/post-publish/post-publish.sh \
  --build-tree /opt/aoin-astro --publish-id "$AOIN_PUBLISH_ID" \
  || echo "WARN: post-publish reported failure; staging unaffected; see drift ledger" >&2
