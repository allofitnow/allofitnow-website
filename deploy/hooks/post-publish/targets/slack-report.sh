#!/usr/bin/env bash
# slack-report.sh - plain-text Slack report per publish (#72 CUT-4 phase 1).
# Reads the prod ledger + post-publish ledger, renders a plain message (no
# Block Kit; interactivity is #69-phase work, different board), and posts it
# to the #aoin-publish incoming webhook. Secrets are out-of-band
# (/etc/aoin-slack.env, lib/slack.sh loader); nothing lives in the repo.
# Contract: best-effort, ALWAYS exit 0 - the publish is never blocked by
# reporting. Trigger source comes from AOIN_PUBLISH_TRIGGER (exported by
# publish.sh; "watch" callers set it explicitly).
#
# Message shape (url-check wiki phase 1):
#   AOIN publish <id> [mode]
#   build: <commit> | trigger: <manual|watch>
#   phases: media 12s(rc=0), assets 210s(rc=0), ...
#   changed: tree N, media N, tombstones N
#   elapsed: Ns | verdict: PASS|FAIL|FATAL <reason>
#   first-error: <target tail>            (only on failure)
set -uo pipefail

PUBLISH_ID=""
while [ $# -gt 0 ]; do
  case "$1" in
    --publish-id) PUBLISH_ID="${2:-}"; shift 2 ;;
    --build-tree) shift 2 ;;   # accepted for target-shape parity; unused here
    *) shift ;;
  esac
done

DIR=$(cd "$(dirname "$0")" && pwd)
LIB="$DIR/../lib"
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || echo "$DIR/../../..")
LOGDIR="$REPO_ROOT/deploy/logs"
PY=$(command -v python3 || echo /opt/aoin-hooks-venv/bin/python3)
TRIGGER="${AOIN_PUBLISH_TRIGGER:-manual}"

MSG=$("$PY" - "$LOGDIR" "$PUBLISH_ID" "$TRIGGER" <<'PYK'
import glob, json, os, sys
logdir, pid, trigger = sys.argv[1], sys.argv[2], sys.argv[3]

def load(pattern):
    hits = sorted(glob.glob(os.path.join(logdir, pattern)))
    return json.load(open(hits[-1])) if hits else None

prod = load("prod-%s.json" % pid) if pid else None
pp = load("post-publish-%s.json" % pid) if pid else None
if not prod:
    print("AOIN publish %s: no prod ledger found (report skipped)" % pid)
    sys.exit(0)

mode = prod.get("mode", "?")
elapsed = prod.get("elapsed", prod.get("finished", 0) - prod.get("started", 0))
phases = ", ".join("%s %ss(rc=%s)" % (p.get("name"), p.get("duration", "?"), p.get("exit"))
                   for p in prod.get("phases", []))
fatal = prod.get("fatal")
if fatal:
    verdict = "FATAL " + str(fatal)
elif prod.get("phases") and all(p.get("exit") == 0 for p in prod["phases"]):
    verdict = "PASS"
else:
    verdict = "FAIL"

commit = "?"
manpath = prod.get("manifest", "")
if manpath and os.path.isfile(manpath):
    try:
        commit = json.load(open(manpath)).get("build_commit", "?")
    except Exception:
        pass

first_err = ""
if pp:
    for t in pp.get("targets", []):
        if t.get("exit", 0) != 0:
            first_err = "%s: %s" % (t.get("name"), (t.get("tail") or "").strip()[:120])
            break

lines = [
    "AOIN publish %s [%s]" % (pid or "?", mode),
    "build: %s | trigger: %s" % (commit, trigger),
    "phases: %s" % (phases or "n/a"),
    "changed: tree %s, media %s, tombstones %s" % (
        prod.get("changed_tree", "?"), prod.get("changed_media", "?"),
        prod.get("tombstones", "?")),
    "elapsed: %ss | verdict: %s" % (elapsed, verdict),
]
if first_err:
    lines.append("first-error: " + first_err)
print("\n".join(lines))
PYK
) || MSG="AOIN publish ${PUBLISH_ID:-?}: report generation failed (log only)"

echo "$MSG"   # always visible in the publish log

if [ -f "${AOIN_SLACK_ENV_FILE:-/etc/aoin-slack.env}" ]; then
  # shellcheck source=/dev/null
  source "$LIB/slack.sh"
  if aoin_slack_env_load; then
    PAYLOAD=$("$PY" -c 'import json,sys; print(json.dumps({"text": sys.stdin.read()}))' <<<"$MSG")
    if curl -s -m 20 -X POST -H "Content-Type: application/json" \
         -d "$PAYLOAD" "$SLACK_WEBHOOK_URL" >/dev/null; then
      echo "slack-report: delivered to Slack"
    else
      echo "slack-report: delivery failed (log only)" >&2
    fi
  fi
else
  echo "slack-report: /etc/aoin-slack.env absent; message logged only (operator provisioning pending)" >&2
fi

exit 0
