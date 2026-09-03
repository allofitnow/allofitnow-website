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

STAGING_TREE=/opt/aoin-astro
PROD_TREE=/opt/aoin-astro-prod
PUBLISH_ID=""
PREFIX=""
SOFT=0
DRY_RUN=0
MEDIA_SRC=/root/projects/allofitnow-website/backend/media
BUCKET=46009
ATTEMPTS=3
ENDPOINT_OVERRIDE=""

while [ $# -gt 0 ]; do
  case "$1" in
    --build-tree)     STAGING_TREE="${2:-}"; shift 2 ;;
    --prod-tree)      PROD_TREE="${2:-}"; shift 2 ;;
    --publish-id)     PUBLISH_ID="${2:-}"; shift 2 ;;
    --media-src)      MEDIA_SRC="${2:-}"; shift 2 ;;
    --prefix)         PREFIX="${2:-}"; shift 2 ;;
    --soft)           SOFT=1; PREFIX="soft/"; shift ;;
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
[ "$SOFT" -eq 1 ] && MODE="soft"
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

note_phase() {  # note_phase <name> <rc> <attempts> [duration_s]
  PHASES_JSON=$("$PY" -c 'import json,sys; p=json.loads(sys.argv[1]); p.append({"name":sys.argv[2],"exit":int(sys.argv[3]),"attempts":int(sys.argv[4]),"duration":int(sys.argv[5] or 0)}); print(json.dumps(p))' "$PHASES_JSON" "$1" "$2" "$3" "${4:-0}")
}

# --- host / gate guard (live root only; rehearsals and dry-runs pass) -------
TAG=$(ip -o -4 addr show 2>/dev/null | grep -oE '192\.168\.30\.(245|246)' | head -1 | grep -oE '(245|246)$' || true)
# --soft (#128): .245-only. NOT gated by AOIN_R2_LIVE_ROOT — the soft
# namespace is additive and live-root bytes are never touched (media phase
# below is new-key-only). Promotion to the live root stays E4-gated.
if [ "$SOFT" -eq 1 ]; then
  if [ "$DRY_RUN" -ne 1 ] && { [ "$TAG" != "245" ] || [ -n "${AOIN_R2_LIVE_ROOT:-}" ]; }; then
    echo "prod: soft mode is reserved for .245 (AOIN_R2_LIVE_ROOT must be unset; soft is additive-only); skipping" >&2
    exit 0
  fi
fi
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

aws_retry() {  # aws_retry <phase> <args...>
  local phase="$1" n=1 rc=0
  # #107: R2 html-sync PUTs can stall forever (two consecutive cf11cec runs
  # died at the same final PUT, exit 124, at BOTH 300s and 1800s budgets).
  # Without a per-attempt bound the outer target timeout is the only killer
  # and aws_retry never gets an rc to act on. sync/cp PUTs are idempotent,
  # so a timed-out attempt is safe to backoff-and-retry. Budgets scale with
  # payload: html sync ~1.4 MiB (+/- per-layout churn), asset sync larger,
  # ls/listings can list the whole bucket tree. Default 600s per attempt.
  local perattempt="${AOIN_AWS_ATTEMPT_TIMEOUT:-600}"
  # listing/verify phases pass through unchanged unless explicitly raised
  local tmo="$perattempt"
  case "$phase" in
    assets|html) tmo="${AOIN_SYNC_ATTEMPT_TIMEOUT:-$(( perattempt * 2 ))}" ;;
  esac
  shift
  while [ "$n" -le "$ATTEMPTS" ]; do
    timeout --foreground "$tmo" aws "${EP[@]}" "${CLI_OPTS[@]}" "$@"
    rc=$?
    # 124/137 = attempt killed by our timeout (stalled transfer), not aws's
    # own rc; treat as retryable. Actual aws errors also retry via loop.
    if [ "$rc" -eq 0 ]; then break; fi
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
if [ ! -d "$STAGING_TREE" ]; then
  echo "prod: staging tree missing: $STAGING_TREE" >&2
  fatal "staging-tree-missing" 0
  exit 2
