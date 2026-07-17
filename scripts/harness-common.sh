# harness-common.sh — Shared sprint helpers for opencode-harness.sh
#
# Sourced by opencode-harness.sh. Do not execute directly.

PROJECT_DIR="${PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"

# Default: halt on max QA rounds (aligns with guardrail philosophy).
# Set HARNESS_ON_MAX_ROUNDS=advance to allow advancing with known failures.
HARNESS_ON_MAX_ROUNDS="${HARNESS_ON_MAX_ROUNDS:-halt}"

# Pause controls (token/cost management)
# HARNESS_PAUSE: off (default) | sprint | phase | design
#   sprint — confirm before each new sprint (qa round 1 only)
#   phase  — confirm before every Planner/Generator/Evaluator invocation
#   design — confirm after design-scout (when docs/design-options.md exists, no sprint-status)
# HARNESS_YES=1 — skip all pause prompts (fully autonomous)
# HARNESS_MAX_SPRINTS_PER_RUN=N — stop after N sprints in this invocation (resume later)
# HARNESS_USAGE_CHECK=1 — run scripts/usage-check.sh at sprint boundaries
# HARNESS_USAGE_CMD='...' — custom command; exit 1 when budget is low
# First-run safety: on a fresh project (no docs/sprint-status.md yet) with no
# explicit HARNESS_PAUSE, pause before each sprint so the user sees the plan
# and cost trajectory before granting full autonomy. HARNESS_PAUSE=off or
# HARNESS_YES=1 restores unattended behavior.
HARNESS_FIRST_RUN_PAUSE=0
if [ -z "${HARNESS_PAUSE:-}" ] && [ ! -f docs/sprint-status.md ]; then
  HARNESS_PAUSE="sprint"
  HARNESS_FIRST_RUN_PAUSE=1
fi
HARNESS_PAUSE="${HARNESS_PAUSE:-off}"
HARNESS_YES="${HARNESS_YES:-0}"
HARNESS_USAGE_CHECK="${HARNESS_USAGE_CHECK:-0}"
HARNESS_MAX_SPRINTS_PER_RUN="${HARNESS_MAX_SPRINTS_PER_RUN:-}"
SPRINTS_COMPLETED_THIS_RUN=0

# ─── Pause / budget helpers ────────────────────────────────────────────

harness_should_pause_sprint() {
  [[ "$HARNESS_PAUSE" == "sprint" || "$HARNESS_PAUSE" == "phase" ]]
}

harness_should_pause_phase() {
  [[ "$HARNESS_PAUSE" == "phase" || "$HARNESS_PAUSE" == "design" ]]
}

harness_should_pause_design() {
  [[ "$HARNESS_PAUSE" == "design" ]]
}

harness_prompt_continue() {
  local label="$1"
  local next_sprint="${2:-}"

  if [ "$HARNESS_YES" = "1" ]; then
    return 0
  fi

  echo ""
  echo "⏸  Checkpoint: $label"
  if [ -n "$next_sprint" ] && [ "$next_sprint" != "done" ]; then
    echo "   Next: Sprint $next_sprint"
  fi
  echo "   State saved in docs/sprint-status.md — resume with the same harness command."
  echo ""
  read -r -p "Continue? [y/N/a=all remaining sprints] " answer </dev/tty || answer=""
  case "$answer" in
    y|Y|yes|Yes)
      return 0
      ;;
    a|A|all)
      HARNESS_YES=1
      export HARNESS_YES
      echo "  → Continuing without further prompts this run."
      return 0
      ;;
    *)
      echo ""
      echo "Paused. Re-run ./opencode-harness.sh with the same prompt to resume."
      exit 0
      ;;
  esac
}

harness_check_usage() {
  local label="$1"

  if [ "$HARNESS_USAGE_CHECK" != "1" ]; then
    return 0
  fi

  echo ""
  echo "▶ Usage check ($label)..."
  if bash "$PROJECT_DIR/scripts/usage-check.sh"; then
    return 0
  fi

  echo ""
  echo "⚠ Usage check reported low budget."
  if [ "$HARNESS_YES" = "1" ]; then
    echo "  HARNESS_YES=1 set — continuing anyway."
    return 0
  fi

  harness_prompt_continue "usage warning — $label"
}

harness_maybe_pause_sprint() {
  local sprint="$1"
  local total="$2"

  harness_check_usage "before sprint $sprint/$total"

  if harness_should_pause_sprint; then
    harness_prompt_continue "before Sprint $sprint / $total" "$sprint"
  fi
}

harness_maybe_pause_phase() {
  local phase="$1"
  local sprint="${2:-}"
  local round="${3:-}"

  if ! harness_should_pause_phase; then
    return 0
  fi

  local label="$phase"
  if [ -n "$sprint" ]; then
    label="$phase (Sprint $sprint"
    if [ -n "$round" ]; then
      label="$label, Round $round"
    fi
    label="$label)"
  fi

  harness_prompt_continue "$label" "$sprint"
}

