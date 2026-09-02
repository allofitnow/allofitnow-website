#!/usr/bin/env bash
# ladder-rungs.sh - delta-only video rung generation + payload registration (#101, E1+E2).
# SSOT: GitLab wiki `video-ladder` (v4) + issue #101. Runs on .245 pre-build.
# Rules (audited 2026-09-02, passes 1-5):
#   - never overwrite an existing sibling rung (delta-only; .part staging + atomic mv)
#   - skip rule COMPARATIVE per rung: skip 720 when master_avg <= 3.0 Mbps,
#     skip 480 when master_avg <= 1.5 Mbps (probe format=bit_rate)
#   - GOP fps-adaptive: GOP = round(fps x 2) probed per master (30->60, 23.976->48,
#     25->50, 60->120, 59.94->120); never hardcode -g 60
#   - aspect-safe fixed canvas (scale decrease + pad), ffprobe outputs and register
#     MEASURED width/height/filesize, never literals
#   - niced (nice -n 10), <= 2 concurrent ffmpeg, disk guard stops generation
#   - registration: mongoose-free mongosh $set on payload.media (payload.init needs express)
#   - additive: any failure logs WARN and exits 0 so publish.sh continues
set -uo pipefail

MEDIA="${AOIN_LADDER_MEDIA:-/root/projects/allofitnow-website/backend/media}"
LOGDIR="${AOIN_LADDER_LOGDIR:-/root/projects/aoin-deploy/deploy/logs}"
MIN_FREE_MB="${AOIN_LADDER_MIN_FREE_MB:-5120}"
DRY_RUN="${AOIN_LADDER_DRY_RUN:-0}"
ONLY="${AOIN_LADDER_ONLY:-}"   # optional comma-separated stem allowlist (proof runs)
TS="$(date +%Y%m%d-%H%M%S)"
LOG="$LOGDIR/ladder-rungs-$TS.log"
WORK="$(mktemp -d /tmp/ladder-rungs.XXXXXX)"
REG_DIR="$WORK/reg"
mkdir -p "$REG_DIR" "$LOGDIR"

log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*" >> "$LOG"; printf '%s %s\n' "$(date -u +%FT%TZ)" "$*"; }
die_warn() { log "WARN: $*"; log "hook exits 0 (publish additive); rerun fixes delta"; exit 0; }

[ -d "$MEDIA" ] || die_warn "media dir $MEDIA missing"
free_mb() { df -B M --output=avail "$MEDIA" | tail -1 | tr -dc '0-9'; }

# ---------- single-field probes (csv=p=0 is safe single-field; never multi-field) ----------
probe_fps() { ffprobe -v error -select_streams v:0 -show_entries stream=r_frame_rate -of csv=p=0 "$1" 2>/dev/null; }
probe_bitrate() { ffprobe -v error -show_entries format=bit_rate -of csv=p=0 "$1" 2>/dev/null; }
probe_dims() { ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "$1" 2>/dev/null; }
gop_for_fps() { awk -v n="$1" -v d="$2" 'BEGIN{f=(d>0)?n/d:0;g=int(f*2+0.5);if(g<2)g=2;print g}'; }