fi
GATE_LOG="$LOGDIR/translate-$PUBLISH_ID.log"
"$LIB/translate.sh" --staging-tree "$STAGING_TREE" --prod-tree "$PROD_TREE" >"$GATE_LOG" 2>&1
GRC=$?
if [ "$GRC" -ne 0 ]; then
  echo "prod: translate failed or gate red (exit $GRC, see $GATE_LOG); bucket untouched" >&2
  fatal "translate-gate-red" 0
  exit 2
fi

# --- URL normalization (#69) ---------------------------------------------------
# Same-domain http:// -> https:// in the translated tree BEFORE the manifest is
# built (so the manifest captures post-rewrite URLs). Lint pass: never blocks.
"$PY" "$LIB/normalize_urls.py" --tree "$PROD_TREE" >>"$GATE_LOG" 2>&1 || true

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
  "$PY" "$LIB/manifest.py" build --tree "$PROD_TREE" --media-src "$MEDIA_SRC" \
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
PHASE_START=$(date +%s)
if [ -d "$MEDIA_SRC" ]; then
  if [ "$SOFT" -eq 1 ]; then
    # #128 soft: media OVERLAY. Compare src vs the ROOT media set (names+
    # sizes from one listing); upload ONLY new-or-resized keys into
    # soft/media/. Root bytes are never written by a soft publish; the
    # worker overlay serves soft/media/<k> ahead of root on 46009 only.
    # Same-size-replaced bytes are invisible until E4 (same compromise as
    # the root sync's --size-only).
    ROOT_MEDIA_LIST="/tmp/prod-rootmedia-$PUBLISH_ID.txt"
    : >"$ROOT_MEDIA_LIST"
    aws_retry rootmedia-ls s3 ls "s3://$BUCKET/media/" --recursive >>"$ROOT_MEDIA_LIST" || MEDIA_RC=1
    OVERLAY_MAN="/tmp/prod-overlay-$PUBLISH_ID.txt"
    : >"$OVERLAY_MAN"
    if [ "$MEDIA_RC" -eq 0 ]; then
      "$PY" - "$MEDIA_SRC" "$ROOT_MEDIA_LIST" "$OVERLAY_MAN" <<'PYK'
import os, sys
src, listfile, out = sys.argv[1:4]
root = {}
for line in open(listfile):
    parts = line.split(None, 3)
    if len(parts) >= 4 and parts[3].startswith("media/"):
        root[parts[3][len("media/"):].rstrip("\n")] = int(parts[2])
for rel, _dirs, files in os.walk(src):
    for f in files:
        full = os.path.join(rel, f)
        k = os.path.relpath(full, src)
        if k not in root or root[k] != os.path.getsize(full):
            print(k)
