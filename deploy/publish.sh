#!/usr/bin/env bash
set -euo pipefail
cd /root/projects/aoin-deploy

# --live: publish straight to the live root (allofitnow.com), bypassing the
# soft/ acceptance stage on 46009.someofitlater.com. Both domains serve the same
# R2 bucket 46009, so a live-root sync updates BOTH — --live only skips the
# separate soft -> promote (E3/E4) dance. Live-root stays gated to .245.
LIVE=0
for arg in "$@"; do
  case "$arg" in
    --live) LIVE=1 ;;
  esac
done
if [ "$LIVE" -eq 1 ]; then
  export AOIN_R2_LIVE_ROOT=1
fi

git pull --ff-only origin staging
# #101: generate missing video rungs + register in payload BEFORE the build so
# HTML bakes data-rungs in the same pass. Additive: failure warns, never aborts.
bash deploy/hooks/ladder-rungs.sh || echo "WARN: ladder rung generation failed; publish continues without new rungs" >&2
# Only reinstall deps if package-lock.json changed since last pull (or first run)
git diff --quiet HEAD~1 package-lock.json frontend/package-lock.json 2>/dev/null || npm ci
# #67: canonical origin for og:url/canonical in the build. Default to the
# PROD origin now that the NS flip is done (#117): every publish is a prod
# publish. Explicitly export SITE_URL first to build a staging tree instead.
export SITE_URL="${SITE_URL:-https://allofitnow.com}"
npm run build --workspace frontend
rm -rf /opt/aoin-astro/*
cp -r frontend/dist/client/* /opt/aoin-astro/

# --- post-publish fan-out (M5 + production leg; additive) ---
AOIN_PUBLISH_ID="$(date +%s)-$(git rev-parse --short HEAD)"
POST_ARGS=(--build-tree /opt/aoin-astro --publish-id "$AOIN_PUBLISH_ID")
[ "$LIVE" -eq 1 ] && POST_ARGS+=(--skip-soft)
bash deploy/hooks/post-publish/post-publish.sh "${POST_ARGS[@]}" \
  || echo "WARN: post-publish reported failure; staging unaffected; see drift ledger" >&2
