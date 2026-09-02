#!/usr/bin/env bash
set -euo pipefail
cd /root/projects/aoin-deploy
git pull --ff-only origin integration
# #101: generate missing video rungs + register in payload BEFORE the build so
# HTML bakes data-rungs in the same pass. Additive: failure warns, never aborts.
bash deploy/hooks/ladder-rungs.sh || echo "WARN: ladder rung generation failed; publish continues without new rungs" >&2
# Only reinstall deps if package-lock.json changed since last pull (or first run)
git diff --quiet HEAD~1 package-lock.json frontend/package-lock.json 2>/dev/null || npm ci
# #67: canonical origin for og:url/canonical in the build. Staging default is
# baked into astro.config; a prod (post-NS-flip) build would export
# SITE_URL=https://allofitnow.com instead.
npm run build --workspace frontend
rm -rf /opt/aoin-astro/*
cp -r frontend/dist/client/* /opt/aoin-astro/

# --- post-publish fan-out (M5 + production leg; additive) ---
AOIN_PUBLISH_ID="$(date +%s)-$(git rev-parse --short HEAD)"
bash deploy/hooks/post-publish/post-publish.sh \
  --build-tree /opt/aoin-astro --publish-id "$AOIN_PUBLISH_ID" \
  || echo "WARN: post-publish reported failure; staging unaffected; see drift ledger" >&2
