#!/usr/bin/env bash
# archive-one.sh - copy ONE live object into the per-publish archive, with
# retry (#72 CUT-4). Invoked by prod.sh via `xargs -0 -n 1 -P N` so many
# copies run concurrently. All parameters arrive as argv - nothing is ever
# interpolated into a command string. Exit nonzero = this key failed (prod.sh
# marks the phase partial; idempotent re-run converges).
#
# Usage: archive-one.sh <endpoint> <bucket> <src-prefix> <dest-prefix> <key>
#   (invoked by xargs as: xargs -0 -n1 -P N archive-one.sh EP BKT src/ dest/ <key>)
#
# #107: s3 cp --copy-props none (cdeb179, #80) makes aws-cli 2.x send
# x-amz-tagging-directive: REPLACE on single-part copies, which R2 rejects
# with NotImplemented -> every small-file archive copy failed silently
# (phase rc=1) since cf11cec. s3api copy-object sends no tagging directive
# by default and works for BOTH single-part and >8MB multipart (verified
# 2026-09-02: work/trilogy/index.html + 54MB media copy, rc=0 both).
# URL-encoding: keys are slug-ASCII + dots/dashes only (built tree), so
# --copy-source needs no percent-encoding.
set -uo pipefail

ENDPOINT="$1"; BUCKET="$2"; SRC_PREFIX="$3"; DEST_PREFIX="$4"; KEY="$5"
ATTEMPTS=3
CLI_OPTS=(--cli-connect-timeout 10 --cli-read-timeout 120)

n=1
while :; do
  if aws --endpoint-url "$ENDPOINT" "${CLI_OPTS[@]}" \
       s3api copy-object --bucket "$BUCKET" \
       --key "${DEST_PREFIX}${KEY}" \
       --copy-source "${BUCKET}/${SRC_PREFIX}${KEY}" >/dev/null 2>&1; then
    exit 0
  fi
  [ "$n" -ge "$ATTEMPTS" ] && exit 1
  backoff=5
  [ "$n" -eq 2 ] && backoff=15
  sleep "$backoff"
  n=$((n + 1))
done
