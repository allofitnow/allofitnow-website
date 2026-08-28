#!/usr/bin/env bash
# prod.sh - Tier-3 prod sync target (#49): ordered media -> assets -> html ->
# verify sync of the translated build tree to R2 bucket 46009.
#
# HARD RULES (wiki secs 11-13, issue #49):
#   - `aws s3 sync --delete` is FORBIDDEN. Deletion is only ever explicit,
#     manifest-derived, archived COPY-then-DELETE (tombstone path).
#   - html/assets sync is additive-only (no deletes) and SELF-ARCHIVES every
#     written object to archive/<publish-id>/ (B1 verdict: the archive prefix
#     is a complete restorable image of exactly that publish).
#   - Phase order media -> assets -> html -> verify is never reordered:
#     HTML must never reference objects missing from the bucket.
#   - First live-root sync is USER-GATED: live-root mode additionally requires
#     host tag .245 AND AOIN_R2_LIVE_ROOT=1. Rehearsals use --prefix.
#
# Modes:
#   default                     live root (guarded, see above)
#   --prefix tmp-<epoch>/       rehearsal against a scratch prefix (any host)
#   --dry-run                   mutates nothing: syncs print plans, manifest /
#                               tombstone / archive writes are skipped, verify
#                               reports mismatches without failing
# Env overrides: AOIN_PROD_MANIFEST_OVERRIDE (use this manifest instead of
# building one; used by the reconciliation-mismatch rehearsal).
# Exit contract: 0 all green + manifest written; 1 partial (phase failed after
# retries OR reconciliation mismatch; idempotent re-run converges); 2 fatal
# (auth/endpoint/translate-gate-red, detected in preflight before any write).
set -uo pipefail

BUILD_TREE=/opt/aoin-astro-prod
PUBLISH_ID=""
PREFIX=""
DRY_RUN=0
MEDIA_SRC=/root/projects/allofitnow-website/backend/media
BUCKET=46009
ATTEMPTS=3
ENDPOINT_OVERRIDE=""

while [ $# -gt 0 ]; do
  case "$1" in
    --build-tree)     BUILD_TREE="${2:-}"; shift 2 ;;
    --publish-id)     PUBLISH_ID="${2:-}"; shift 2 ;;
    --media-src)      MEDIA_SRC="${2:-}"; shift 2 ;;
    --prefix)         PREFIX="${2:-}"; shift 2 ;;
    --dry-run)        DRY_RUN=1; shift ;;
    --endpoint-url)   ENDPOINT_OVERRIDE="${2:-}"; shift 2 ;;
    *) shift ;;
  esac
done

DIR=$(cd "$(dirname "$0")" && pwd)
LIB="$DIR/../lib"
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || echo "$DIR/../../..")
LOGDIR="$REPO_ROOT/deploy/logs"
mkdir -p "$LOGDIR"
PY=$(command -v python3 || echo /opt/aoin-hooks-venv/bin/python3)
[ -x "$PY" ] || PY=/opt/aoin-hooks-venv/bin/python3
STARTED=$(date +%s)
PUBLISH_ID="${PUBLISH_ID:-manual-$(date +%s)}"
MODE="live-root"
[ -n "$PREFIX" ] && MODE="rehearsal"
[ "$DRY_RUN" -eq 1 ] && MODE="$MODE-dryrun"
LOGJSON="$LOGDIR/prod-$PUBLISH_ID.json"
PHASES_JSON="[]"

fatal() {  # fatal <reason> <attempts> : ledger even on the fatal path (AC3)
  "$PY" - "$LOGJSON" "$PUBLISH_ID" "$MODE" "$PREFIX" "$STARTED" "$1" "$2" <<'PYK'
import json, sys, time
path, pid, mode, prefix, started, reason, att = sys.argv[1:8]
json.dump({"publish_id": pid, "mode": mode, "prefix": prefix,
           "started": int(started), "finished": int(time.time()),
           "fatal": reason, "attempts": int(att)}, open(path, "w"), indent=1)
PYK
  echo "prod: FATAL $1 (ledger $LOGJSON)" >&2
}

note_phase() {  # note_phase <name> <rc> <attempts>
  PHASES_JSON=$("$PY" -c 'import json,sys; p=json.loads(sys.argv[1]); p.append({"name":sys.argv[2],"exit":int(sys.argv[3]),"attempts":int(sys.argv[4])}); print(json.dumps(p))' "$PHASES_JSON" "$1" "$2" "$3")
}

