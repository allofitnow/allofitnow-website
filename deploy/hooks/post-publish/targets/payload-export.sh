#!/usr/bin/env bash
# post-publish target (#153): regenerate, commit, and push this host's Payload
# export so DB edits leave a git footprint. Delegates to scripts/export-commit-push.sh.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
cd "$REPO_ROOT" || exit 0

bash scripts/export-commit-push.sh
