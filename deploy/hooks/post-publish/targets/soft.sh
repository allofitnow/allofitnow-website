#!/usr/bin/env bash
# soft.sh - #128 E3: automatic soft-launch deploy (post-publish target).
#
# Runs prod.sh --soft AFTER the staging build lands on .245. The soft
# namespace (bucket 46009, key prefix soft/) is served ONLY by the worker
# overlay on 46009.someofitlater.com — the live root is untouched, so this
# runs on EVERY staging publish without any env gate.
#
# Detached: the media-overlay diff can upload large designer files; the
# fan-out's AOIN_TARGET_TIMEOUT (default 300s) must not kill it mid-upload.
# prod.sh is idempotent, so a detached run that dies is safely re-run by the
# next publish. Log: deploy/logs/soft-<publish-id>.log (logtail in ledger).
set -uo pipefail

PUBLISH_ID=""
while [ $# -gt 0 ]; do
  case "$1" in
    --publish-id) PUBLISH_ID="${2:-}"; shift 2 ;;
    --build-tree) shift 2 ;;  # accepted for fan-out uniformity; prod.sh uses /opt/aoin-astro
    *) shift ;;
  esac
done
[ -n "$PUBLISH_ID" ] || { echo "soft: --publish-id required" >&2; exit 0; }

DIR=$(cd "$(dirname "$0")" && pwd)
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || echo "$DIR/../../..")
LOGDIR="$REPO_ROOT/deploy/logs"
mkdir -p "$LOGDIR"
LOG="$LOGDIR/soft-$PUBLISH_ID.log"

# never two soft publishes of the same tree; prod.sh --soft is idempotent
if pgrep -f "[p]rod.sh.*--soft" >/dev/null 2>&1; then
  echo "soft: another soft publish is running; skipping (next publish re-runs)" >&2
  exit 0
fi

# detached, fully survived (setsid: nohup + immune to fan-out timeout kill)
setsid nohup bash "$DIR/targets/prod.sh" --soft --publish-id "soft-$PUBLISH_ID" \
  >>"$LOG" 2>&1 < /dev/null &
echo "soft: detached soft publish started (pid $!, log $LOG)"
exit 0