PYK
      SOFT_MEDIA_N=0
      while IFS= read -r k; do
        [ -n "$k" ] || continue
        if [ "$DRY_RUN" -eq 1 ]; then
          echo "prod: [dryrun] soft media soft/media/$k"
        else
          aws_retry media-soft s3 cp "$MEDIA_SRC/$k" "s3://$BUCKET/${PREFIX}media/$k" || MEDIA_RC=1
        fi
        SOFT_MEDIA_N=$((SOFT_MEDIA_N + 1))
      done <"$OVERLAY_MAN"
      # overlay list: consumed by promote.sh (media plan input) + soft verify
      if [ "$DRY_RUN" -ne 1 ]; then
        aws_retry overlay-put s3 cp "$OVERLAY_MAN" "s3://$BUCKET/${PREFIX}manifests/$PUBLISH_ID-overlay.txt" || MEDIA_RC=1
      fi
      echo "phase: media(soft) done rc=$MEDIA_RC overlay=$SOFT_MEDIA_N root=$(grep -c ' media/' "$ROOT_MEDIA_LIST" || true)"
    else
      echo "prod: root media listing failed; overlay upload skipped" >&2
    fi
  elif [ "$DRY_RUN" -ne 1 ] && [ -n "$PREV_MAN" ]; then
    # #72: concurrent pre-archive via xargs -P (helper takes argv only).
    # if-wrap: with pipefail, a bare `live_has && printf` makes the while loop
    # exit 1 whenever the last key is not live -> false phase failure.
    written_keys media | while IFS= read -r k; do
      if [ -n "$k" ] && live_has "media/$k"; then
        printf '%s\0' "$k" || :
      fi
    done | xargs -0 -r -n 1 -P "${AOIN_ARCHIVE_PARALLEL:-8}" \
      "$LIB/archive-one.sh" "$R2_ENDPOINT" "$BUCKET" \
      "${PREFIX}media/" "${PREFIX}archive/$PUBLISH_ID/media/" || MEDIA_RC=1
  fi
  if [ "$SOFT" -ne 1 ]; then
    DRYFLAG=()
    [ "$DRY_RUN" -eq 1 ] && DRYFLAG=(--dryrun)
    aws_retry media s3 sync "$MEDIA_SRC" "s3://$BUCKET/${PREFIX}media/" --size-only "${DRYFLAG[@]}" || MEDIA_RC=1
    while IFS= read -r k; do
      [ -n "$k" ] || continue
      if [ "$DRY_RUN" -eq 1 ]; then
        echo "prod: [dryrun] tombstone media/$k -> archive/$PUBLISH_ID/media/$k"
      elif live_has "media/$k"; then
        # #107: s3 cp s3://->s3:// sends a tagging directive R2 rejects with
        # NotImplemented (same class archive-one.sh hit); s3api copy-object
        # carries no tagging directive and is verified on R2 (live 2026-09-03).
        aws_retry tombstone-copy s3api copy-object --bucket "$BUCKET" \
          --key "${PREFIX}archive/$PUBLISH_ID/media/$k" \
          --copy-source "$BUCKET/${PREFIX}media/$k" \
          && aws_retry tombstone-rm s3api delete-object --bucket "$BUCKET" --key "${PREFIX}media/$k" || MEDIA_RC=1
      fi
      TOMB_N=$((TOMB_N + 1))
    done < <(tombstone_keys)
    echo "phase: media done rc=$MEDIA_RC tombstones=$TOMB_N"
  fi
else
  echo "prod: media source missing: $MEDIA_SRC (skipping media sync)" >&2
fi
note_phase media "$MEDIA_RC" "$ATTEMPTS" "$(( $(date +%s) - PHASE_START ))"

# --- phase 2: assets (non-html tree; additive-only; self-archive) -----------
echo "phase: assets"
ASSET_RC=0
PHASE_START=$(date +%s)
DRYFLAG=()
[ "$DRY_RUN" -eq 1 ] && DRYFLAG=(--dryrun)
aws_retry assets s3 sync "$PROD_TREE" "s3://$BUCKET/${PREFIX}" --exclude "*.html" "${DRYFLAG[@]}" || ASSET_RC=1
if [ "$DRY_RUN" -ne 1 ]; then
  # #72: concurrent self-archive via xargs -P (helper takes argv only)
  written_keys tree | while IFS= read -r k; do
    if [ -n "$k" ]; then
      case "$k" in *.html) : ;; *) printf '%s\0' "$k" || : ;; esac
    fi
  done | xargs -0 -r -n 1 -P "${AOIN_ARCHIVE_PARALLEL:-8}" \
    "$LIB/archive-one.sh" "$R2_ENDPOINT" "$BUCKET" \
    "${PREFIX}" "${PREFIX}archive/$PUBLISH_ID/" || ASSET_RC=1
fi
echo "phase: assets done rc=$ASSET_RC"
note_phase assets "$ASSET_RC" "$ATTEMPTS" "$(( $(date +%s) - PHASE_START ))"

