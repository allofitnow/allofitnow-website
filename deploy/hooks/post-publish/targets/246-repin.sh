#!/usr/bin/env bash
# Sandbox repin target: the only .246 change kind is an ops rebuild, so the
# baseline always advances to the fresh tree (pin unconditionally).
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
BASE=/opt/aoin-tracking/baselines/246.json
OUT="deploy/logs/m2-246-repin-$(date +%s).json"

exec "$VENV" "$M2" --origin http://127.0.0.1 --tree /opt/aoin-astro \
  --dictionary "$DICT" --baseline "$BASE" --mode pin --out "$OUT"