# --- host / gate guard (live root only; rehearsals and dry-runs pass) -------
TAG=$(ip -o -4 addr show 2>/dev/null | grep -oE '192\.168\.30\.(245|246)' | head -1 | grep -oE '(245|246)$' || true)
if [ -z "$PREFIX" ] && [ "$DRY_RUN" -ne 1 ]; then
  if [ "$TAG" != "245" ] || [ "${AOIN_R2_LIVE_ROOT:-0}" != "1" ]; then
    echo "prod: live-root mode is reserved for .245 with AOIN_R2_LIVE_ROOT=1 (first live-root sync stays user-gated); skipping"
    exit 0
  fi
fi

# --- credentials (never sourced; parsed by lib/r2-env.sh) -------------------
# shellcheck source=/dev/null
source "$LIB/r2-env.sh" || exit 2
aoin_r2_env_load || { echo "prod: credentials unavailable (r2-env rc=2)" >&2; exit 2; }
R2_ENDPOINT="${ENDPOINT_OVERRIDE:-$R2_ENDPOINT}"
EP=(--endpoint-url "$R2_ENDPOINT")
CLI_OPTS=(--cli-connect-timeout 10 --cli-read-timeout 120)

ATTEMPT_SEEN=0
aws_retry() {  # aws_retry <phase> <args...>
  local phase="$1" n=1 rc=0
  shift
  while [ "$n" -le "$ATTEMPTS" ]; do
    ATTEMPT_SEEN=$n
    if aws "${EP[@]}" "${CLI_OPTS[@]}" "$@"; then rc=0; break; fi
    rc=$?
    if [ "$n" -ge "$ATTEMPTS" ]; then break; fi
    local backoff=5
    [ "$n" -eq 2 ] && backoff=15
    echo "prod: $phase attempt $n/$ATTEMPTS failed (rc=$rc), retry in ${backoff}s" >&2
    sleep "$backoff"
    n=$((n + 1))
  done
  return "$rc"
}

# --- preflight: everything that can fail FATAL (exit 2) before any write ----
if [ ! -d "$BUILD_TREE" ]; then
  echo "prod: build tree missing: $BUILD_TREE" >&2
  fatal "build-tree-missing" 0
  exit 2
fi
GATE_LOG="$LOGDIR/translate-gate-$PUBLISH_ID.log"
"$LIB/translate.sh" --build-tree "$BUILD_TREE" --gate-only >"$GATE_LOG" 2>&1
GRC=$?
if [ "$GRC" -ne 0 ]; then
  echo "prod: translate gate red (exit $GRC, see $GATE_LOG); bucket untouched" >&2
  fatal "translate-gate-red" 0
  exit 2
fi
if ! aws_retry preflight s3api head-bucket --bucket "$BUCKET"; then
  echo "prod: endpoint/auth unreachable (head-bucket failed after $ATTEMPT_SEEN attempts); bucket untouched" >&2
  fatal "endpoint-or-auth-unreachable" "$ATTEMPT_SEEN"
  exit 2
fi

# --- manifests ---------------------------------------------------------------
LOCAL_MAN="${AOIN_PROD_MANIFEST_OVERRIDE:-}"
if [ -z "$LOCAL_MAN" ] || [ ! -f "$LOCAL_MAN" ]; then
  LOCAL_MAN="$LOGDIR/manifest-$PUBLISH_ID.json"
  BUILD_COMMIT=$(git -C /root/projects/allofitnow-website rev-parse --short HEAD 2>/dev/null || echo unknown)
  "$PY" "$LIB/manifest.py" build --tree "$BUILD_TREE" --media-src "$MEDIA_SRC" \
    --publish-id "$PUBLISH_ID" --build-commit "$BUILD_COMMIT" --out "$LOCAL_MAN" || { fatal "manifest-build-failed" 0; exit 2; }
fi

PREV_PID=$(aws "${EP[@]}" "${CLI_OPTS[@]}" s3 cp "s3://$BUCKET/${PREFIX}manifests/CURRENT" - 2>/dev/null || true)
case "$PREV_PID" in
  *[!A-Za-z0-9._-]*) PREV_PID="" ;;
esac
PREV_MAN=""
if [ -n "$PREV_PID" ]; then
  PREV_MAN="/tmp/prod-prev-$PUBLISH_ID.json"
  aws "${EP[@]}" "${CLI_OPTS[@]}" s3 cp "s3://$BUCKET/${PREFIX}manifests/$PREV_PID.json" "$PREV_MAN" 2>/dev/null || PREV_MAN=""