# --- phase 3: html (last writes; then manifest + CURRENT pointer) -----------
echo "phase: html"
HTML_RC=0
PHASE_START=$(date +%s)
aws_retry html s3 sync "$PROD_TREE" "s3://$BUCKET/${PREFIX}" --exclude "*" --include "*.html" "${DRYFLAG[@]}" || HTML_RC=1
if [ "$DRY_RUN" -ne 1 ]; then
  # #72: concurrent self-archive via xargs -P (helper takes argv only)
  written_keys tree | while IFS= read -r k; do
    if [ -n "$k" ]; then
      case "$k" in *.html) printf '%s\0' "$k" || : ;; esac
    fi
  done | xargs -0 -r -n 1 -P "${AOIN_ARCHIVE_PARALLEL:-8}" \
    "$LIB/archive-one.sh" "$R2_ENDPOINT" "$BUCKET" \
    "${PREFIX}" "${PREFIX}archive/$PUBLISH_ID/" || HTML_RC=1
  aws_retry manifest-put s3 cp "$LOCAL_MAN" "s3://$BUCKET/${PREFIX}manifests/$PUBLISH_ID.json" || HTML_RC=1
  printf '%s' "$PUBLISH_ID" >"/tmp/prod-CURRENT-$PUBLISH_ID"
  aws_retry current-put s3 cp "/tmp/prod-CURRENT-$PUBLISH_ID" "s3://$BUCKET/${PREFIX}manifests/CURRENT" || HTML_RC=1
fi
echo "phase: html done rc=$HTML_RC (manifest=$PUBLISH_ID)"
note_phase html "$HTML_RC" "$ATTEMPTS" "$(( $(date +%s) - PHASE_START ))"