# ---------- Phase A: census / plan (single-threaded) ----------
PLAN="$WORK/plan.tsv"
: > "$PLAN"
n_total=0; n_have720=0; n_have480=0; n_skip720=0; n_skip480=0; n_enc720=0; n_enc480=0; n_poster=0
shopt -s nullglob
MASTERS=( "$MEDIA"/*.mp4 )
# exclude existing rungs themselves (a *-1280x720.mp4 is not a master)
mapfile -t RUNGS < <(printf '%s\n' "${MASTERS[@]}" | grep -E -- '-[0-9]+x[0-9]+\.mp4$' || true)
declare -A RUNG_SET=()
for r in "${RUNGS[@]}"; do RUNG_SET["$(basename "$r")"]=1; done

log "=== ladder-rungs census start: ${#MASTERS[@]} mp4 files, rungs-present=${#RUNGS[@]} ==="

for M in "${MASTERS[@]}"; do
  base="$(basename "$M")"
  [[ -n "${RUNG_SET[$base]:-}" ]] && continue   # this file IS a rung
  stem="${base%.mp4}"
  if [ -n "$ONLY" ]; then
    case ",$ONLY," in *",$stem,"*) ;; *) continue;; esac
  fi
  n_total=$((n_total+1))
  r720="$MEDIA/$stem-1280x720.mp4"; r480="$MEDIA/$stem-854x480.mp4"; poster="$MEDIA/$stem-poster.webp"
  [ -f "$r720" ] && n_have720=$((n_have720+1))
  [ -f "$r480" ] && n_have480=$((n_have480+1))

  fr="$(probe_fps "$M")"; br="$(probe_bitrate "$M")"
  [ -n "$fr" ] && [ -n "$br" ] || { log "WARN: probe failed for $base - skipped"; continue; }
  num="${fr%%/*}"; den="${fr##*/}"; [ "$num" = "$den" ] && den=1
  GOP="$(gop_for_fps "$num" "$den")"
  mbps="$(awk -v b="$br" 'BEGIN{printf "%.3f", b/1000000}')"

  do720=0; do480=0
  [ -f "$r720" ] || { awk -v m="$mbps" 'BEGIN{exit !(m>3.0)}' && { do720=1; n_enc720=$((n_enc720+1)); } || n_skip720=$((n_skip720+1)); }
  [ -f "$r480" ] || { awk -v m="$mbps" 'BEGIN{exit !(m>1.5)}' && { do480=1; n_enc480=$((n_enc480+1)); } || n_skip480=$((n_skip480+1)); }
  po=0
  # poster accompanies ANY wired master (any rung present or planned; #103 renders
  # poster=<stem>-poster.webp for every src-less video, 480-only included)
  if { [ -f "$r720" ] || [ $do720 -eq 1 ] || [ -f "$r480" ] || [ $do480 -eq 1 ]; } && [ ! -f "$poster" ]; then po=1; n_poster=$((n_poster+1)); fi

  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$stem" "$GOP" "$mbps" "$do720" "$do480" "$po" "$base" >> "$PLAN"
done

log "census: masters=$n_total have720=$n_have720 have480=$n_have480 enc720=$n_enc720 skip720=$n_skip720 enc480=$n_enc480 skip480=$n_skip480 posters=$n_poster free_mb=$(free_mb)"

if [ "$DRY_RUN" = "1" ]; then
  log "DRY_RUN=1 - plan only, no encode, no registration"; cat "$PLAN"; exit 0
fi
[ -s "$PLAN" ] && [ $((n_enc720 + n_enc480 + n_poster)) -gt 0 ] || { log "nothing to do (delta empty)"; exit 0; }

# ---------- Phase B: encode (worker xargs -P 2) ----------
export MEDIA WORK REG_DIR MIN_FREE_MB LOG

