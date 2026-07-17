#!/usr/bin/env bash
# usage-check.sh — Optional budget probe before harness continues
#
# Neither Claude Code nor Cursor CLI expose usage/budget in a stable shell API.
# This script is a hook point: configure your own probe, or leave unset.
#
# Exit 0 = OK to continue
# Exit 1 = low budget / warn (harness will prompt or halt depending on HARNESS_USAGE_CHECK)
#
# Configuration:
#   HARNESS_USAGE_CMD='my-script.sh --threshold 10'   custom probe command
#   HARNESS_USAGE_MIN_REMAINING=5                     optional numeric guard (if probe prints a number)

set -euo pipefail

if [ -n "${HARNESS_USAGE_CMD:-}" ]; then
  echo "Running custom usage probe: $HARNESS_USAGE_CMD"
  eval "$HARNESS_USAGE_CMD"
  exit $?
fi

# No probe configured — nothing to check.
if [ "${HARNESS_USAGE_CHECK:-0}" = "1" ]; then
  echo "Note: HARNESS_USAGE_CHECK=1 but HARNESS_USAGE_CMD is unset."
  echo "      Set HARNESS_USAGE_CMD to a script that exits 1 when budget is low."
  echo "      Example: HARNESS_USAGE_CMD='curl -sf https://api.example.com/usage | jq -e .remaining_pct > 20'"
fi

exit 0
