#!/usr/bin/env bash
# promote.sh - #128 E4: promote a soft deploy to the LIVE ROOT (manual gate).
#
# Copies the soft/ namespace (written by prod.sh --soft) into the bucket
# root: the exact bytes reviewed on 46009.someofitlater.com become
# allofitnow.com. COPY-before-overwrite: every existing root key that a
# promote would replace is archived first (archive/<pid>-promote/).
#
# Semantics (parity with a root publish, source = soft manifest):
#   - tree keys (html+assets): archive root key if present, copy soft -> root
#   - media overlay (soft/media/): same treatment
#   - root-prune: keys in the ROOT's previous manifest but absent from the
#     soft manifest are archived then deleted (orphan/tombstone parity),
#     guarded by AOIN_SWEEP_MAX_RATIO (default 0.25) against mass deletes
#   - manifests: soft manifest becomes root manifests/<pid>.json + CURRENT
#
# Guard: .245 host tag AND AOIN_R2_LIVE_ROOT=1 (same key as a root publish —
# one env var gates every write to the live root).
# Exit contract: 0 green; 1 partial (idempotent re-run converges); 2 fatal.
#
# Usage: promote.sh --publish-id <soft-pid> [--dry-run]
set -uo pipefail

BUCKET=46009
PUBLISH_ID=""
DRY_RUN=0
ENDPOINT_OVERRIDE=""

while [ $# -gt 0 ]; do
  case "$1" in
    --publish-id)   PUBLISH_ID="${2:-}"; shift 2 ;;
    --dry-run)      DRY_RUN=1; shift ;;
    --endpoint-url) ENDPOINT_OVERRIDE="${2:-}"; shift 2 ;;
    *) shift ;;
  esac
done

DIR=$(cd "$(dirname "$0")" && pwd)
LIB="$DIR/lib"
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || echo "$DIR/../../..")
LOGDIR="$REPO_ROOT/deploy/logs"
mkdir -p "$LOGDIR"
PY=$(command -v python3 || echo /opt/aoin-hooks-venv/bin/python3)
[ -x "$PY" ] || PY=/opt/aoin-hooks-venv/bin/python3

if [ -z "$PUBLISH_ID" ]; then
  echo "promote: --publish-id <soft-pid> required (see soft/manifests/CURRENT)" >&2
  exit 2
fi

MODE="promote"
[ "$DRY_RUN" -eq 1 ] && MODE="$MODE-dryrun"
LOGJSON="$LOGDIR/promote-$PUBLISH_ID.json"
STARTED=$(date +%s)

fatal() {
  "$PY" - "$LOGJSON" "$PUBLISH_ID" "$MODE" "$STARTED" "$1" <<'PYK'
import json, sys, time
path, pid, mode, started, reason = sys.argv[1:6]
json.dump({"publish_id": pid, "mode": mode, "started": int(started),
           "finished": int(time.time()), "fatal": reason},
          open(path, "w"), indent=1)
PYK
  echo "promote: FATAL $1 (ledger $LOGJSON)" >&2
}

TAG=$(ip -o -4 addr show 2>/dev/null | grep -oE '192\.168\.30\.(245|246)' | head -1 | grep -oE '(245|246)$' || true)
if [ "$DRY_RUN" -ne 1 ]; then
  if [ "$TAG" != "245" ] || [ "${AOIN_R2_LIVE_ROOT:-0}" != "1" ]; then
    echo "promote: reserved for .245 with AOIN_R2_LIVE_ROOT=1 (this is the E4 manual gate); refusing" >&2
    exit 2
  fi
fi

source "$LIB/r2-env.sh" || exit 2
aoin_r2_env_load || { echo "promote: credentials unavailable" >&2; exit 2; }
R2_ENDPOINT="${ENDPOINT_OVERRIDE:-$R2_ENDPOINT}"
EP=(--endpoint-url "$R2_ENDPOINT")
CLI_OPTS=(--cli-connect-timeout 10 --cli-read-timeout 120)

aws_retry() {
  local phase="$1" n=1 rc=0
  local tmo="${AOIN_AWS_ATTEMPT_TIMEOUT:-600}"
  shift
  while [ "$n" -le 3 ]; do
    timeout --foreground "$tmo" aws "${EP[@]}" "${CLI_OPTS[@]}" "$@"
    rc=$?
    [ "$rc" -eq 0 ] && break
    [ "$n" -ge 3 ] && break
    sleep 5
    n=$((n + 1))
  done
  return "$rc"
}

