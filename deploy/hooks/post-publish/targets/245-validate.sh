#!/usr/bin/env bash
# Tier-1 validation target (.245 only; other hosts skip exit 0).
# m2 check against the local origin; green -> baseline advances (re-pin);
# missing baseline on first run -> bootstrap pin (no false alert on day one).
set -uo pipefail

while [ $# -gt 0 ]; do
  case "$1" in
    --build-tree) shift 2 ;;
    --publish-id) shift 2 ;;
    *) shift ;;
  esac
done

TAG=$(ip -o -4 addr show 2>/dev/null | grep -oE '192\.168\.30\.(245|246)' | head -1 | grep -oE '(245|246)$' || true)
if [ "$TAG" != "245" ]; then
  echo "245-validate: host tag '${TAG:-none}', skipping"
  exit 0
fi

VENV=/opt/aoin-hooks-venv/bin/python3
M2=deploy/hooks/post-publish/lib/m2.py
DICT=deploy/tracking-dictionary.yaml
BASE=/opt/aoin-tracking/baselines/245.json
STAMP=$(date +%s)

if [ ! -f "$BASE" ]; then
  echo "245-validate: no baseline yet, bootstrapping pin"
  exec "$VENV" "$M2" --origin http://127.0.0.1 --tree /opt/aoin-astro \
    --dictionary "$DICT" --baseline "$BASE" --mode pin --out "deploy/logs/m2-245-bootstrap-${STAMP}.json"
fi

"$VENV" "$M2" --origin http://127.0.0.1 --tree /opt/aoin-astro \
  --dictionary "$DICT" --baseline "$BASE" --mode check --out "deploy/logs/m2-245-check-${STAMP}.json"
RC=$?
if [ "$RC" -eq 0 ]; then
  "$VENV" "$M2" --origin http://127.0.0.1 --tree /opt/aoin-astro \
    --dictionary "$DICT" --baseline "$BASE" --mode pin --out "deploy/logs/m2-245-repin-${STAMP}.json" || true
fi
exit "$RC"
