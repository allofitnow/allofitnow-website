#!/usr/bin/env bash
# M5 post-build fan-out entry (pipeline spec sec 9).
# Contract: ALWAYS exit 0. Per-target failures are isolated, recorded in the
# drift ledger, and alerted best effort. The staging publish is never blocked.
set -uo pipefail

BUILD_TREE=""
PUBLISH_ID=""
while [ $# -gt 0 ]; do
  case "$1" in
    --build-tree) BUILD_TREE="${2:-}"; shift 2 ;;
    --publish-id) PUBLISH_ID="${2:-}"; shift 2 ;;
    *) echo "post-publish: ignoring unknown arg ${1}" >&2; shift ;;
  esac
done
if [ -z "$BUILD_TREE" ] || [ -z "$PUBLISH_ID" ]; then
  echo "post-publish: --build-tree and --publish-id required; nothing to do" >&2
  exit 0
fi

LOGS_DIR="deploy/logs"
LEDGER="${LOGS_DIR}/post-publish-${PUBLISH_ID}.json"
mkdir -p "$LOGS_DIR" /opt/aoin-tracking/baselines 2>/dev/null || true
STARTED=$(date +%s)
RESULTS=$(mktemp /tmp/aoin-pp-results.XXXXXX)
trap 'rm -f "$RESULTS"' EXIT

for SCRIPT in deploy/hooks/post-publish/targets/*.sh; do
  [ -f "$SCRIPT" ] || continue
  T=$(basename "$SCRIPT" .sh)
  OUT=$(timeout "${AOIN_TARGET_TIMEOUT:-300}" bash "$SCRIPT" \
        --build-tree "$BUILD_TREE" --publish-id "$PUBLISH_ID" 2>&1)
  RC=$?
  ESC=$(printf '%s\n' "$OUT" | tail -n 20 | tr '\n\t' '  ')
  printf '%s\t%s\t%s\n' "$T" "$RC" "$ESC" >> "$RESULTS"
  if [ "$RC" -ne 0 ]; then
    echo "WARN: post-publish target ${T} exited ${RC}; staging unaffected; see ${LEDGER}" >&2
  fi
done
FINISHED=$(date +%s)

python3 - "$LEDGER" "$PUBLISH_ID" "$BUILD_TREE" "$STARTED" "$FINISHED" "$RESULTS" <<'PYEOF'
import json, os, sys, urllib.request
ledger, pid, tree, started, finished, results = sys.argv[1:7]
targets = []
for line in open(results, encoding="utf-8"):
    name, code, tail = line.rstrip("\n").split("\t", 2)
    targets.append({"name": name, "exit": int(code), "tail": tail})
doc = {"publish_id": pid, "build_tree": tree, "started": int(started),
       "finished": int(finished), "targets": targets}
with open(ledger, "w", encoding="utf-8") as fh:  # drift ledger under deploy/logs (gitignored)
    json.dump(doc, fh, indent=1, sort_keys=True)
fails = [t for t in targets if t["exit"] != 0]
tokfile = "/etc/aoin-gitlab-token"
if fails and os.path.isfile(tokfile):
    try:
        tok = open(tokfile, encoding="utf-8").read().strip()
        body = json.dumps({"body": "post-publish %s target failures: %s" % (
            pid, ", ".join("%s exit %s" % (t["name"], t["exit"]) for t in fails))}).encode()
        req = urllib.request.Request(
            "http://gitlab.someofitlater.com/api/v4/projects/135/issues/32/notes",
            data=body, headers={"PRIVATE-TOKEN": tok,
                                "Content-Type": "application/json"})
        urllib.request.urlopen(req, timeout=15).read()
    except Exception as e:
        print("alert delivery failed (log only): %s" % e, file=sys.stderr)
PYEOF

exit 0
