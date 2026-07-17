#!/usr/bin/env bash
# pre-qa-gate.sh — Mechanical checks before Evaluator runs
#
# Called by opencode-harness.sh after Generator completes.
# Blocks the QA phase until artifacts and guardrails pass.
#
# Usage:
#   ./scripts/pre-qa-gate.sh <sprint_number>
#
# Exit 0 = pass, exit 1 = fail (orchestrator sends back to Generator)

set -euo pipefail

SPRINT="${1:?Usage: pre-qa-gate.sh <sprint_number>}"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

echo ""
echo "=== Pre-QA Gate (Sprint $SPRINT) ==="

FAILURES=()
APP_DIR="app"

has_app_product() {
  [ -f "$APP_DIR/package.json" ]
}

has_app_source() {
  if [ ! -d "$APP_DIR" ]; then
    return 1
  fi
  for dir in "$APP_DIR/src" "$APP_DIR/app" "$APP_DIR/packages" "$APP_DIR/frontend" "$APP_DIR/backend"; do
    if [ -d "$dir" ]; then
      return 0
    fi
  done
  for f in "$APP_DIR"/*.{ts,tsx,js,jsx}; do
    [ -f "$f" ] && return 0
  done
  return 1
}

has_npm_script() {
  local script="$1"
  node -e "const p=require('./${APP_DIR}/package.json'); process.exit(p.scripts&&p.scripts['$script']?0:1)" 2>/dev/null
}

run_pm_script() {
  local script="$1"
  if command -v bun >/dev/null 2>&1; then
    (cd "$APP_DIR" && bun run "$script")
  else
    (cd "$APP_DIR" && npm run "$script")
  fi
}

check_generator_self_eval() {
  local contract="docs/sprint-${SPRINT}-contract.md"
  if [ ! -f "$contract" ]; then
    return 0
  fi

  if ! grep -qi "## Generator self-evaluation" "$contract"; then
    FAILURES+=("Missing '## Generator self-evaluation' section in $contract")
    return 0
  fi

  if ! awk 'tolower($0) ~ /## generator self-evaluation/ {found=1; next} found && /^## / {exit} found {print}' "$contract" | grep -qE '\- \[[ xX]\]'; then
    FAILURES+=("Generator self-evaluation in $contract is missing checklist items")
  fi
}

is_harness_test_script() {
  local script_name="${1:-test}"
  node -e "
    const pkg = require('./${APP_DIR}/package.json');
    const script = pkg.scripts?.['${script_name}'] || '';
    const harnessPattern = /test:harness|tests\/\*\.test\.mjs|harness-lib/;
    process.exit(harnessPattern.test(script) ? 0 : 1);
  " 2>/dev/null
}

check_app_build_and_tests() {
  if ! has_app_product || ! has_app_source; then
    if [ "$SPRINT" -ge 2 ]; then
      FAILURES+=("No application product found by sprint $SPRINT. The gate requires app/package.json and application source under app/ (e.g. app/src/). Scaffold the product only under app/ — see app/README.md.")
    else
      echo "⚠ No application product detected under app/ — build/test/typecheck checks SKIPPED."
      echo "  Sprint 1 may be docs-only, but from sprint 2 the gate requires app/package.json and source under app/."
    fi
    return 0
  fi

  if has_npm_script build; then
    echo "Running build..."
    if ! run_pm_script build 2>&1; then
      FAILURES+=("npm run build failed in app/")
    fi
  else
    echo "No build script — skipping build check."
  fi

  if has_npm_script typecheck; then
    echo "Running typecheck..."
    if ! run_pm_script typecheck 2>&1; then
      FAILURES+=("npm run typecheck failed in app/")
    fi
  elif [ -f "$APP_DIR/tsconfig.json" ] || [ -f "$APP_DIR/tsconfig.app.json" ]; then
    echo "Running tsc --noEmit..."
    if command -v npx >/dev/null 2>&1; then
      if ! (cd "$APP_DIR" && npx tsc --noEmit) 2>&1; then
        FAILURES+=("tsc --noEmit failed in app/")
      fi
    fi
  fi

  if has_npm_script test:unit; then
    echo "Running test:unit..."
    if ! run_pm_script test:unit 2>&1; then
      FAILURES+=("npm run test:unit failed in app/")
    fi
  elif has_npm_script test && ! is_harness_test_script test; then
    echo "Running test (application)..."
    if ! run_pm_script test 2>&1; then
      FAILURES+=("npm test failed in app/")
    fi
  elif is_harness_test_script test; then
    echo "npm test points at harness tests — add test:unit for application unit tests."
    FAILURES+=(
      "npm test runs test:harness (orchestrator tests). Add test:unit for app unit tests — see docs/templates/app-package-scripts.md"
    )
  else
    echo "No test:unit script — skipping application unit tests."
  fi

  if has_npm_script test:e2e; then
    echo "Running test:e2e..."
    if ! run_pm_script test:e2e 2>&1; then
      FAILURES+=("npm run test:e2e failed in app/")
    fi
  elif [ -f "$APP_DIR/playwright.config.ts" ] || [ -f "$APP_DIR/playwright.config.js" ] || [ -f "$APP_DIR/playwright.config.mjs" ]; then
    echo "Running playwright test..."
    if command -v npx >/dev/null 2>&1; then
      if ! (cd "$APP_DIR" && npx playwright test) 2>&1; then
        FAILURES+=("playwright test failed in app/")
      fi
    else
      FAILURES+=("Playwright config present but npx unavailable")
    fi
  else
    FAILURES+=(
      "Application source present but no test:e2e or playwright.config.* under app/ — add test:e2e (see docs/templates/app-package-scripts.md)"
    )
  fi
}

# ── 1. Artifact validation via harness-lib ───────────────────────────────────
if [ -f "scripts/harness-lib/cli.mjs" ] && command -v node >/dev/null 2>&1; then
  echo "Checking phase artifacts..."
  if ! node scripts/harness-lib/cli.mjs validate --phase generator --sprint "$SPRINT" 2>&1; then
    FAILURES+=("Artifact validation failed (missing contract or sprint status not 'Ready for QA')")
  fi
else
  CONTRACT="docs/sprint-${SPRINT}-contract.md"
  if [ ! -f "$CONTRACT" ]; then
    FAILURES+=("Missing $CONTRACT")
  fi
  if [ -f docs/sprint-status.md ] && ! grep -E "^\|\s*${SPRINT}\s*\|" docs/sprint-status.md | grep -qi "Ready for QA"; then
    FAILURES+=("Sprint $SPRINT status is not 'Ready for QA' in docs/sprint-status.md")
  fi
fi

# ── 2. Harness lints on app source ───────────────────────────────────────────
if [ -f ".eslintrc.harness.cjs" ] && [ -f "package.json" ]; then
  echo "Running harness lints..."
  LINT_CMD=""
  if command -v bun >/dev/null 2>&1; then
    LINT_CMD="bun run lint:harness"
  elif command -v npm >/dev/null 2>&1; then
    LINT_CMD="npm run lint:harness"
  elif command -v npx >/dev/null 2>&1; then
    LINT_CMD="npx eslint --config .eslintrc.harness.cjs"
  fi

  if [ -n "$LINT_CMD" ]; then
    LINT_TARGETS=""
    if [ -d "$APP_DIR" ]; then
      for dir in "$APP_DIR/src" "$APP_DIR/app" "$APP_DIR/packages" "$APP_DIR/frontend" "$APP_DIR/backend"; do
        [ -d "$dir" ] && LINT_TARGETS="$LINT_TARGETS $dir"
      done
      for f in "$APP_DIR"/*.{ts,tsx,js,jsx}; do
        [ -f "$f" ] && LINT_TARGETS="$LINT_TARGETS $f"
      done
    fi

    if [ -n "$(echo "$LINT_TARGETS" | xargs)" ]; then
      if ! $LINT_CMD -- $LINT_TARGETS 2>&1; then
        FAILURES+=("Harness lints failed — run 'bun lint:harness' and fix all issues")
      fi
    else
      echo "No app source directories found — skipping lints (sprint may be docs-only)."
    fi
  else
    echo "No package manager found — skipping lints."
  fi
else
  echo "No harness ESLint config — skipping lints."
fi

# ── 4. Generator self-evaluation in sprint contract ────────────────────────
echo "Checking generator self-evaluation..."
check_generator_self_eval

# ── 5. Application build, typecheck, tests, Playwright config ──────────────
check_app_build_and_tests

# ── 6. Secret scan on working tree changes ───────────────────────────────────
GITLEAKS_CONFIG="$PROJECT_DIR/harness/gitleaks.toml"
if command -v gitleaks >/dev/null 2>&1 && [ -d ".git" ]; then
  echo "Running gitleaks on uncommitted changes..."
  if ! gitleaks protect --staged --redact --config "$GITLEAKS_CONFIG" --source "$PROJECT_DIR" 2>/dev/null; then
    FAILURES+=("Secret detected in staged changes (gitleaks) — run 'gitleaks protect --staged --verbose' to inspect")
  fi
  if git diff 2>/dev/null | grep -qEi '(AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{36}|sk-[A-Za-z0-9]{20,})'; then
    FAILURES+=("Possible secret detected in unstaged changes")
  fi
fi

# ── 7. Write mechanical check report for Evaluator ───────────────────────────
REPORT_DIR="docs"
MECH_REPORT="$REPORT_DIR/mechanical-checks-sprint-${SPRINT}.md"
mkdir -p "$REPORT_DIR"

if [ ${#FAILURES[@]} -eq 0 ]; then
  cat > "$MECH_REPORT" <<EOF
# Mechanical Checks — Sprint $SPRINT
Date: $(date -u +"%Y-%m-%dT%H:%M:%SZ")

## Result: PASS

All pre-QA mechanical checks passed:
- Sprint contract and status validated
- Generator self-evaluation present (if contract exists)
- Harness lints clean (if applicable)
- Build/typecheck/tests passed (if application product exists under app/)
- test:unit and test:e2e passed separately (never test:harness in pre-QA gate)
- No secrets detected in staged changes

The Evaluator should include this section in the QA report.
EOF
  echo ""
  echo "✓ Pre-QA gate PASSED"
  echo "  Report: $MECH_REPORT"
  exit 0
else
  cat > "$MECH_REPORT" <<EOF
# Mechanical Checks — Sprint $SPRINT
Date: $(date -u +"%Y-%m-%dT%H:%M:%SZ")

## Result: FAIL

The Generator must fix these before QA can proceed:

EOF
  for f in "${FAILURES[@]}"; do
    echo "- $f" >> "$MECH_REPORT"
  done

  echo ""
  echo "✗ Pre-QA gate FAILED"
  for f in "${FAILURES[@]}"; do
    echo "  - $f"
  done
  echo "  Report: $MECH_REPORT"
  exit 1
fi
