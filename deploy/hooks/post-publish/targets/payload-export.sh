#!/usr/bin/env bash
# post-publish target (#153): export this host's Payload content collections to
# data/db/<host>-payload.json so DB edits become git-trackable.
#
# Writes the file only — the commit + push happens from the agent box (this host
# uses an unauthenticated HTTPS remote and cannot push). A Hermes cron fetches
# the exported JSON from each host, commits, and pushes.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
cd "$REPO_ROOT" || exit 0

# Host label = last octet of the primary LAN IP (245/246/247), else hostname.
HOST_LABEL=$(hostname -I 2>/dev/null | tr ' ' '\n' | grep -oE '192\.168\.[0-9]+\.[0-9]+' | head -1 | grep -oE '[0-9]+$')
[ -z "$HOST_LABEL" ] && HOST_LABEL=$(hostname)

OUT="data/db/${HOST_LABEL}-payload.json"
mkdir -p data/db

if AOIN_HOST_LABEL="$HOST_LABEL" mongosh --quiet scripts/export-payload.js > "$OUT" 2>/dev/null; then
  echo "payload-export: wrote ${OUT} ($(wc -c < "$OUT") bytes)"
  exit 0
else
  echo "payload-export: mongosh export failed" >&2
  exit 1
fi
