# Runtime Contract

This document defines the shared file and state contract used by the **OpenCode
harness** (orchestration + guardrails):

- `./opencode-harness.sh` autonomous execution — **canonical**
- `scripts/harness-lib/cli.mjs` — internal helpers for validation and handoff manifests

Autonomous runs write `docs/workflow-handoff.json` at phase boundaries via
`scripts/harness-lib/cli.mjs`.

## Architecture Layers

1. **Environment (always on):** `harness/AGENT-INSTRUCTIONS.md`, git hooks,
   ESLint plugin, sandbox settings. Every agent invocation follows these rules.
2. **Orchestration:** Planner → Generator → **Pre-QA Gate** → Evaluator loop.
3. **Phase gates (programmatic):** `scripts/pre-qa-gate.sh` runs mechanical
   checks before Evaluator. Failures return to Generator without consuming a QA round.

## Product layout

- **Harness** lives at the repo root (`scripts/`, `harness/`, `docs/`, `agents/`, `.opencode/`).
- **Application** lives under `app/` only. The Generator scaffolds
  `app/package.json`, source, and tests there — never at the repo root.
- From sprint 2 onward, the pre-QA gate requires `app/package.json` and app
  source under `app/`.

## Canonical Files

### Core planning artifacts
- `docs/spec.md`: product vision, features, design language, AI integration.
- `docs/sprint-plan.md`: sprint sequence and per-sprint "done when" outcomes.
- `docs/sprint-status.md`: source of truth for sprint state.
- `docs/design-options.md`: three proposed design directions (design-scout mode only).

### Design input (optional, user-provided before planning)
- `design/brief.md`: primary design direction (authoritative).
- `design/constraints.md`: must-have / must-not rules.
- `design/selected-direction.md`: user's pick after reviewing `docs/design-options.md`.
- `design/references/*`: mood images, logos, screenshots (png, jpg, webp, svg).
- `brand-guidelines.md` (root or `agents/`): legacy alias for brief content.

### Sprint artifacts
- `docs/sprint-[N]-contract.md`: sprint scope, acceptance criteria, self-eval.
- `docs/mechanical-checks-sprint-[N].md`: pre-QA gate results (written by orchestrator).
- `docs/qa-report-sprint-[N].md`: evaluator QA results and recommendations.

### Guardrail artifacts
- `harness/AGENT-INSTRUCTIONS.md`: universal agent rules (sandbox, lints, anti-slop).
- `review-personas/*.md`: security, frontend, reliability review checklists.
- `.gc-cache/weekly-report.jsonl`: QA failure log for anti-slop loop (gitignored).

### Shared context
- `AGENTS.md`: project-level context, stack defaults, design defaults, and links.
- `agents/*.md`: planner/generator/evaluator role instructions.
- `agents/criteria/*.md`: QA scoring and quality rubrics.
- `app/README.md`: product root — Generator scaffolds here.
- `.opencode/agents/*.md`: OpenCode agent entry points (read `agents/*.md` for full personas).

## Ownership And Read/Write Rules

### Planner phase
- Reads: `AGENTS.md`, `harness/AGENT-INSTRUCTIONS.md`, `agents/planner.md`,
  `agents/criteria/*.md`, `harness/workspace-template.md`, `design/*` (if present),
  `docs/design-options.md` (finalize mode), `docs/templates/design-options.md` (scout mode)
- Writes (full/finalize mode):
  - `docs/spec.md`
  - `docs/sprint-plan.md`
  - `docs/sprint-status.md` (initialize all sprints as `Not started`)
  - `AGENTS.md` (project-specific updates)
- Writes (design-scout mode — no user brief):
  - `docs/design-options.md` only — harness halts for user selection

### Planning state (resume logic)

| State | Files present | Next action |
|-------|---------------|-------------|
| Complete | `docs/spec.md` + `docs/sprint-status.md` | Resume build loop |
| Await selection | `docs/design-options.md`, no `docs/sprint-status.md`, no `design/selected-direction.md` | User picks direction; re-run harness |
| Finalize | `docs/design-options.md` + `design/selected-direction.md`, no sprint status | Run planner (finalize mode) |
| Initial + brief | `design/brief.md` or references | Run planner (full mode) |
| Initial, no brief | — | Run planner (scout mode) unless `HARNESS_YES=1` (full mode, autonomous pick) |

### Generator phase
- Reads:
  - `docs/spec.md`
  - `docs/sprint-plan.md`
  - `docs/sprint-status.md`
  - `AGENTS.md`
  - `harness/AGENT-INSTRUCTIONS.md`
  - `agents/generator.md`
  - `agents/criteria/*.md`
  - `app/README.md`
  - previous `docs/qa-report-sprint-[N].md` if present
  - previous `docs/mechanical-checks-sprint-[N].md` if gate failed
- Writes:
  - `docs/sprint-[N]-contract.md` (create/update)
  - `docs/sprint-status.md` (set target sprint to `Ready for QA`)
  - application code under `app/` only (must pass pre-commit hook)

### Pre-QA Gate (orchestrator, not an agent)
- Reads: sprint contract, sprint status, `app/package.json` and app source
- Writes: `docs/mechanical-checks-sprint-[N].md`
- Blocks Evaluator if Result: FAIL

### Evaluator phase
- Reads:
  - `docs/spec.md`
  - `design/brief.md` (if present — compare implementation to user brief)
  - `docs/sprint-status.md`
  - `docs/sprint-[N]-contract.md`
  - `docs/mechanical-checks-sprint-[N].md`
  - `harness/AGENT-INSTRUCTIONS.md`
  - `agents/evaluator.md`
  - `agents/criteria/*.md`
  - `review-personas/*.md`
- Writes:
  - `docs/qa-report-sprint-[N].md`
  - `docs/sprint-status.md` (set QA result for target sprint)

## Sprint State Machine (`docs/sprint-status.md`)

Expected status progression per sprint:

1. `Not started`
2. `In progress` (optional intermediate)
3. `Ready for QA`
4. `Pass`, `Fail`, or `Skipped` (terminal — `Skipped` when max QA rounds reached with `HARNESS_ON_MAX_ROUNDS=advance`)

Rules:
- A sprint can only be evaluated when status is `Ready for QA` **and** pre-QA gate passes.
- A `Fail` sprint can return to `In progress`/`Ready for QA` for rework cycles.
- Harness resumes from the first sprint not in terminal `Pass` or `Skipped` state.
- On max QA rounds: **halt by default**. Set `HARNESS_ON_MAX_ROUNDS=advance` to mark the sprint `Skipped` and continue to the next sprint with known issues.

## Resume

After any completed phase:

1. Ensure canonical files exist and reflect the latest state.
2. Re-run `./opencode-harness.sh "<same prompt>" [max_qa_rounds]`.

Sibling tools (separate repos): [tri-agent-harness](https://github.com/stjarnstrom/tri-agent-harness), [tri-agent-harness-cursor](https://github.com/stjarnstrom/tri-agent-harness-cursor).

## Conflict Resolution

If outputs disagree, trust these in order:

1. `docs/sprint-status.md` for current state
2. latest `docs/qa-report-sprint-[N].md` for QA truth
3. latest `docs/sprint-[N]-contract.md` for sprint acceptance criteria
4. `docs/spec.md` for product intent

When in doubt, run a focused evaluator pass and update status/report first.