fi

# key lists (newline-safe: consumers must read with IFS= read -r)
written_keys() {  # written_keys <tree|media> : new or changed vs previous manifest
  "$PY" - "$LOCAL_MAN" "${PREV_MAN:-}" "$1" <<'PYK'
import json, sys
new = json.load(open(sys.argv[1]))
prevp = sys.argv[2]
prev = json.load(open(prevp)) if prevp else None
if sys.argv[3] == "media":
    newk = {k: None for k in new["media_keys"]}
    prevk = {k: None for k in prev["media_keys"]} if prev else {}
else:
    newk = {k["key"]: [k["size"], k["etag"]] for k in new["keys"]}
    prevk = {k["key"]: [k["size"], k["etag"]] for k in prev["keys"]} if prev else {}
for k in sorted(newk):
    if k not in prevk or (newk[k] and prevk[k] and newk[k] != prevk[k]):
        print(k)
PYK
}

tombstone_keys() {  # in previous media manifest but gone from the source manifest
  "$PY" - "$LOCAL_MAN" "${PREV_MAN:-}" <<'PYK'
import json, sys
new = json.load(open(sys.argv[1]))
prevp = sys.argv[2]
prev = json.load(open(prevp)) if prevp else None
if not prev:
    sys.exit(0)
for k in sorted(set(prev["media_keys"]) - set(new["media_keys"])):
    print(k)
PYK
}

live_has() {  # live_has <key> : exit 0 when the object exists under the prefix
  aws "${EP[@]}" s3api head-object --bucket "$BUCKET" --key "${PREFIX}$1" >/dev/null 2>&1
}

# --- phase 1: media (--size-only sync; replaced pre-delete COPY; tombstones)
echo "phase: media"
MEDIA_RC=0
TOMB_N=0
if [ -d "$MEDIA_SRC" ]; then
  if [ "$DRY_RUN" -ne 1 ] && [ -n "$PREV_MAN" ]; then
    while IFS= read -r k; do
      [ -n "$k" ] || continue
      if live_has "media/$k"; then
        aws_retry archive cp s3 cp "s3://$BUCKET/${PREFIX}media/$k" "s3://$BUCKET/${PREFIX}archive/$PUBLISH_ID/media/$k" || MEDIA_RC=1
      fi
    done < <(written_keys media)
  fi
  DRYFLAG=()
  [ "$DRY_RUN" -eq 1 ] && DRYFLAG=(--dryrun)
  aws_retry media s3 sync "$MEDIA_SRC" "s3://$BUCKET/${PREFIX}media/" --size-only "${DRYFLAG[@]}" || MEDIA_RC=1
  while IFS= read -r k; do
    [ -n "$k" ] || continue
    if [ "$DRY_RUN" -eq 1 ]; then
      echo "prod: [dryrun] tombstone media/$k -> archive/$PUBLISH_ID/media/$k"
    elif live_has "media/$k"; then
      aws_retry tombstone cp s3 cp "s3://$BUCKET/${PREFIX}media/$k" "s3://$BUCKET/${PREFIX}archive/$PUBLISH_ID/media/$k" \
        && aws_retry tombstone rm s3api delete-object --bucket "$BUCKET" --key "${PREFIX}media/$k" || MEDIA_RC=1
    fi
    TOMB_N=$((TOMB_N + 1))
  done < <(tombstone_keys)
  echo "phase: media done rc=$MEDIA_RC tombstones=$TOMB_N"
else
  echo "prod: media source missing: $MEDIA_SRC (skipping media sync)" >&2
fi
note_phase media "$MEDIA_RC" "$ATTEMPTS"

# --- phase 2: assets (non-html tree; additive-only; self-archive) -----------
echo "phase: assets"
ASSET_RC=0
DRYFLAG=()
[ "$DRY_RUN" -eq 1 ] && DRYFLAG=(--dryrun)
aws_retry assets s3 sync "$BUILD_TREE" "s3://$BUCKET/${PREFIX}" --exclude "*.html" "${DRYFLAG[@]}" || ASSET_RC=1
if [ "$DRY_RUN" -ne 1 ]; then
  while IFS= read -r k; do
    [ -n "$k" ] || continue
    case "$k" in
      *.html) continue ;;
    esac
    aws_retry archive cp s3 cp "s3://$BUCKET/${PREFIX}$k" "s3://$BUCKET/${PREFIX}archive/$PUBLISH_ID/$k" || ASSET_RC=1
  done < <(written_keys tree)