harness_track_sprint_finished() {
  SPRINTS_COMPLETED_THIS_RUN=$((SPRINTS_COMPLETED_THIS_RUN + 1))

  if [ -z "$HARNESS_MAX_SPRINTS_PER_RUN" ]; then
    return 0
  fi

  if [ "$SPRINTS_COMPLETED_THIS_RUN" -ge "$HARNESS_MAX_SPRINTS_PER_RUN" ]; then
    echo ""
    echo "⏸ Reached HARNESS_MAX_SPRINTS_PER_RUN=$HARNESS_MAX_SPRINTS_PER_RUN for this invocation."
    echo "   Completed $SPRINTS_COMPLETED_THIS_RUN sprint(s) this run."
    echo "   Re-run with the same prompt to continue."
    exit 0
  fi
}

harness_print_pause_config() {
  if [ "$HARNESS_PAUSE" != "off" ] || [ -n "$HARNESS_MAX_SPRINTS_PER_RUN" ] || [ "$HARNESS_USAGE_CHECK" = "1" ]; then
    if [ "$HARNESS_FIRST_RUN_PAUSE" = "1" ]; then
      echo "  First run detected: pausing before each sprint so you can review the plan and cost."
      echo "  Set HARNESS_PAUSE=off (or HARNESS_YES=1) for fully autonomous runs."
    fi
    echo "  Pause mode: $HARNESS_PAUSE"
    if [ -n "$HARNESS_MAX_SPRINTS_PER_RUN" ]; then
      echo "  Max sprints this run: $HARNESS_MAX_SPRINTS_PER_RUN"
    fi
    if [ "$HARNESS_USAGE_CHECK" = "1" ]; then
      echo "  Usage check: enabled"
    fi
    if [ "$HARNESS_YES" = "1" ]; then
      echo "  Auto-continue: yes (HARNESS_YES=1)"
    fi
  fi
}

# ─── Helper: get current sprint number from sprint-status.md ─────────
# Only "Pass" and "Skipped" advance past a sprint. Anything that is not a
# recognized in-flight status (casing variants like "PASS", ad-hoc values
# like "Blocked") is treated as the current sprint with a loud warning —
# silently skipping it would advance past unfinished work.
get_current_sprint() {
  if [ ! -f docs/sprint-status.md ]; then
    echo "0"
    return
  fi
  local sprint
  sprint=$(grep -E "^\|\s*[0-9]+" docs/sprint-status.md | while IFS='|' read -r _ num _ status _; do
    num=$(echo "$num" | xargs)
    status=$(echo "$status" | xargs)
    if [[ "$status" == "Pass" || "$status" == "Skipped" ]]; then
      continue
    fi
    # Leading parens on the patterns: bash 3.2 can't parse `pattern)` case
    # arms inside a $( ) command substitution.
    case "$status" in
      ("Not started"|"In progress"|"Ready for QA"|"Fail") ;;
      (*)
        echo "WARNING: Sprint $num has unrecognized status '$status' in docs/sprint-status.md — treating it as the current sprint. Fix the status row if this is wrong." >&2
        ;;
    esac
    echo "$num"
    break
  done)
  echo "${sprint:-done}"
}

# ─── Helper: get total sprint count ──────────────────────────────────
get_total_sprints() {
  if [ ! -f docs/sprint-status.md ]; then
    echo "0"
    return
  fi
  # grep -c prints the count (0 included) but exits 1 on zero matches;
  # capture it so we never emit "0" twice.
  local count
  count=$(grep -cE "^\|\s*[0-9]+" docs/sprint-status.md 2>/dev/null || true)
  echo "${count:-0}"
}

# ─── Helper: validate numeric run configuration ───────────────────────
harness_require_positive_int() {
  local name="$1"
  local value="${2:-}"
  case "$value" in
    ''|*[!0-9]*)
      echo "ERROR: $name must be a positive integer, got '$value'." >&2
      return 1
      ;;
  esac
  if [ "$value" -lt 1 ]; then
    echo "ERROR: $name must be at least 1, got '$value'." >&2
    return 1
  fi
  return 0
}

# Called by every entrypoint after parsing args. Exits on bad config so a
# typo like `./opencode-harness.sh "x" abc` fails fast instead of looping forever.
harness_validate_run_config() {
  local max_rounds="$1"
  harness_require_positive_int "MAX_QA_ROUNDS" "$max_rounds" || exit 1
  if [ -n "${HARNESS_MAX_SPRINTS_PER_RUN:-}" ]; then
    harness_require_positive_int "HARNESS_MAX_SPRINTS_PER_RUN" "$HARNESS_MAX_SPRINTS_PER_RUN" || exit 1
  fi
}

# ─── Helper: check if sprint passed ─────────────────────────────────
# The sprint-status row is the source of truth (a loose grep on the QA
# report matches failing phrasings like "Result: FAIL — 12 of 15 criteria
# passed"). The report is only consulted as a FAIL cross-check.
sprint_passed() {
  local sprint_num="$1"
  local report="docs/qa-report-sprint-${sprint_num}.md"
  local row_status
  row_status="$(harness_get_sprint_row_status "$sprint_num")"
  [ "$row_status" = "Pass" ] || return 1
  if [ -f "$report" ] && grep -qiE 'Result[^[:alnum:]]*FAIL' "$report" 2>/dev/null; then
    echo "WARNING: sprint-status row says Pass but $report records Result: FAIL — not counting sprint $sprint_num as passed." >&2
    return 1
  fi
  return 0
}

# ─── Helper: run pre-QA mechanical gate ───────────────────────────────
run_pre_qa_gate() {
  local sprint="$1"
  bash "$PROJECT_DIR/scripts/pre-qa-gate.sh" "$sprint"
}

