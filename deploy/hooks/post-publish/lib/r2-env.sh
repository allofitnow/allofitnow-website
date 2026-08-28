#!/usr/bin/env bash
# r2-env.sh - load root-only R2 credentials into the environment WITHOUT
# sourcing the creds file. Lines are extracted with grep/sed and assigned via
# printf -v, so file content can never execute. Refuses (exit 2) when the file
# is missing or its permissions are looser than 0600 root.
#
# Usage (deploy hooks, e.g. the #49 sync step):
#   source "$(dirname "${BASH_SOURCE[0]}")/r2-env.sh"
#   aoin_r2_env_load
#
# Usage (verification only; prints key NAMES, never values):
#   deploy/hooks/post-publish/lib/r2-env.sh; echo $?
#
# The creds file lives OUTSIDE the repo (operator distributes it out-of-band,
# Infisical pattern). Default path /etc/aoin-r2.env, override with
# AOIN_R2_ENV_FILE. Every well-formed UPPERCASE_KEY=value line in the file is
# exported; the file shape is fixed by the ops runbook.

AOIN_R2_ENV_FILE="${AOIN_R2_ENV_FILE:-/etc/aoin-r2.env}"

aoin_r2_env_load() {
    local file="$AOIN_R2_ENV_FILE"

    if [ ! -f "$file" ]; then
        echo "r2-env: creds file not found: $file (operator distributes it out-of-band)" >&2
        return 2
    fi

    local perms owner
    perms=$(stat -c '%a' "$file")
    owner=$(stat -c '%U' "$file")
    if [ "$perms" != "600" ] || [ "$owner" != "root" ]; then
        echo "r2-env: refusing unsafe creds file: $file is ${perms} ${owner} (expected 600 root)" >&2
        return 2
    fi

    local raw key val parsed=0
    while IFS= read -r raw; do
        key=$(printf '%s' "$raw" | sed -n 's/^\([A-Z][A-Z0-9_]*\)=.*/\1/p')
        [ -n "$key" ] || continue
        val=$(printf '%s' "$raw" | sed -n 's/^[A-Z][A-Z0-9_]*=//p' \
              | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'\$//")
        printf -v "$key" '%s' "$val"
        # shellcheck disable=SC2163  # exporting the variable NAMED by $key
        export "$key"
        parsed=$((parsed + 1))
    done < <(grep -E '^[A-Z][A-Z0-9_]*=' "$file" || true)

    if [ "$parsed" -eq 0 ]; then
        echo "r2-env: no KEY=VALUE lines found in $file" >&2
        return 2
    fi

    if [ -z "${R2_ENDPOINT:-}" ]; then
        echo "r2-env: R2_ENDPOINT missing from $file" >&2
        return 2
    fi
    case "$R2_ENDPOINT" in
        https://*) : ;;
        *) echo "r2-env: R2_ENDPOINT must be an https:// URL" >&2; return 2 ;;
    esac

    return 0
}

# Executed directly (not sourced): run checks + parse, print one summary line.
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
    aoin_r2_env_load
    rc=$?
    if [ "$rc" -eq 0 ]; then
        echo "r2-env: ok, $(grep -cE '^[A-Z][A-Z0-9_]*=' "$AOIN_R2_ENV_FILE") key(s) loaded from $AOIN_R2_ENV_FILE: $(grep -oE '^[A-Z][A-Z0-9_]*' "$AOIN_R2_ENV_FILE" | tr '\n' ' ')"
    fi
    exit "$rc"
fi
