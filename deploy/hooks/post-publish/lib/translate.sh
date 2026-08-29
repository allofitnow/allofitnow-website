#!/usr/bin/env bash
# Translate stage (pipeline spec sec 10): copy the staging tree to a prod
# tree, rewrite the single staging-base reference class to root-relative
# production paths, enforce a zero-staging-refs grep gate.
# Exit codes: 0 = gate green; 2 = gate red or copy failure. Nothing else.
set -uo pipefail

STAGING=""
PROD=""
GATE_ONLY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --staging-tree) STAGING="${2:-}"; shift 2 ;;
    --prod-tree) PROD="${2:-}"; shift 2 ;;
    --gate-only) GATE_ONLY=1; shift ;;
    *) echo "translate: ignoring unknown arg ${1}" >&2; shift ;;
  esac
done
if [ -z "$STAGING" ] || [ -z "$PROD" ]; then
  echo "translate: --staging-tree and --prod-tree required" >&2
  exit 2
fi
if [ ! -d "$STAGING" ]; then
  echo "translate: staging tree ${STAGING} missing" >&2
  exit 2
fi

PATTERN='http://192\.168\.30\.(245|246)/media/'

if [ "$GATE_ONLY" -eq 0 ]; then
  if ! command -v rsync >/dev/null 2>&1; then
    echo "translate: rsync missing" >&2
    exit 2
  fi
  if ! rsync -a --delete "$STAGING"/ "$PROD"/; then
    echo "translate: rsync copy failed" >&2
    exit 2
  fi
  # Rewrite only files that still match (mtime-preserving on re-runs).
  if command -v grep >/dev/null 2>&1; then
    while IFS= read -r -d '' f; do
      sed -Ei "s#${PATTERN}#/media/#g" "$f"
    done < <(grep -rlEZ "${PATTERN}" "$PROD" --include='*.html' --include='*.css' --include='*.js' --include='*.map' 2>/dev/null)
  fi
fi

# Gate: zero staging refs anywhere in the prod tree. Fatal on any match.
if grep -rEq '192\.168\.30\.(245|246)' "$PROD" 2>/dev/null; then
  echo "translate: GATE RED, staging refs remain in ${PROD}; refusing" >&2
  grep -rEl '192\.168\.30\.(245|246)' "$PROD" 2>/dev/null | head -10 >&2
  exit 2
fi
echo "translate: gate green (${PROD})"
exit 0