# ─── Helper: validate phase via harness-lib ───────────────────────────
validate_phase() {
  local phase="$1"
  local sprint="${2:-1}"
  if [ -f "$PROJECT_DIR/scripts/harness-lib/cli.mjs" ] && command -v node >/dev/null 2>&1; then
    node "$PROJECT_DIR/scripts/harness-lib/cli.mjs" validate --phase "$phase" --sprint "$sprint"
  fi
}

# ─── Helper: write workflow handoff manifest ─────────────────────────
write_handoff() {
  local phase="$1"
  local sprint="$2"
  local qa_round="$3"
  local next="$4"
  shift 4
  local artifacts="$*"

  if [ -f "$PROJECT_DIR/scripts/harness-lib/cli.mjs" ] && command -v node >/dev/null 2>&1; then
    node "$PROJECT_DIR/scripts/harness-lib/cli.mjs" handoff-write \
      --phase "$phase" \
      --sprint "$sprint" \
      --qa-round "$qa_round" \
      --next "$next" \
      --source "${HARNESS_SOURCE:-opencode-harness.sh}" \
      --artifacts "$artifacts"
  fi
}

# ─── Helper: log repeat QA failure to anti-slop cache ─────────────────
log_qa_failure() {
  local sprint="$1"
  local qa_round="$2"
  local cache_dir=".gc-cache"
  local cache_file="$cache_dir/weekly-report.jsonl"
  mkdir -p "$cache_dir"

  printf '{"ts":"%s","category":"qa-failure","sprint":%s,"round":%s,"report":"docs/qa-report-sprint-%s.md","description":"Sprint %s failed QA round %s"}\n' \
    "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
    "$sprint" \
    "$qa_round" \
    "$sprint" \
    "$sprint" \
    "$qa_round" \
    >> "$cache_file"
}

# ─── Helper: mark sprint skipped after max QA rounds (advance policy) ───
mark_sprint_skipped() {
  local sprint="$1"
  local notes="${2:-Max QA rounds reached; advanced with known issues}"

  if [ -f "$PROJECT_DIR/scripts/harness-lib/cli.mjs" ] && command -v node >/dev/null 2>&1; then
    node "$PROJECT_DIR/scripts/harness-lib/cli.mjs" sprint-mark-skipped \
      --sprint "$sprint" \
      --notes "$notes"
    return 0
  fi

  echo "ERROR: Node.js is required to mark sprint $sprint as Skipped (scripts/harness-lib/cli.mjs)."
  return 1
}

# ─── Agent watchdog (opencode-harness.sh) ───────────────────────────────────────────────
# CLI agents often finish writing artifacts but keep MCP/dev child
# processes alive. Poll for canonical phase outputs and stop the agent
# process group when they are stable.
#
# HARNESS_AGENT_WATCHDOG=0     disable (wait for opencode to exit on its own)
# HARNESS_AGENT_POLL_SEC=15    seconds between artifact checks
# HARNESS_AGENT_STABLE_POLLS=2 consecutive ready polls before stopping agent
# HARNESS_PHASE_TIMEOUT=7200   wall-clock seconds per agent run (0 = no limit)

harness_get_sprint_row_status() {
  local sprint_num="$1"
  awk -F'|' -v s="$sprint_num" '
    /^\|[[:space:]]*[0-9]+/ {
      num=$2; st=$4
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", num)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", st)
      if (num == s) { print st; exit }
    }
  ' docs/sprint-status.md 2>/dev/null
}

harness_phase_artifacts_ready() {
  local phase="$1"
  local sprint="${2:-1}"
  local row_status=""

  case "$phase" in
    planner)
      if [[ -f docs/design-options.md && ! -f docs/sprint-status.md ]]; then
        return 0
      fi
      [[ -f docs/spec.md && -f docs/sprint-plan.md && -f docs/sprint-status.md ]]
      ;;
    generator)
      [[ -f "docs/sprint-${sprint}-contract.md" && -f docs/sprint-status.md ]] || return 1
      row_status="$(harness_get_sprint_row_status "$sprint")"
      [[ "$row_status" == "Ready for QA" ]]
      ;;
    evaluator)
      [[ -f "docs/qa-report-sprint-${sprint}.md" && -f docs/sprint-status.md ]] || return 1
      grep -qiE 'Result:[[:space:]]*(PASS|FAIL)' "docs/qa-report-sprint-${sprint}.md" || return 1
      row_status="$(harness_get_sprint_row_status "$sprint")"
      [[ "$row_status" == "Pass" || "$row_status" == "Fail" ]]
      ;;
    *)
      return 1
      ;;
  esac
}

# mtime of a file in epoch seconds; empty when the file doesn't exist.
# BSD stat first (macOS), GNU stat fallback.
harness_report_mtime() {
  local file="$1"
  if [ ! -f "$file" ]; then
    echo ""
    return 0
  fi
  stat -f %m "$file" 2>/dev/null || stat -c %Y "$file" 2>/dev/null || echo ""
}

