#!/usr/bin/env bash
# Sandbox repin target (.246 only; other hosts skip exit 0).
# The only .246 change kind is an ops rebuild, so the baseline always
# advances to the fresh tree (pin unconditionally).
set -uo pipefail

while [ $# -gt 0 ]; do
  case "$1" in
    --build-tree) shift 2 ;;
    --publish-id) shift 2 ;;
    *) shift ;;
  esac
done

TAG=$(ip -o -4 addr show 2>/dev/null | grep -oE '192\.168\.30\.(245|246)' | head -1 | grep -oE '(245|246)$' || true)
if [ "$TAG" != "246" ]; then
  echo "246-repin: host tag '${TAG:-none}', skipping"
  exit 0
fi

VENV=/opt/aoin-hooks-venv/bin/python3
M2=deploy/hooks/post-publish/lib/m2.py
DICT=deploy/tracking-dictionary.yaml
BASE=/opt/aoin-tracking/baselines/246.json

exec "$VENV" "$M2" --origin http://127.0.0.1 --tree /opt/aoin-astro \
  --dictionary "$DICT" --baseline "$BASE" --mode pin --out "deploy/logs/m2-246-repin-$(date +%s).json"
