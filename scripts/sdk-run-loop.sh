#!/bin/bash
# sdk-run-loop.sh — Run the SDK orchestrator autonomous loop
#
# Usage:
#   scripts/sdk-run-loop.sh "Build a kanban board"
#   scripts/sdk-run-loop.sh "Build a kanban board" 5
#   scripts/sdk-run-loop.sh --continue

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

if [ "${1:-}" = "--continue" ]; then
  node sdk-orchestrator/cli.mjs run-loop --continue
  exit 0
fi

PROMPT="${1:?Usage: scripts/sdk-run-loop.sh \"product prompt\" [max_qa_rounds] | scripts/sdk-run-loop.sh --continue}"
MAX_ROUNDS="${2:-}"

export HARNESS_MAX_QA_ROUNDS="${MAX_ROUNDS:-${HARNESS_MAX_QA_ROUNDS:-3}}"

node sdk-orchestrator/cli.mjs run-loop --prompt "$PROMPT"