# Watchdog readiness = artifacts ready AND (for the evaluator) the QA report
# was actually (re)written this run. On QA round 2+ the previous round's
# docs/qa-report-sprint-N.md already satisfies harness_phase_artifacts_ready,
# so without the mtime check the watchdog could kill the evaluator before it
# rewrites the report.
harness_watchdog_phase_ready() {
  local phase="$1"
  local sprint="$2"
  local baseline_mtime="${3:-}"

  harness_phase_artifacts_ready "$phase" "$sprint" || return 1

  if [ "$phase" = "evaluator" ] && [ -n "$baseline_mtime" ]; then
    local current_mtime
    current_mtime="$(harness_report_mtime "docs/qa-report-sprint-${sprint}.md")"
    if [ "$current_mtime" = "$baseline_mtime" ]; then
      return 1
    fi
  fi
  return 0
}

# Overridable in tests. True when any git process is still running.
harness_git_processes_running() {
  pgrep -x git >/dev/null 2>&1
}

# After the watchdog TERM/KILLs an agent, a git command it was running may
# leave .git/index.lock behind. Remove it if and only if no git process is
# still running.
harness_cleanup_git_index_lock() {
  local git_dir
  git_dir="$(git rev-parse --git-dir 2>/dev/null)" || return 0
  [ -n "$git_dir" ] || return 0
  [ -e "$git_dir/index.lock" ] || return 0

  if harness_git_processes_running; then
    echo "  → Leaving $git_dir/index.lock in place (a git process is still running)."
    return 0
  fi

  rm -f "$git_dir/index.lock"
  echo "  → Removed stale $git_dir/index.lock left behind by the stopped agent."
}

harness_stop_agent_process_group() {
  local agent_pid="$1"
  local agent_pgid="$2"
  local reason="$3"

  echo ""
  echo "▶ Agent watchdog: $reason"

  if [ -n "$agent_pgid" ]; then
    kill -TERM "-$agent_pgid" 2>/dev/null || kill -TERM "$agent_pid" 2>/dev/null || true
  else
    kill -TERM "$agent_pid" 2>/dev/null || true
  fi

  local grace=0
  while kill -0 "$agent_pid" 2>/dev/null && [ "$grace" -lt 30 ]; do
    sleep 1
    grace=$((grace + 1))
  done

  if kill -0 "$agent_pid" 2>/dev/null; then
    echo "  → Force-stopping hung agent (PID $agent_pid)..."
    if [ -n "$agent_pgid" ]; then
      kill -KILL "-$agent_pgid" 2>/dev/null || kill -KILL "$agent_pid" 2>/dev/null || true
    else
      kill -KILL "$agent_pid" 2>/dev/null || true
    fi
  fi

  harness_cleanup_git_index_lock
}

run_agent_with_watchdog() {
  local phase="${1:?phase required}"
  local sprint="${2:?sprint required}"
  shift 2
  local -a agent_cmd=("$@")

  if [ "${HARNESS_AGENT_WATCHDOG:-1}" = "0" ]; then
    "${agent_cmd[@]}"
    return $?
  fi

  local poll_sec="${HARNESS_AGENT_POLL_SEC:-15}"
  local stable_needed="${HARNESS_AGENT_STABLE_POLLS:-2}"
  local timeout_sec="${HARNESS_PHASE_TIMEOUT:-7200}"
  local started_at=$SECONDS
  local stable_count=0
  local agent_pid=""
  local agent_pgid=""
  local job_control_was_on=0
  local report_baseline_mtime=""

  # Guard against the round-2+ stale-report race: remember when the QA
  # report was last written so only a rewritten report counts as ready.
  if [ "$phase" = "evaluator" ]; then
    report_baseline_mtime="$(harness_report_mtime "docs/qa-report-sprint-${sprint}.md")"
  fi

  case "$-" in
    *m*) job_control_was_on=1 ;;
  esac

  set -m
  "${agent_cmd[@]}" &
  agent_pid=$!
  agent_pgid="$(ps -o pgid= -p "$agent_pid" 2>/dev/null | tr -d ' ')"

  while kill -0 "$agent_pid" 2>/dev/null; do
    if harness_watchdog_phase_ready "$phase" "$sprint" "$report_baseline_mtime"; then
      stable_count=$((stable_count + 1))
      if [ "$stable_count" -ge "$stable_needed" ]; then
        harness_stop_agent_process_group "$agent_pid" "$agent_pgid" \
          "phase artifacts complete (${phase}, sprint ${sprint})"
        break
      fi
    else
      stable_count=0
    fi

    if [ "$timeout_sec" -gt 0 ] && [ $((SECONDS - started_at)) -ge "$timeout_sec" ]; then
      harness_stop_agent_process_group "$agent_pid" "$agent_pgid" \
        "wall-clock timeout (${timeout_sec}s)"
      break
    fi

    sleep "$poll_sec"
  done

  local exit_code=0
  wait "$agent_pid" 2>/dev/null || exit_code=$?

  if [ "$job_control_was_on" -eq 0 ]; then
    set +m
  fi

  if harness_watchdog_phase_ready "$phase" "$sprint" "$report_baseline_mtime"; then
    echo "✓ Phase artifacts verified (${phase}, sprint ${sprint})"
    return 0
  fi

  return "$exit_code"
}