# --- fetch the soft manifest (source of truth for this promotion) -----------
SOFT_MAN="/tmp/promote-soft-$PUBLISH_ID.json"
if ! aws_retry soft-man s3 cp "s3://$BUCKET/soft/manifests/$PUBLISH_ID.json" "$SOFT_MAN" 2>/dev/null; then
  echo "promote: soft manifest soft/manifests/$PUBLISH_ID.json not found" >&2
  fatal "soft-manifest-missing"
  exit 2
fi

# --- fetch the root CURRENT manifest (prev state, for prune + archive) ------
ROOT_PREV_MAN=""
ROOT_PREV_PID=$(aws "${EP[@]}" "${CLI_OPTS[@]}" s3 cp "s3://$BUCKET/manifests/CURRENT" - 2>/dev/null || true)
case "$ROOT_PREV_PID" in
  *[!A-Za-z0-9._-]*) ROOT_PREV_PID="" ;;
esac
if [ -n "$ROOT_PREV_PID" ]; then
  ROOT_PREV_MAN="/tmp/promote-rootprev-$PUBLISH_ID.json"
  aws "${EP[@]}" "${CLI_OPTS[@]}" s3 cp "s3://$BUCKET/manifests/$ROOT_PREV_PID.json" "$ROOT_PREV_MAN" 2>/dev/null || ROOT_PREV_MAN=""
fi

# --- fetch the soft overlay media list (authoritative: what soft holds) ------
OVERLAY_LIST="/tmp/promote-overlay-$PUBLISH_ID.txt"
if ! aws_retry overlay-list s3 cp "s3://$BUCKET/soft/manifests/$PUBLISH_ID-overlay.txt" "$OVERLAY_LIST" 2>/dev/null; then
  echo "promote: soft overlay list soft/manifests/$PUBLISH_ID-overlay.txt not found" >&2
  fatal "overlay-list-missing"
  exit 2
fi

# --- plan: three key lists ---------------------------------------------------
# PLAN format: "<op>\t<key>"  op in {write, media, prune, prunemedia}; write =
# soft tree key, media = overlay media key (soft actually holds it), prune =
# in root prev manifest but absent from the soft manifest.
PLAN="/tmp/promote-plan-$PUBLISH_ID.txt"
"$PY" - "$SOFT_MAN" "${ROOT_PREV_MAN:-}" "$OVERLAY_LIST" "$PLAN" <<'PYK'
import json, sys
soft = json.load(open(sys.argv[1]))
prevp = sys.argv[2]
overlay = {l.strip() for l in open(sys.argv[3]) if l.strip()}
soft_tree = {k["key"] for k in soft["keys"]}
soft_media = set(soft["media_keys"])
prev_tree, prev_media = set(), set()
if prevp:
    prev = json.load(open(prevp))
    prev_tree = {k["key"] for k in prev["keys"]}
    prev_media = set(prev["media_keys"])
with open(sys.argv[4], "w") as f:
    for k in sorted(soft_tree):
        f.write("write\t%s\n" % k)
    for k in sorted(overlay & soft_media):
        f.write("media\t%s\n" % k)
    for k in sorted((prev_tree - soft_tree)):
        f.write("prune\t%s\n" % k)
    for k in sorted((prev_media - soft_media)):
        f.write("prunemedia\t%s\n" % k)
PYK

root_has() {
  aws "${EP[@]}" s3api head-object --bucket "$BUCKET" --key "$1" >/dev/null 2>&1
}
soft_has() {
  aws "${EP[@]}" s3api head-object --bucket "$BUCKET" --key "soft/$1" >/dev/null 2>&1
}

# --- ratio guard on prunes (same doctrine as the sweep) ----------------------
SWEEP_RATIO="${AOIN_SWEEP_MAX_RATIO:-0.25}"
GUARD=$("$PY" - "$PLAN" "$SWEEP_RATIO" <<'PYK'
import sys
prune = sum(1 for l in open(sys.argv[1]) if l.startswith("prune"))
total = sum(1 for l in open(sys.argv[1]) if l.strip())
ratio = float(sys.argv[2])
print("RED" if total and prune > ratio * total else "OK")
PYK
)
if [ "$GUARD" = "RED" ]; then
  PRUNE_N=$(grep -c $'prune' "$PLAN" || true)
  TOTAL_N=$(wc -l <"$PLAN")
  echo "promote: prune guard RED: $PRUNE_N prunes > ratio $SWEEP_RATIO of $TOTAL_N - refusing; inspect $PLAN" >&2
  fatal "prune-guard-red"
  exit 2
