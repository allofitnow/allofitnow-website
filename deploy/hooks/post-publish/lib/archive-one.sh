#!/usr/bin/env bash
# archive-one.sh - copy ONE live object into the per-publish archive, with
# retry (#72 CUT-4). Invoked by prod.sh via `xargs -0 -n 1 -P N` so many
# copies run concurrently. All parameters arrive as argv - nothing is ever
# interpolated into a command string. Exit nonzero = this key failed (prod.sh
# marks the phase partial; idempotent re-run converges).
#
# Usage: archive-one.sh <endpoint> <bucket> <src-prefix> <dest-prefix> <key>
#   (invoked by xargs as: xargs -0 -n1 -P N archive-one.sh EP BKT src/ dest/ <key>)
set -uo pipefail

ENDPOINT="$1"; BUCKET="$2"; SRC_PREFIX="$3"; DEST_PREFIX="$4"; KEY="$5"
ATTEMPTS=3
CLI_OPTS=(--cli-connect-timeout 10 --cli-read-timeout 120)

n=1
while :; do
  if aws --endpoint-url "$ENDPOINT" "${CLI_OPTS[@]}" \
       s3 cp --copy-props none "s3://$BUCKET/${SRC_PREFIX}${KEY}" "s3://$BUCKET/${DEST_PREFIX}${KEY}" >/dev/null 2>&1; then
    exit 0
  fi
  [ "$n" -ge "$ATTEMPTS" ] && exit 1
  backoff=5
  [ "$n" -eq 2 ] && backoff=15
  sleep "$backoff"
  n=$((n + 1))
done
