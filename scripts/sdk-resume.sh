#!/bin/bash
# sdk-resume.sh — Resolve next deterministic harness action

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

node sdk-orchestrator/cli.mjs resume "$@"