# --- phase 3.5: orphan sweep (#83; #107 F2 extends to stale HTML) -----------
# Layout commits churn _astro/*.[hash] names; the assets sync is additive-only
# by design, so superseded hashes stay live forever and verify REDs on every
# later publish (incident 2026-08-31: 3 orphans, tombstones:0, verify RED x2).
# #107 F2: the html sync is additive too, so work/<slug>/index.html of a
# deleted/archived project stays 200 forever. Sweep candidates are now ALL
# live _astro/ keys PLUS every top-level *.html (root objects + every
# top-level dir except media/ archive/ manifests/) that appear in NO current
# manifest. HTML is already self-archived at write time by the phase-3
# archive loop, so plain delete (archive ruling 2026-08-31) - no re-copy.
# Guard: refuse when the UNION of orphans exceeds AOIN_SWEEP_MAX_RATIO
# (default 0.25) of manifest key count - a corrupt/empty manifest can never
# nuke the bucket; guard-abort leaves the mismatch for verify to RED loudly.
echo "phase: sweep"
SWEEP_RC=0
SWEEP_N=0
PHASE_START=$(date +%s)
SWEEP_RATIO="${AOIN_SWEEP_MAX_RATIO:-0.25}"
SWEEP_KEYS_LOG="$LOGDIR/sweep-$PUBLISH_ID.txt"
: >"$SWEEP_KEYS_LOG"
if [ "$SOFT" -eq 1 ]; then
  # soft (#129): root sweep is skipped (root-manifest keys absent from the
  # soft manifest are NOT orphans), but the SOFT NAMESPACE gets its own
  # prune: retention = 1 generation. Everything under soft/ was self-archived
  # at write time (phase-2/3 archive loops land under soft/archive/<pid>/),
  # so deletes are plain (2026-08-31 ruling). soft/manifests/ never swept.
  # Expected set = current tree keys UNION this-gen overlay media keys.
  SOFT_SWEEP_LIST="/tmp/prod-softsweep-$PUBLISH_ID.txt"
  : >"$SOFT_SWEEP_LIST"
  aws_retry softsweep-ls s3 ls "s3://$BUCKET/soft/" --recursive >>"$SOFT_SWEEP_LIST" || SWEEP_RC=1
  if [ "$SWEEP_RC" -eq 0 ]; then
    SOFT_ORPHANS=$("$PY" - "$LOCAL_MAN" "$OVERLAY_MAN" "$SOFT_SWEEP_LIST" "$SWEEP_RATIO" <<'PYK3'
import json, sys
man = json.load(open(sys.argv[1]))
expected = {k["key"] for k in man["keys"]}
total = len(man["keys"])
# this-gen overlay media (media/<k> keys soft actually holds)
try:
    expected |= {"media/" + l.strip() for l in open(sys.argv[2]) if l.strip()}
except FileNotFoundError:
    pass
live = set()
for line in open(sys.argv[3]):
    parts = line.split()
    if len(parts) >= 4:
        key = parts[3]
        if key.startswith("soft/"):
            key = key[len("soft/"):]
        if key.startswith(("archive/", "manifests/")):
            continue  # never swept (retention handled separately below)
        live.add(key)
orphans = sorted(live - expected)
try:
    ratio = float(sys.argv[4])
except ValueError:
    ratio = 0.25
if total == 0 or len(orphans) > ratio * total:
    print("ABORT:%d" % len(orphans))
else:
    for k in orphans:
        print(k)
PYK3
)
    case "$SOFT_ORPHANS" in
      ABORT:*)
        echo "prod: soft sweep guard RED: ${SOFT_ORPHANS#ABORT:} orphans > ratio $SWEEP_RATIO of manifest - refusing; inspect $SOFT_SWEEP_LIST" >&2
        SWEEP_RC=1 ;;
      *)
        while IFS= read -r k; do
          [ -n "$k" ] || continue
          if [ "$DRY_RUN" -eq 1 ]; then
            echo "prod: [dryrun] soft prune soft/$k"
          elif aws_retry softsweep-rm s3api delete-object --bucket "$BUCKET" --key "soft/$k"; then
            SWEEP_N=$((SWEEP_N + 1))
            printf '%s\n' "$k" >>"$SWEEP_KEYS_LOG"
          else
            SWEEP_RC=1
          fi
        done <<<"$SOFT_ORPHANS"
        ;;
    esac
    # archive retention (#129): keep ONLY this generation's soft/archive/
    # <pid>/; older pids are superseded (root copies exist at promote time).
    if [ "$DRY_RUN" -ne 1 ] && [ "$SWEEP_RC" -eq 0 ]; then
      SOFT_ARCH_GUARD="$(mktemp)"
      if aws_retry softarch-ls s3api list-objects-v2 --bucket "$BUCKET" --prefix "soft/archive/" --delimiter "/" \
          --query "CommonPrefixes[].Prefix" --output text >"$SOFT_ARCH_GUARD"; then
        for p in $(cat "$SOFT_ARCH_GUARD"); do
          case "$p" in
            soft/archive/"$PUBLISH_ID"/) continue ;;
            soft/archive/*/)
              aws_retry softarch-ls2 s3 ls "s3://$BUCKET/$p" --recursive \
                | awk -v pre="soft/archive" '{print $4}' >"/tmp/prod-softarch-rm-$PUBLISH_ID.txt"
              while IFS= read -r k; do
                [ -n "$k" ] || continue
                if aws_retry softarch-rm s3api delete-object --bucket "$BUCKET" --key "$k"; then
                  SWEEP_N=$((SWEEP_N + 1))
                  printf '%s\n' "$k" >>"$SWEEP_KEYS_LOG"
                else
                  SWEEP_RC=1
                fi
              done </tmp/prod-softarch-rm-$PUBLISH_ID.txt
              ;;
          esac
        done
      fi
      rm -f "$SOFT_ARCH_GUARD"
    fi
    [ "$SWEEP_N" -gt 0 ] && echo "phase: sweep (soft) pruned $SWEEP_N keys (retention=1 gen; log $SWEEP_KEYS_LOG)"
  fi
elif [ "$DRY_RUN" -eq 1 ]; then
  echo "prod: [dryrun] sweep skipped (would diff live _astro/+html vs manifest)"
else
  SWEEP_LIST="/tmp/prod-sweep-$PUBLISH_ID.txt"
  : >"$SWEEP_LIST"
  aws_retry sweep-ls s3 ls "s3://$BUCKET/${PREFIX}_astro/" --recursive >>"$SWEEP_LIST" || SWEEP_RC=1
  # #107 F2: root objects (non-recursive; PRE lines are ignored downstream)
  # plus every top-level dir that may carry html. media/ (no html, huge
  # listing), archive/ and manifests/ (never swept by design) are skipped.
  aws_retry sweep-root s3 ls "s3://$BUCKET/${PREFIX}" >>"$SWEEP_LIST" || SWEEP_RC=1
  SWEEP_GUARD="$(mktemp)"
  if aws_retry sweep-dirs s3api list-objects-v2 --bucket "$BUCKET" --prefix "${PREFIX:-}" --delimiter "/" \
      --query "CommonPrefixes[].Prefix" --output text >"$SWEEP_GUARD"; then
    SWEEP_DIRS=$("$PY" - "$SWEEP_GUARD" "$PREFIX" <<'PYK2'
import sys
prefix = sys.argv[2]
skip = {"media/", "archive/", "manifests/", "_astro/"}
dirs = []
for g in open(sys.argv[1]).read().split():
    if prefix and g.startswith(prefix):
        g = g[len(prefix):]
    if g.endswith("/") and g not in skip:
        dirs.append(g)
print("\n".join(dirs))
PYK2
)
    for d in $SWEEP_DIRS; do
      aws_retry "sweep-${d%/}" s3 ls "s3://$BUCKET/${PREFIX}$d" --recursive >>"$SWEEP_LIST" || SWEEP_RC=1
    done
  else
    SWEEP_RC=1
  fi
  rm -f "$SWEEP_GUARD"
  if [ "$SWEEP_RC" -eq 0 ]; then
    SWEEP_ORPHANS=$("$PY" - "$LOCAL_MAN" "$SWEEP_LIST" "$PREFIX" "$SWEEP_RATIO" <<'PYK'
import json, sys
man = json.load(open(sys.argv[1]))
man_keys = {k["key"] for k in man["keys"]}
total = len(man["keys"])
prefix = sys.argv[3]
live = set()
for line in open(sys.argv[2]):
    parts = line.split()
    if len(parts) >= 4:
        key = parts[3]
        if prefix and key.startswith(prefix):
            key = key[len(prefix):]
        # #83 class (all _astro) + #107 F2 class (html) + renamed-asset
        # class (publish 1788380915: about-band-1/2.webp superseded by -v2
        # names, live-only, REDing every verify). Sweep scope MUST equal
        # verify scope: every listed key outside media/ archive/ manifests/
        # that appears in NO manifest is an orphan, whatever its extension.
        # media/ is never listed here (huge, media-prefixed); archive/ and
        # manifests/ are never swept by design (2026-08-31 ruling).
        live.add(key)
orphans = sorted(live - man_keys)
try:
    ratio = float(sys.argv[4])
except ValueError:
    ratio = 0.25
if total == 0 or len(orphans) > ratio * total:
    print("ABORT:%d" % len(orphans))
else:
    for k in orphans:
        print(k)
PYK
)
    case "$SWEEP_ORPHANS" in
      ABORT:*)
        echo "prod: sweep guard RED: ${SWEEP_ORPHANS#ABORT:} orphans > ratio $SWEEP_RATIO of manifest - refusing mass delete; verify will report" >&2
        SWEEP_RC=1 ;;
      *)
        while IFS= read -r k; do
          [ -n "$k" ] || continue
          if aws_retry sweep-rm s3api delete-object --bucket "$BUCKET" --key "${PREFIX}$k"; then
            SWEEP_N=$((SWEEP_N + 1))
            printf '%s\n' "$k" >>"$SWEEP_KEYS_LOG"
          else
            SWEEP_RC=1
          fi
        done <<<"$SWEEP_ORPHANS"
        [ "$SWEEP_N" -gt 0 ] && echo "phase: sweep removed $SWEEP_N orphans (log $SWEEP_KEYS_LOG)" ;;
    esac
  fi
fi
echo "phase: sweep done rc=$SWEEP_RC removed=$SWEEP_N"
note_phase sweep "$SWEEP_RC" "$ATTEMPTS" "$(( $(date +%s) - PHASE_START ))"

if [ "$SOFT" -eq 1 ]; then
  # soft (#128): verify scope = the soft namespace itself. Expected under
  # soft/: ALL tree keys (assets+html sync the full tree) + overlay media
  # (subset of media/). The live root is NOT soft's responsibility (it
  # belongs to the last root publish / next E4 promote).
  VERIFY_RC=0
  PHASE_START=$(date +%s)
  BUCKET_LIST="/tmp/prod-bucketlist-$PUBLISH_ID.txt"
  : >"$BUCKET_LIST"
  aws_retry verify-soft s3 ls "s3://$BUCKET/${PREFIX}" --recursive >>"$BUCKET_LIST" || VERIFY_RC=1
  if [ "$VERIFY_RC" -eq 0 ]; then
    "$PY" - "$LOCAL_MAN" "$BUCKET_LIST" "$PREFIX" <<'PYK'
import json, sys
man = json.load(open(sys.argv[1]))
tree = {k["key"] for k in man["keys"]}
soft = set()
for line in open(sys.argv[2]):
    parts = line.split(None, 3)
    if len(parts) >= 4:
        soft.add(parts[3].rstrip("\n"))
prefix = sys.argv[3]
def strip(k):
    return k[len(prefix):] if prefix and k.startswith(prefix) else k
skip = (prefix + "archive/", prefix + "manifests/")
soft_keys = {strip(k) for k in soft if not k.startswith(skip)}
missing = sorted(tree - soft_keys)
n_media = sum(1 for k in soft_keys if k.startswith("media/"))
print("soft-verify: tree %d/%d present, %d overlay media keys" % (
    len(tree) - len(missing), len(tree), n_media))
if missing:
    print("soft-verify: MISSING tree keys: %s" % ", ".join(missing[:10]))
    if len(missing) > 10:
        print("soft-verify: ... %d more" % (len(missing) - 10))
    sys.exit(1)
PYK
    [ "$?" -ne 0 ] && VERIFY_RC=1
  fi
  echo "phase: verify(soft) done rc=$VERIFY_RC"
  note_phase verify "$VERIFY_RC" "$ATTEMPTS" "$(( $(date +%s) - PHASE_START ))"
else
# --- phase 4: verify (reconciliation: manifest vs bucket) --------------------
echo "phase: verify"
VERIFY_RC=0
PHASE_START=$(date +%s)
BUCKET_LIST="/tmp/prod-bucketlist-$PUBLISH_ID.txt"
: >"$BUCKET_LIST"
# #72: scoped listing - archive/ and manifests/ grow unboundedly per publish
# and verify never reads them. List the root non-recursively (root objects +
# PRE lines, which manifest.py ignores) plus each expected top-level dir
# recursively; a delimiter probe guards against UNEXPECTED top-level prefixes
# so completeness matches the old full --recursive listing.
aws_retry verify-root s3 ls "s3://$BUCKET/${PREFIX}" >>"$BUCKET_LIST" || VERIFY_RC=1
TOPGUARD=$(mktemp)
aws_retry verify-guard s3api list-objects-v2 --bucket "$BUCKET" --prefix "${PREFIX:-}" --delimiter "/" \
  --query "CommonPrefixes[].Prefix" --output text >"$TOPGUARD" || VERIFY_RC=1
LIVE_DIRS=$("$PY" - "$LOCAL_MAN" "$TOPGUARD" "$PREFIX" <<'PYK'
import json, sys
man = json.load(open(sys.argv[1]))
prefix = sys.argv[3]
tops = {"media/"}
for k in man["keys"]:
    key = k["key"] if isinstance(k, dict) else k
    if "/" in key:
        tops.add(key.split("/", 1)[0] + "/")
    # root files are covered by the non-recursive root listing
guard = set()
for g in open(sys.argv[2]).read().split():
    if g.startswith(prefix):
        g = g[len(prefix):]
    guard.add(g)
allowed = tops | {"archive/", "manifests/"}
unexpected = sorted(guard - allowed)
if unexpected:
    print("UNEXPECTED:" + ",".join(unexpected))
else:
    for d in sorted(tops):
        print(d)
PYK
)
case "$LIVE_DIRS" in
  UNEXPECTED:*)
    echo "prod: verify top-level guard RED: unexpected prefixes ${LIVE_DIRS#UNEXPECTED:}" >&2
    VERIFY_RC=1 ;;
  *)
    while IFS= read -r d; do
      [ -n "$d" ] || continue
      aws_retry "verify-${d%/}" s3 ls "s3://$BUCKET/${PREFIX}${d}" --recursive >>"$BUCKET_LIST" || VERIFY_RC=1
    done <<<"$LIVE_DIRS" ;;
esac
rm -f "$TOPGUARD"
if [ "$VERIFY_RC" -eq 0 ]; then
  "$PY" "$LIB/manifest.py" verify --manifest "$LOCAL_MAN" --bucket-list "$BUCKET_LIST" --prefix "$PREFIX"
  VRC=$?
  if [ "$VRC" -ne 0 ]; then
    if [ "$DRY_RUN" -eq 1 ]; then
      echo "phase: verify would-mismatch (dry-run: reporting only)"
    else
      VERIFY_RC=1
    fi
  fi
fi
echo "phase: verify done rc=$VERIFY_RC"
note_phase verify "$VERIFY_RC" "$ATTEMPTS" "$(( $(date +%s) - PHASE_START ))"
fi

# --- ledger + exit contract --------------------------------------------------
FINISHED=$(date +%s)
CHANGED_TREE=$("$PY" - "$LOCAL_MAN" "${PREV_MAN:-}" <<'PYK'
import json, sys
new = json.load(open(sys.argv[1])); prevp = sys.argv[2]
prev = json.load(open(prevp)) if prevp else None
newk = {k["key"]: [k["size"], k["etag"]] for k in new["keys"]}
prevk = {k["key"]: [k["size"], k["etag"]] for k in prev["keys"]} if prev else {}
print(sum(1 for k in newk if k not in prevk or (newk[k] != prevk[k])))
PYK
)
CHANGED_MEDIA=$("$PY" - "$LOCAL_MAN" "${PREV_MAN:-}" <<'PYK'
import json, sys
new = json.load(open(sys.argv[1])); prevp = sys.argv[2]
prev = json.load(open(prevp)) if prevp else None
newm = set(new["media_keys"]); prevm = set(prev["media_keys"]) if prev else set()
print(len(newm - prevm))
PYK
)
"$PY" - "$LOGJSON" "$PUBLISH_ID" "$MODE" "$PREFIX" "$STARTED" "$FINISHED" "$PHASES_JSON" "$LOCAL_MAN" "$CHANGED_TREE" "$CHANGED_MEDIA" "$TOMB_N" <<'PYK'
import json, sys
path, pid, mode, prefix, started, finished, phases, man = sys.argv[1:9]
changed_tree, changed_media, tombstones = sys.argv[9:12]
try:
    m = json.load(open(man))
    bytes_tree = sum(k.get("size", 0) for k in m.get("keys", []))
    n_tree = len(m.get("keys", []))
    n_media = len(m.get("media_keys", []))
except Exception:
    bytes_tree = n_tree = n_media = 0
json.dump({
    "publish_id": pid, "mode": mode, "prefix": prefix,
    "started": int(started), "finished": int(finished),
    "elapsed": int(finished) - int(started),
    "phases": json.loads(phases), "manifest": man,
    "changed_tree": int(changed_tree), "changed_media": int(changed_media),
    "tombstones": int(tombstones),
    "bytes_tree": bytes_tree, "objects_tree": n_tree, "objects_media": n_media,
}, open(path, "w"), indent=1)
print("prod: ledger %s" % path)
PYK

RC=0
for rc in "$MEDIA_RC" "$ASSET_RC" "$HTML_RC" "$SWEEP_RC" "$VERIFY_RC"; do
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