fi
echo "phase: assets done rc=$ASSET_RC"
note_phase assets "$ASSET_RC" "$ATTEMPTS"

# --- phase 3: html (last writes; then manifest + CURRENT pointer) -----------
echo "phase: html"
HTML_RC=0
aws_retry html s3 sync "$BUILD_TREE" "s3://$BUCKET/${PREFIX}" --exclude "*" --include "*.html" "${DRYFLAG[@]}" || HTML_RC=1
if [ "$DRY_RUN" -ne 1 ]; then
  while IFS= read -r k; do
    [ -n "$k" ] || continue
    case "$k" in
      *.html) aws_retry archive cp s3 cp "s3://$BUCKET/${PREFIX}$k" "s3://$BUCKET/${PREFIX}archive/$PUBLISH_ID/$k" || HTML_RC=1 ;;
    esac
  done < <(written_keys tree)
  aws_retry manifest s3 cp "$LOCAL_MAN" "s3://$BUCKET/${PREFIX}manifests/$PUBLISH_ID.json" || HTML_RC=1
  printf '%s' "$PUBLISH_ID" >"/tmp/prod-CURRENT-$PUBLISH_ID"
  aws_retry current s3 cp "/tmp/prod-CURRENT-$PUBLISH_ID" "s3://$BUCKET/${PREFIX}manifests/CURRENT" || HTML_RC=1
fi
echo "phase: html done rc=$HTML_RC (manifest=$PUBLISH_ID)"
note_phase html "$HTML_RC" "$ATTEMPTS"

# --- phase 4: verify (reconciliation: manifest vs bucket) --------------------
echo "phase: verify"
VERIFY_RC=0
BUCKET_LIST="/tmp/prod-bucketlist-$PUBLISH_ID.txt"
aws_retry verify s3 ls "s3://$BUCKET/${PREFIX}" --recursive >"$BUCKET_LIST" || VERIFY_RC=1
if [ "$VERIFY_RC" -eq 0 ]; then
  "$PY" "$LIB/manifest.py" verify --manifest "$LOCAL_MAN" --bucket-list "$BUCKET_LIST"
  VRC=$?
  if [ "$VRC" -ne 0 ]; then
    if [ "$DRY_RUN" -eq 1 ]; then
      echo "phase: verify would-mismatch (dry-run: reporting only)"
    else
      VERIFY_RC=1
    fi
  fi
else
  echo "phase: verify listing failed"
fi
echo "phase: verify done rc=$VERIFY_RC"
note_phase verify "$VERIFY_RC" "$ATTEMPTS"

# --- ledger + exit contract --------------------------------------------------
FINISHED=$(date +%s)
"$PY" - "$LOGJSON" "$PUBLISH_ID" "$MODE" "$PREFIX" "$STARTED" "$FINISHED" "$PHASES_JSON" "$LOCAL_MAN" <<'PYK'
import json, sys
path, pid, mode, prefix, started, finished, phases, man = sys.argv[1:9]
json.dump({
    "publish_id": pid, "mode": mode, "prefix": prefix,
    "started": int(started), "finished": int(finished),
    "elapsed": int(finished) - int(started),
    "phases": json.loads(phases), "manifest": man,
}, open(path, "w"), indent=1)
print("prod: ledger %s" % path)
PYK

RC=0
for rc in "$MEDIA_RC" "$ASSET_RC" "$HTML_RC" "$VERIFY_RC"; do
  [ "$rc" -ne 0 ] && RC=1
done
true

if [ "$DRY_RUN" -ne 1 ] && [ "$RC" -ne 0 ]; then
  COUNTER="$LOGDIR/prod-fail-$MODE.count"
  N=$(cat "$COUNTER" 2>/dev/null || echo 0)
  N=$((N + 1))
  printf '%s' "$N" >"$COUNTER"
  echo "prod: failure $N consecutive in mode $MODE" >&2
  if [ "$N" -ge 2 ]; then
    echo "prod: ALERT threshold reached (2 consecutive same-mode failures) - telegram escalation due" >&2
  fi
  if [ -f /etc/aoin-gitlab-token ]; then
    echo "prod: gitlab note (best effort) would fire here" >&2
  fi
elif [ "$DRY_RUN" -ne 1 ]; then
  rm -f "$LOGDIR/prod-fail-$MODE.count"
fi

exit "$RC"