run_opencode_agent() {
  local phase="${1:?phase required (planner|generator|evaluator)}"
  local sprint="${2:?sprint required}"
  local phase_prompt="${3:?prompt required}"
  local agent_name="${HARNESS_OPENCODE_AGENT:-$phase}"

  local opencode_args=(
    run
    --dir "$PROJECT_DIR"
    --dangerously-skip-permissions
    --agent "$agent_name"
  )
  if [ -n "${HARNESS_MODEL:-}" ]; then
    opencode_args+=(--model "$HARNESS_MODEL")
  fi
  if [ -n "${HARNESS_OPENCODE_ATTACH:-}" ]; then
    opencode_args+=(--attach "$HARNESS_OPENCODE_ATTACH")
  fi
  opencode_args+=("$phase_prompt")

  run_agent_with_watchdog "$phase" "$sprint" opencode "${opencode_args[@]}"
}

# ─── Helper: handle max QA rounds reached ────────────────────────────
# Returns 0 to break inner loop (advance), 1 to halt harness
handle_max_rounds() {
  local sprint="$1"
  # The sprint loop already logged this round via log_qa_failure — don't double-count.

  if [ "$HARNESS_ON_MAX_ROUNDS" = "advance" ]; then
    if ! mark_sprint_skipped "$sprint"; then
      echo "  → Failed to mark Sprint $sprint as Skipped."
      exit 1
    fi
    echo "  → HARNESS_ON_MAX_ROUNDS=advance: marked Sprint $sprint as Skipped; moving to next sprint."
    return 0
  fi

  if declare -F harness_run_retro_hook >/dev/null; then
    harness_run_retro_hook
  fi

  echo ""
  echo "⛔ HALTED: Max QA rounds reached for Sprint $sprint."
  echo "  Review docs/qa-report-sprint-${sprint}.md"
  echo "  Fix issues and re-run: ./opencode-harness.sh \"<same prompt>\""
  echo "  Or advance anyway: HARNESS_ON_MAX_ROUNDS=advance ./opencode-harness.sh \"<prompt>\""
  exit 1
}

# ─── Design brief helpers ─────────────────────────────────────────────

harness_design_file_has_content() {
  local file_path="$1"
  [[ -f "$file_path" ]] || return 1
  grep -q '[^[:space:]]' "$file_path" 2>/dev/null
}