fi

ARCH_DEST="archive/$PUBLISH_ID-promote/"
W_N=0; P_N=0; M_N=0; ERR=0
while IFS=$'\t' read -r op k; do
  [ -n "$op" ] && [ -n "$k" ] || continue
  case "$op" in
    write)
      if [ "$DRY_RUN" -eq 1 ]; then echo "promote: [dryrun] write $k"; continue; fi
      # archive existing root key first (COPY-before-overwrite)
      if root_has "$k"; then
        aws_retry arch s3api copy-object --bucket "$BUCKET" \
          --key "${ARCH_DEST}${k}" --copy-source "$BUCKET/$k" || { ERR=1; continue; }
      fi
      aws_retry promote s3api copy-object --bucket "$BUCKET" \
        --key "$k" --copy-source "$BUCKET/soft/$k" || { ERR=1; continue; }
      W_N=$((W_N + 1)) ;;
    media)
      # overlay candidate: only copy keys soft actually holds
      if [ "$DRY_RUN" -eq 1 ]; then echo "promote: [dryrun] media? $k"; continue; fi
      if soft_has "media/$k"; then
        if root_has "media/$k"; then
          aws_retry archm s3api copy-object --bucket "$BUCKET" \
            --key "${ARCH_DEST}media/$k" --copy-source "$BUCKET/media/$k" || { ERR=1; continue; }
        fi
        aws_retry promotem s3api copy-object --bucket "$BUCKET" \
          --key "media/$k" --copy-source "$BUCKET/soft/media/$k" || { ERR=1; continue; }
        M_N=$((M_N + 1))
      fi ;;
    prune)
      if [ "$DRY_RUN" -eq 1 ]; then echo "promote: [dryrun] prune $k"; continue; fi
      if root_has "$k"; then
        aws_retry archp s3api copy-object --bucket "$BUCKET" \
          --key "${ARCH_DEST}${k}" --copy-source "$BUCKET/$k" \
          && aws_retry prunerm s3api delete-object --bucket "$BUCKET" --key "$k" || ERR=1
      fi
      P_N=$((P_N + 1)) ;;
    prunemedia)
      if [ "$DRY_RUN" -eq 1 ]; then echo "promote: [dryrun] prune media/$k"; continue; fi
      if root_has "media/$k"; then
        aws_retry archpm s3api copy-object --bucket "$BUCKET" \
          --key "${ARCH_DEST}media/$k" --copy-source "$BUCKET/media/$k" \
          && aws_retry pruneprmm s3api delete-object --bucket "$BUCKET" --key "media/$k" || ERR=1
      fi
      P_N=$((P_N + 1)) ;;
  esac
done <"$PLAN"

# --- manifests: soft manifest becomes root state -----------------------------
if [ "$DRY_RUN" -ne 1 ]; then
  aws_retry man-put s3 cp "$SOFT_MAN" "s3://$BUCKET/manifests/$PUBLISH_ID.json" || ERR=1
  printf '%s' "$PUBLISH_ID" >"/tmp/promote-CURRENT-$PUBLISH_ID"
  aws_retry cur-put s3 cp "/tmp/promote-CURRENT-$PUBLISH_ID" "s3://$BUCKET/manifests/CURRENT" || ERR=1
fi

FINISHED=$(date +%s)
"$PY" - "$LOGJSON" "$PUBLISH_ID" "$MODE" "$STARTED" "$FINISHED" "$W_N" "$M_N" "$P_N" "$ERR" <<'PYK'
import json, sys
path, pid, mode, started, finished = sys.argv[1:6]
w, m, p, err = map(int, sys.argv[6:10])
json.dump({"publish_id": pid, "mode": mode,
           "started": int(started), "finished": int(finished),
           "elapsed": int(finished) - int(started),
           "writes_tree": w, "writes_media": m, "prunes": p, "phase_errors": err},
          open(path, "w"), indent=1)
PYK

echo "promote: done writes=$W_N media=$M_N prunes=$P_N errors=$ERR (ledger $LOGJSON)"
[ "$ERR" -ne 0 ] && exit 1
exit 0
