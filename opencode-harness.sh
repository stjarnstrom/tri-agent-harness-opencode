#!/bin/bash
# opencode-harness.sh — Combined three-agent harness via OpenCode CLI
#
# Orchestrates Planner -> Generator -> [Pre-QA Gate] -> Evaluator
# Environment constraints: hooks, lints, sandbox (see harness/AGENT-INSTRUCTIONS.md)
#
# Usage:
#   ./opencode-harness.sh "Build a project management tool"
#   ./opencode-harness.sh "Build a DAW in the browser" 5
#   HARNESS_ON_MAX_ROUNDS=advance ./opencode-harness.sh "..."
#
# Agent watchdog (default on — stops hung opencode run after artifacts land):
#   HARNESS_AGENT_WATCHDOG=0          wait for opencode to exit on its own
#   HARNESS_AGENT_POLL_SEC=15         seconds between artifact checks
#   HARNESS_AGENT_STABLE_POLLS=2      consecutive ready polls before stopping
#   HARNESS_PHASE_TIMEOUT=7200        wall-clock seconds per run (0 = no limit)
#   HARNESS_OPENCODE_ATTACH=http://localhost:4096  attach to opencode serve (optional)
#
# Setup (first time):
#   bun install && bun run setup
#
# See README.md — Retrospector/learning loop is not included in this repo.

set -euo pipefail

PROMPT="${1:?Usage: ./opencode-harness.sh \"your product prompt here\" [max_qa_rounds]}"
MAX_QA_ROUNDS="${2:-3}"
HARNESS_MODEL="${HARNESS_MODEL:-anthropic/claude-sonnet-4-5}"
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
HARNESS_SOURCE="opencode-harness.sh"

cd "$PROJECT_DIR"
source "$PROJECT_DIR/scripts/harness-common.sh"

harness_validate_run_config "$MAX_QA_ROUNDS"
harness_preflight opencode node || exit 1

# ─── Phase runner (contract consumed by harness-common.sh) ──────────
run_phase_agent() {
  run_opencode_agent "$@"
}

harness_ensure_guardrails

echo "============================================"
echo "  COMBINED OPENCODE HARNESS: Build + Guardrails"
echo "  Prompt: $PROMPT"
echo "  Max QA rounds per sprint: $MAX_QA_ROUNDS"
echo "  On max rounds: $HARNESS_ON_MAX_ROUNDS"
echo "  Model: $HARNESS_MODEL"
harness_print_pause_config
echo "============================================"

harness_run_planning_phase "$PROMPT"
harness_run_sprint_loop "$MAX_QA_ROUNDS"
harness_print_summary "OPENCODE HARNESS COMPLETE"
