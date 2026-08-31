#!/usr/bin/env bash
# slack.sh - load Slack webhook credentials WITHOUT sourcing the creds file
# (same out-of-band pattern as r2-env.sh; #72 CUT-4 phase 1).
#
# File shape (0600 root, distributed by the operator, never in the repo):
#   SLACK_WEBHOOK_URL=https://hooks.slack.com/services/T.../B.../...
#   SLACK_CHANNEL=aoin-publish          (optional, report metadata only)
#   SLACK_VERIFY_TOKEN=xoxb-...         (optional; conversations.history
#                                        verification, #72 AC2 proof)
AOIN_SLACK_ENV_FILE="${AOIN_SLACK_ENV_FILE:-/etc/aoin-slack.env}"

aoin_slack_env_load() {
    local file="$AOIN_SLACK_ENV_FILE"

    if [ ! -f "$file" ]; then
        echo "slack-env: creds file not found: $file (operator distributes it out-of-band)" >&2
        return 2
    fi

    local perms owner
    perms=$(stat -c '%a' "$file")
    owner=$(stat -c '%U' "$file")
    if [ "$perms" != "600" ] || [ "$owner" != "root" ]; then
        echo "slack-env: refusing unsafe creds file: $file is ${perms} ${owner} (expected 600 root)" >&2
        return 2
    fi

    local raw key val parsed=0
    while IFS= read -r raw; do
        key=$(printf '%s' "$raw" | sed -n 's/^\([A-Z][A-Z0-9_]*\)=.*/\1/p')
        [ -n "$key" ] || continue
        val=$(printf '%s' "$raw" | sed -n 's/^[A-Z][A-Z0-9_]*=//p' \
              | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'\$//")
        printf -v "$key" '%s' "$val"
        # shellcheck disable=SC2163
        export "$key"
        parsed=$((parsed + 1))
    done < <(grep -E '^[A-Z][A-Z0-9_]*=' "$file" || true)

    if [ "$parsed" -eq 0 ]; then
        echo "slack-env: no KEY=VALUE lines found in $file" >&2
        return 2
    fi
    if [ -z "${SLACK_WEBHOOK_URL:-}" ]; then
        echo "slack-env: SLACK_WEBHOOK_URL missing from $file" >&2
        return 2
    fi
    case "$SLACK_WEBHOOK_URL" in
        https://hooks.slack.com/*) : ;;
        *) echo "slack-env: SLACK_WEBHOOK_URL must be an https://hooks.slack.com/ URL" >&2; return 2 ;;
    esac

    return 0
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
    aoin_slack_env_load
    rc=$?
    if [ "$rc" -eq 0 ]; then
        echo "slack-env: ok, $(grep -cE '^[A-Z][A-Z0-9_]*=' "$AOIN_SLACK_ENV_FILE") key(s) loaded: $(grep -oE '^[A-Z][A-Z0-9_]*' "$AOIN_SLACK_ENV_FILE" | tr '\n' ' ')"
    fi
    exit "$rc"
fi