worker() {
  stem="$1"; GOP="$2"; mbps="$3"; do720="$4"; do480="$5"; po="$6"
  M="$MEDIA/$stem.mp4"
  ff_free() { df -B M --output=avail "$MEDIA" | tail -1 | tr -dc '0-9'; }

  enc() { # $1 out-path  $2 W  $3 H  $4 bv  $5 maxrate  $6 bufsize
    local out="$1" W="$2" H="$3" bv="$4" mr="$5" bs="$6" part="$1.part"
    [ "$(ff_free)" -lt "$MIN_FREE_MB" ] && { echo "$(date -u +%FT%TZ) WARN: disk guard hit (<${MIN_FREE_MB}MB), skipping $stem" >> "$LOG"; return 3; }
    local cmd="nice -n 10 ffmpeg -nostdin -y -v error -i \"$M\" -vf \"scale=${W}:${H}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2\" -c:v libx264 -profile:v high -pix_fmt yuv420p -b:v ${bv} -maxrate ${mr} -bufsize ${bs} -g ${GOP} -keyint_min ${GOP} -sc_threshold 0 -movflags +faststart -an \"${part}\""
    echo "$(date -u +%FT%TZ) CMD $stem: $cmd" >> "$LOG"
    if nice -n 10 ffmpeg -nostdin -y -v error -i "$M" \
        -vf "scale=${W}:${H}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2" \
        -c:v libx264 -profile:v high -pix_fmt yuv420p -b:v "$bv" -maxrate "$mr" -bufsize "$bs" \
        -g "$GOP" -keyint_min "$GOP" -sc_threshold 0 -movflags +faststart -an "$part" </dev/null >> "$LOG" 2>&1; then
      mv -f "$part" "$out"; return 0
    else
      rm -f "$part"; echo "$(date -u +%FT%TZ) WARN: encode FAILED $stem -> $out" >> "$LOG"; return 1
    fi
  }

  reg() { # $1 sizes-key  $2 filename  $3 canvas W  $4 canvas H
    local sz w h
    sz="$(ffprobe -v error -show_entries format=size -of csv=p=0 "$MEDIA/$2" 2>/dev/null)"
    dims="$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "$MEDIA/$2" 2>/dev/null)"
    w="${dims%%,*}"; h="${dims##*,}"
    [ -n "$sz" ] && [ -n "$w" ] || { echo "$(date -u +%FT%TZ) WARN: ffprobe failed on $2 (not registered)" >> "$LOG"; return 1; }
    printf 'db.getSiblingDB("payload").media.updateOne({filename:"%s"},{$set:{"%s":{filename:"%s",width:%s,height:%s,mimeType:"video/mp4",filesize:%s}}});\n' \
      "$stem.mp4" "sizes.$1" "$2" "$w" "$h" "$sz" > "$REG_DIR/$stem.$1.js"
  }

  if [ "$do720" = "1" ]; then enc "$MEDIA/$stem-1280x720.mp4" 1280 720 3M 4.2M 6M && reg w1280 "$stem-1280x720.mp4" 1280 720; fi
  if [ "$do480" = "1" ]; then enc "$MEDIA/$stem-854x480.mp4" 854 480 1.5M 2.1M 3M && reg w854 "$stem-854x480.mp4" 854 480; fi
  # backfill registration for pre-existing siblings that lack it (self-heal re-runs)
  if [ "$do720" = "0" ] && [ -f "$MEDIA/$stem-1280x720.mp4" ] && [ ! -f "$REG_DIR/$stem.w1280.js" ]; then reg w1280 "$stem-1280x720.mp4" 1280 720; fi
  if [ "$do480" = "0" ] && [ -f "$MEDIA/$stem-854x480.mp4" ] && [ ! -f "$REG_DIR/$stem.w854.js" ]; then reg w854 "$stem-854x480.mp4" 854 480; fi
  if [ "$po" = "1" ]; then
    part="$MEDIA/$stem-poster.webp.part"
    if nice -n 10 ffmpeg -nostdin -y -v error -ss 1 -i "$M" -frames:v 1 \
        -vf "scale=1280:720:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=1280:720:(ow-iw)/2:(oh-ih)/2" \
        "$part" </dev/null >> "$LOG" 2>&1; then mv -f "$part" "$MEDIA/$stem-poster.webp";
    else rm -f "$part"; echo "$(date -u +%FT%TZ) WARN: poster failed $stem" >> "$LOG"; fi
  fi
  # master width/height backfill (measured, idempotent)
  mdims="$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "$M" 2>/dev/null)"
  mw="${mdims%%,*}"; mh="${mdims##*,}"
  [ -n "$mw" ] && printf 'db.getSiblingDB("payload").media.updateOne({filename:"%s",$or:[{width:null},{width:{$exists:false}},{height:null},{height:{$exists:false}}]},{$set:{width:%s,height:%s}});\n' \
    "$stem.mp4" "$mw" "$mh" > "$REG_DIR/$stem.dims.js"
}
export -f worker

awk -F'\t' '{print $1"\t"$2"\t"$3"\t"$4"\t"$5"\t"$6}' "$PLAN" | xargs -P 2 -L 1 bash -c 'worker "$@"' _
xargs_rc=$?
log "encode phase done (xargs rc=$xargs_rc). free_mb=$(free_mb)"

# ---------- Phase C: registration (single mongosh run) ----------
REGJS="$WORK/register-rungs.js"
{
  echo '// ladder-rungs registration (auto-generated #101 hook)'
  cat "$REG_DIR"/*.js 2>/dev/null
  echo 'print("registered " + Object.keys(this).length);'
} > "$REGJS" 2>/dev/null || true

if grep -q 'updateOne' "$REGJS"; then
  sed -i '$d' "$REGJS"   # drop the print placeholder line
  echo 'const __r = db.getSiblingDB("payload").media; print("ladder-rungs registration: docs touched see modifiedCount above");' >> "$REGJS"
  if mongosh --quiet payload "$REGJS" >> "$LOG" 2>&1; then
    log "registration OK ($(grep -c updateOne "$REGJS") statements)"
  else
    log "WARN: mongosh registration failed - rungs encoded but not registered; rerun to backfill"
  fi
else
  log "no registration statements (backfill-only run or all probes failed)"
fi

log "=== ladder-rungs done. rungs now: 720=$(ls "$MEDIA" | grep -c -- '-1280x720.mp4$' || true) 480=$(ls "$MEDIA" | grep -c -- '-854x480.mp4$' || true) posters=$(ls "$MEDIA" | grep -c -- '-poster.webp$' || true) ==="
rm -rf "$WORK"
exit 0
