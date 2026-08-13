#!/usr/bin/env bash
set -euo pipefail
cd /root/projects/aoin-deploy
git pull --ff-only origin integration
# Only reinstall deps if package-lock.json changed since last pull (or first run)
git diff --quiet HEAD~1 package-lock.json frontend/package-lock.json 2>/dev/null || npm ci
npm run build --workspace frontend
cp -r frontend/dist/client/* /opt/aoin-astro/