harness_has_design_brief_input() {
  if harness_design_file_has_content "design/brief.md"; then
    return 0
  fi
  if harness_design_file_has_content "design/constraints.md"; then
    return 0
  fi
  if harness_design_file_has_content "brand-guidelines.md"; then
    return 0
  fi
  if harness_design_file_has_content "agents/brand-guidelines.md"; then
    return 0
  fi
  if [ -d design/references ]; then
    local asset
    for asset in design/references/*.{png,jpg,jpeg,webp,svg}; do
      [ -f "$asset" ] || continue
      return 0
    done
  fi
  return 1
}

harness_has_selected_direction() {
  harness_design_file_has_content "design/selected-direction.md"
}

harness_is_design_scout_complete() {
  [[ -f docs/design-options.md ]] && [[ ! -f docs/sprint-status.md ]]
}

harness_is_planning_complete() {
  [[ -f docs/spec.md ]] && [[ -f docs/sprint-status.md ]]
}

harness_get_planner_mode() {
  if harness_is_planning_complete; then
    echo "complete"
    return
  fi
  if harness_has_design_brief_input; then
    echo "full"
    return
  fi
  if harness_has_selected_direction && [[ -f docs/design-options.md ]]; then
    echo "finalize"
    return
  fi
  if [ "$HARNESS_YES" = "1" ]; then
    echo "full"
    return
  fi
  echo "scout"
}

harness_planner_mode_instructions() {
  local mode="$1"
  case "$mode" in
    scout)
      cat <<'EOF'
DESIGN SCOUT MODE: No user design brief was provided.

Write ONLY docs/design-options.md using the shape in docs/templates/design-options.md.
Include exactly 3 materially different design directions (Option A, B, C). Each must have
aesthetic, palette, typography, motion, signature element, and rationale.

Do NOT write docs/sprint-plan.md or docs/sprint-status.md.
Do NOT write a full docs/spec.md — at most a one-paragraph product stub if needed for context.

Stop after docs/design-options.md is complete. The harness will pause for the user to pick a direction.
EOF
      ;;
    finalize)
      cat <<'EOF'
DESIGN FINALIZE MODE: The user selected a design direction.

Read design/selected-direction.md and docs/design-options.md.
Merge the chosen direction (plus any user tweaks) into the final product spec.
Treat the selection as binding — do not substitute a different aesthetic.

Write docs/spec.md, docs/sprint-plan.md, docs/sprint-status.md, and update AGENTS.md.
EOF
      ;;
    full|*)
      cat <<'EOF'
FULL PLAN MODE: Write docs/spec.md, docs/sprint-plan.md, docs/sprint-status.md, and update AGENTS.md.
If a user design brief or reference assets were provided, follow them exactly — expand only where the user was silent.
EOF
      ;;
  esac
}

collect_design_brief_context() {
  local sections=""
  local file content rel_path asset

  for file in design/brief.md design/constraints.md; do
    if harness_design_file_has_content "$file"; then
      rel_path="$file"
      content="$(cat "$file")"
      sections="${sections}### ${rel_path}

${content}

"
    fi
  done

  for file in brand-guidelines.md agents/brand-guidelines.md; do
    if harness_design_file_has_content "$file"; then
      content="$(cat "$file")"
      sections="${sections}### ${file} (legacy brand guidelines)

${content}

"
    fi
  done

  if harness_design_file_has_content "design/selected-direction.md"; then
    content="$(cat design/selected-direction.md)"
    sections="${sections}### design/selected-direction.md

${content}

"
  fi

  if [ -d design/references ]; then
    local refs=""
    for asset in design/references/*; do
      [ -f "$asset" ] || continue
      case "$asset" in
        *.png|*.jpg|*.jpeg|*.webp|*.svg)
          refs="${refs}- ${asset}
"
          ;;
      esac
    done
    if [ -n "$refs" ]; then
      sections="${sections}### Reference assets (read/view these files)

${refs}
"
    fi
  fi

  if [ -z "$sections" ]; then
    return 0
  fi

  printf '%s\n' "## User design input (authoritative — do not override)

${sections}"
}

harness_build_planner_prompt() {
  local product_prompt="$1"
  local mode
  local brief_context=""
  local mode_instructions
  local persona

  mode="$(harness_get_planner_mode)"
  mode_instructions="$(harness_planner_mode_instructions "$mode")"
  brief_context="$(collect_design_brief_context || true)"
  persona="$(cat agents/planner.md)"

  printf '%s\n\n' "$persona"
  printf '%s\n' "$GUARDRAIL_CONTEXT"
  printf '%s\n' "$LESSONS_CONTEXT"
  printf '%s\n' "Read harness/workspace-template.md for optional domain-scoped monorepo layout."
  printf '%s\n' "Read all criteria files in agents/criteria/ to understand what the evaluator will grade."
  printf '%s\n' "Read docs/templates/design-options.md when in design-scout mode."
  printf '%s\n' "If design/references/ contains images, read/view them before defining the design language."
  printf '\n%s\n\n' "$mode_instructions"
  if [ -n "$brief_context" ]; then
    printf '%s\n\n' "$brief_context"
  fi
  printf '%s\n' "Prompt: $product_prompt"
  printf '%s\n' "$HARNESS_AUTONOMOUS_SUFFIX"
}

harness_handle_design_scout_complete() {
  if ! harness_is_design_scout_complete; then
    return 1
  fi

  echo ""
  echo "▶ DESIGN SCOUT COMPLETE"
  echo "  Three design directions written to docs/design-options.md"
  echo ""
  echo "  Next steps:"
  echo "    1. Review docs/design-options.md"
  echo "    2. Create design/selected-direction.md with your pick (e.g. 'Option B — Momentum Dark')"
  echo "    3. Re-run: ./opencode-harness.sh \"<same prompt>\""
  echo ""

  if harness_should_pause_design; then
    harness_prompt_continue "design direction selection" ""
  fi

  exit 0
}

# ─── Shared agent context blocks ─────────────────────────────────────
GUARDRAIL_CONTEXT="
Read harness/AGENT-INSTRUCTIONS.md before acting. Follow sandbox, lint, and commit rules."

LESSONS_CONTEXT="
Read harness/LESSONS.md — distilled lessons from previous runs' QA failures. Treat the entries in your phase's section as binding instructions, not suggestions."

GENERATOR_LINT_CONTEXT="
Before marking Ready for QA:
1. Run 'bun lint:harness' (or npm run lint:harness) and fix all issues.
2. If app source exists, ensure package.json has test:unit and test:e2e (see docs/templates/app-package-scripts.md) — do not run test:harness via npm test.
3. Commit with messages that pass the pre-commit hook (bun run setup installs it).
4. Do not stage .env files or hardcode secrets."

# [N] is replaced with the sprint number by harness_build_evaluator_prompt.
EVALUATOR_MECHANICAL_CONTEXT="
Read docs/mechanical-checks-sprint-[N].md for automated lint/artifact results.
Include a 'Mechanical Checks' section in your QA report referencing that file.
Also review against review-personas/security.md and review-personas/frontend-architecture.md checklists where applicable."

HARNESS_AUTONOMOUS_SUFFIX="
AUTONOMOUS MODE: Do not ask for confirmation or pause for human review. After writing the sprint contract, implement it immediately in the same session. Complete all required artifacts and status updates before finishing."

# ─── Centralized phase prompts ────────────────────────────────────────
# Single source of truth for Generator/Evaluator prompts used by
# opencode-harness.sh (includes lessons ledger context and autonomous suffix).

harness_build_generator_prompt() {
  local sprint="${1:?sprint required}"
  local qa_context=""
  local mech_context=""

  if [ -f "docs/qa-report-sprint-${sprint}.md" ]; then
    qa_context="

IMPORTANT: The evaluator found issues in the last round. Read docs/qa-report-sprint-${sprint}.md and fix ALL failures before proceeding to new features."
  fi
  if [ -f "docs/mechanical-checks-sprint-${sprint}.md" ] && grep -qi "Result:.*FAIL" "docs/mechanical-checks-sprint-${sprint}.md" 2>/dev/null; then
    mech_context="

IMPORTANT: Pre-QA mechanical checks failed. Read docs/mechanical-checks-sprint-${sprint}.md and fix ALL listed issues."
  fi

  cat <<EOF
$(cat agents/generator.md)

$GUARDRAIL_CONTEXT
$GENERATOR_LINT_CONTEXT
$LESSONS_CONTEXT
Read docs/spec.md for the full spec.
Read docs/sprint-plan.md for the sprint breakdown.
Read docs/sprint-status.md to find the current sprint.
Read all criteria files in agents/criteria/.
Read AGENTS.md for the design language and stack.
Check git log for what's already built.
$qa_context
$mech_context

You are building Sprint $sprint. Write the sprint contract to docs/sprint-${sprint}-contract.md if it doesn't exist, then implement it. Commit to git after each meaningful unit of work.

After building, write your self-evaluation to the end of docs/sprint-${sprint}-contract.md and update docs/sprint-status.md to 'Ready for QA'.
$HARNESS_AUTONOMOUS_SUFFIX
EOF
}

harness_build_evaluator_prompt() {
  local sprint="${1:?sprint required}"
  local mechanical_context="${EVALUATOR_MECHANICAL_CONTEXT//\[N\]/$sprint}"

  cat <<EOF
$(cat agents/evaluator.md)

$GUARDRAIL_CONTEXT
$LESSONS_CONTEXT
Read docs/spec.md for the product context and design language.
Read docs/sprint-${sprint}-contract.md for the acceptance criteria.
Read all criteria files in agents/criteria/.
Read the Generator's self-evaluation at the bottom of the contract.
$mechanical_context

Start the application and test it thoroughly using Playwright.
Grade using the weighted scoring formula in your instructions.
Write your full report to docs/qa-report-sprint-${sprint}.md.
Update docs/sprint-status.md with the result.

Be skeptical. Find problems. Do not praise mediocre work.
$HARNESS_AUTONOMOUS_SUFFIX
EOF
}

# ─── Shared runner plumbing ───────────────────────────────────────────

# Install git hooks when missing. Uses `git rev-parse` (not `[ -d .git ]`)
# so it also works from a git worktree, where .git is a file.
harness_ensure_guardrails() {
  local hooks_dir
  if ! git rev-parse --git-dir >/dev/null 2>&1; then
    {
      echo "⚠ WARNING: this is not a git repository — guardrails are OFF."
      echo "  No pre-commit hook, secret scan, or lint gate will run on agent commits."
      echo "  Fix: git init && bun install && bun run setup, then re-run the harness."
    } >&2
    return 0
  fi
  hooks_dir="$(git rev-parse --git-path hooks)"
  if [ ! -f "$hooks_dir/pre-commit" ]; then
    echo "▶ Installing harness guardrails (git hooks)..."
    bash "$PROJECT_DIR/scripts/install-harness.sh"
  fi
}

# ─── Preflight: fail fast on missing tools instead of mid-run ─────────
# Usage: harness_preflight <required-cli...>
harness_preflight() {
  local missing=() cli
  for cli in "$@"; do
    command -v "$cli" >/dev/null 2>&1 || missing+=("$cli")
  done
  if [ "${#missing[@]}" -gt 0 ]; then
    {
      echo "ERROR: required tool(s) not on PATH: ${missing[*]}"
      for cli in "${missing[@]}"; do
        case "$cli" in
          node)     echo "  node     → install Node.js 20+ (validation, handoffs, and state helpers all need it)" ;;
          opencode) echo "  opencode → install the OpenCode CLI (https://opencode.ai)" ;;
        esac
      done
    } >&2
    return 1
  fi
  if ! command -v gitleaks >/dev/null 2>&1; then
    {
      echo "⚠ gitleaks not installed — the secret scan falls back to a basic 3-pattern regex."
      echo "  Recommended: brew install gitleaks"
    } >&2
  fi
  return 0
}

# Post-QA handoff manifest.
harness_post_qa_write() {
  local sprint="$1"
  local qa_round="$2"
  if [ -f "$PROJECT_DIR/scripts/harness-lib/cli.mjs" ] && command -v node >/dev/null 2>&1; then
    node "$PROJECT_DIR/scripts/harness-lib/cli.mjs" post-qa-write \
      --sprint "$sprint" \
      --qa-round "$qa_round" \
      --source "${HARNESS_SOURCE:-opencode-harness.sh}"
  fi
}

# ─── Shared Phase 1 + sprint loop ─────────────────────────────────────
# The entrypoint MUST define, before calling these:
#
#   run_phase_agent <phase> <sprint> <prompt>
#     Runs one agent invocation via run_opencode_agent
#     (which wraps run_agent_with_watchdog).

harness_run_planning_phase() {
  local product_prompt="${1:?product prompt required}"
  local current planner_mode

  if harness_is_planning_complete; then
    echo ""
    echo "▶ RESUMING: Found existing spec and sprint status"
    current=$(get_current_sprint)
    if [ "$current" = "done" ]; then
      echo "  All sprints are complete!"
      exit 0
    fi
    echo "  Resuming from sprint $current"
  elif harness_is_design_scout_complete && ! harness_has_selected_direction; then
    harness_handle_design_scout_complete
  else
    echo ""
    echo "▶ PHASE 1: PLANNER"
    planner_mode="$(harness_get_planner_mode)"
    echo "  Planner mode: $planner_mode"
    echo "  Expanding prompt into product spec..."
    echo ""

    harness_maybe_pause_phase "planner"

    run_phase_agent planner 1 "$(harness_build_planner_prompt "$product_prompt")"

    validate_phase planner 1

    if [ "$planner_mode" = "scout" ]; then
      if [ ! -f docs/design-options.md ]; then
        echo "ERROR: Planner did not produce docs/design-options.md"
        exit 1
      fi
      harness_handle_design_scout_complete
    else
      if [ ! -f docs/spec.md ]; then
        echo "ERROR: Planner did not produce docs/spec.md"
        exit 1
      fi

      write_handoff planner 1 1 run-generator \
        "docs/spec.md,docs/sprint-plan.md,docs/sprint-status.md,AGENTS.md"

      echo ""
      echo "✓ Spec written to docs/spec.md"
    fi
  fi
}

harness_run_sprint_loop() {
  local max_rounds="${1:-${MAX_QA_ROUNDS:-3}}"
  local current total qa_round sprint_handled
  local last_handled_sprint=""

  echo ""
  echo "▶ PHASE 2: BUILD + QA LOOP"
  echo ""

  harness_maybe_pause_phase "build loop"

  while true; do
    current=$(get_current_sprint)
    total=$(get_total_sprints)

    if [ "$current" = "done" ]; then
      echo ""
      echo "✅ All sprints complete!"
      break
    fi

    # Progress guard: a sprint that was handled to completion (passed or
    # advanced) must never be re-selected. If it is, the sprint artifacts
    # are inconsistent and re-looping would spin forever.
    if [ -n "$last_handled_sprint" ] && [ "$current" = "$last_handled_sprint" ]; then
      echo "" >&2
      echo "ERROR: Sprint $current was already handled to completion this run, but docs/sprint-status.md still selects it as the current sprint." >&2
      echo "       Sprint artifacts are inconsistent — fix the status row for sprint $current and re-run." >&2
      exit 1
    fi

    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  Sprint $current / $total"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    qa_round=0
    sprint_handled=0

    while [ "$qa_round" -lt "$max_rounds" ]; do
      qa_round=$((qa_round + 1))
      echo ""
      echo "── QA Round $qa_round / $max_rounds ──"

      if [ "$qa_round" -eq 1 ]; then
        harness_maybe_pause_sprint "$current" "$total"
      fi

      # ─── Generator ───────────────────────────────────────────────
      echo ""
      echo "▶ GENERATOR (Sprint $current, Round $qa_round)"
      echo ""

      harness_maybe_pause_phase "generator" "$current" "$qa_round"

      run_phase_agent generator "$current" "$(harness_build_generator_prompt "$current")"

      echo ""
      echo "✓ Generator completed Sprint $current, Round $qa_round"

      # ─── Pre-QA Gate ─────────────────────────────────────────────
      echo ""
      echo "▶ PRE-QA GATE (Sprint $current)"
      if ! run_pre_qa_gate "$current"; then
        echo "  → Mechanical checks failed — sending back to Generator..."
        continue
      fi

      write_handoff generator "$current" "$qa_round" run-evaluator \
        "docs/sprint-${current}-contract.md,docs/sprint-status.md,docs/mechanical-checks-sprint-${current}.md"

      # ─── Evaluator ───────────────────────────────────────────────
      echo ""
      echo "▶ EVALUATOR (Sprint $current, Round $qa_round)"
      echo ""

      harness_maybe_pause_phase "evaluator" "$current" "$qa_round"

      run_phase_agent evaluator "$current" "$(harness_build_evaluator_prompt "$current")"

      validate_phase evaluator "$current"
      harness_post_qa_write "$current" "$qa_round"

      echo ""
      echo "✓ Evaluator completed Sprint $current, Round $qa_round"

      # ─── Check result ────────────────────────────────────────────
      if sprint_passed "$current"; then
        echo ""
        echo "✅ Sprint $current PASSED on round $qa_round"
        harness_track_sprint_finished
        sprint_handled=1
        break
      else
        echo ""
        echo "❌ Sprint $current FAILED on round $qa_round"
        log_qa_failure "$current" "$qa_round"
        if [ "$qa_round" -lt "$max_rounds" ]; then
          echo "  → Sending back to Generator for fixes..."
        else
          echo "  → Max QA rounds reached for Sprint $current."
          echo "  → Review docs/qa-report-sprint-${current}.md for remaining issues."
          handle_max_rounds "$current"
          harness_track_sprint_finished
          sprint_handled=1
          break
        fi
      fi
    done

    if [ "$sprint_handled" -eq 0 ]; then
      # Every round was consumed by pre-QA gate failures, so the evaluator
      # never delivered a verdict. Treat it as max-rounds-reached instead
      # of silently restarting the sprint with a fresh round counter.
      echo ""
      echo "  → Max QA rounds reached for Sprint $current (pre-QA gate never passed)."
      handle_max_rounds "$current"
      harness_track_sprint_finished
    fi

    last_handled_sprint="$current"
  done

  if declare -F harness_run_retro_hook >/dev/null; then
    harness_run_retro_hook
  fi
}

harness_print_summary() {
  local title="${1:-HARNESS COMPLETE}"
  local report

  echo ""
  echo "============================================"
  echo "  $title"
  echo "  Spec:         docs/spec.md"
  echo "  Sprint plan:  docs/sprint-plan.md"
  echo "  Status:       docs/sprint-status.md"
  echo "============================================"
  echo ""
  echo "QA reports:"
  for report in docs/qa-report-sprint-*.md; do
    [ -f "$report" ] && echo "  $report"
  done
  return 0
}
