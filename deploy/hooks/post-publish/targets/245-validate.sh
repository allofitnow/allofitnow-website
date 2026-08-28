#!/usr/bin/env bash
# Tier-1 validation target: m2 check against the local origin; on green the
# baseline advances (re-pin). Nonzero check exit propagates (isolated by the
# fan-out entry) and is alerted best effort.
set -uo pipefail

while [ $# -gt 0 ]; do
  case "$1" in
    --build-tree) shift 2 ;;
    --publish-id) shift 2 ;;
    *) shift ;;
  esac
done

VENV=/opt/aoin-hooks-venv/bin/python3
M2=deploy/hooks/post-publish/lib/m2.py
DICT=deploy/tracking-dictionary.yaml
BASE=/opt/aoin-tracking/baselines/245.json
OUT="deploy/logs/m2-245-check-$(date +%s).json"

"$VENV" "$M2" --origin http://127.0.0.1 --tree /opt/aoin-astro \
  --dictionary "$DICT" --baseline "$BASE" --mode check --out "$OUT"
RC=$?
if [ "$RC" -eq 0 ]; then
  "$VENV" "$M2" --origin http://127.0.0.1 --tree /opt/aoin-astro \
    --dictionary "$DICT" --baseline "$BASE" --mode pin \
    --out "deploy/logs/m2-245-repin-$(date +%s).json" || true
fi
exit "$RC"
