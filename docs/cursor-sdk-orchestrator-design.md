# Cursor SDK Orchestrator Design (Bash-Free Harness Option)

**Implementation status:** Phase 1 (state/handoff bootstrap) and Phase 2 (local `run-loop`, policy, observability, tests) are implemented in `sdk-orchestrator/`. Phase 3 (cloud mode) is not implemented yet.

## Why this exists

The current `harness.sh` flow works, but it depends on CLI command behavior that may change and increase cost. This design adds an optional orchestration path that:

- preserves the existing three-phase harness model (Planner -> Generator -> Evaluator)
- keeps `docs/` artifacts and sprint state as the source of truth
- removes dependency on long bash loops and direct `claude -p` orchestration
- supports long-running and resumable execution through the Cursor SDK

This is an additive option, not a replacement: existing shell and Cursor handoff flows remain valid.

## Goals

- Reproduce current autonomous behavior without `harness.sh`.
- Maintain compatibility with `docs/runtime-contract.md`.
- Support pause/resume across machine restarts or session breaks.
- Add explicit cost controls (model routing, phase budgets, stop policies).
- Keep human-in-the-loop possible at every phase boundary.

## Non-goals

- Rewriting agent personas (`agents/*.md`) or criteria.
- Changing sprint artifact ownership.
- Forcing cloud-only execution.

## Design principles

- `docs/sprint-status.md` remains the canonical state machine.
- Workflow portability is a first-class requirement: any runner can continue from another runner's output.
- Orchestrator is stateless where possible and rebuilds intent from repo files.
- Persist only runtime metadata needed to resume SDK agents.
- Every phase execution is idempotent at orchestration level (safe to retry step selection).
- Clear failure boundaries: startup failure vs run failure vs grading failure.

## Proposed architecture

### Components

1. `sdk-orchestrator/cli.ts`
   - CLI entrypoint (`plan`, `build`, `qa`, `run-loop`, `resume`, `status`)
2. `sdk-orchestrator/orchestrator.ts`
   - phase loop engine and sprint/round transitions
3. `sdk-orchestrator/phase-runners/*.ts`
   - `runPlanner`, `runGenerator`, `runEvaluator`
4. `sdk-orchestrator/state-store.ts`
   - persisted run metadata in `docs/orchestrator-state.json`
5. `sdk-orchestrator/status-parser.ts`
   - parser/validator for `docs/sprint-status.md`
6. `sdk-orchestrator/prompts.ts`
   - builds each phase prompt from existing `agents/*.md` + runtime context
7. `sdk-orchestrator/policy.ts`
   - model routing and budget policies

### Runtime modes

- **Local mode** (default): uses `local: { cwd }`; behaves closest to current flow.
- **Cloud mode** (optional): uses `cloud: { repos }` for detached long runs and PR workflows.

Both modes share the same orchestration logic and write the same artifacts.

## State model

### Canonical state

- `docs/sprint-status.md` drives sprint progression:
  - `Not started` -> `In progress` -> `Ready for QA` -> `Pass|Fail`

### Supplemental state

`docs/orchestrator-state.json` stores runtime metadata only:

- active execution mode (`local|cloud`)
- planner/generator/evaluator `agentId`
- latest `runId` per phase
- current sprint and QA round
- retry counters and timestamps
- last known terminal result (`finished|error|cancelled`)

If this file is deleted, orchestrator can still infer next phase from canonical docs and recreate agents.

### Cross-workflow handoff manifest

`docs/workflow-handoff.json` is a workflow-agnostic handoff record written by every runner (bash, Cursor handoff scripts, SDK local/cloud) at phase boundaries.

Purpose:

- make continuation deterministic across tools
- avoid hidden state coupling to one runtime
- provide a machine-readable "next action" contract

Proposed schema:

```json
{
  "version": 1,
  "updatedAt": "2026-05-19T21:00:00Z",
  "sourceWorkflow": "sdk-local",
  "lastCompletedPhase": "generator",
  "targetSprint": 2,
  "qaRound": 1,
  "expectedNextAction": "run-evaluator",
  "artifactsWritten": [
    "docs/sprint-2-contract.md",
    "docs/sprint-status.md"
  ],
  "runtime": {
    "mode": "local",
    "agentId": "local-agent-123",
    "runId": "run-456"
  },
  "notes": "QA report from previous round was applied before build."
}
```

Write rules:

- Write/update on every successful phase completion.
- Include only facts already reflected in canonical artifacts.
- Do not claim completion if required files are missing.
- Keep `runtime.agentId/runId` optional so non-SDK flows can interoperate.
- Preserve a single latest snapshot (no append log required for v1).

Read/continue rules:

1. Validate canonical artifacts from `docs/runtime-contract.md`.
2. Parse `docs/sprint-status.md` as source of truth.
3. Read `docs/workflow-handoff.json` if present.
4. If manifest conflicts with canonical state, trust canonical state and rewrite manifest on next successful phase.
5. Compute next deterministic action (`planner|generator|evaluator|done`) and continue.

## Phase behavior

### Planner

- Triggered when planning artifacts are missing.
- Sends Planner prompt through SDK agent.
- Verifies required outputs exist:
  - `docs/spec.md`
  - `docs/sprint-plan.md`
  - `docs/sprint-status.md`
- Marks planner step complete in orchestrator state.

### Generator

- Selects target sprint by scanning `docs/sprint-status.md` for first:
  - `Not started`, `In progress`, or `Fail`
- Injects prior QA feedback when `docs/qa-report-sprint-N.md` exists.
- Requires output checks:
  - `docs/sprint-N-contract.md` exists/updated
  - sprint status moved to `Ready for QA`

### Evaluator

- Selects target sprint where status is `Ready for QA`.
- Requires output checks:
  - `docs/qa-report-sprint-N.md` exists/updated
  - sprint status moved to `Pass` or `Fail`

## Loop algorithm (`run-loop`)

1. Load policy config, orchestrator state, and workflow handoff manifest.
2. If planning artifacts missing, run Planner.
3. Determine current sprint from `docs/sprint-status.md`.
4. For sprint `N`, iterate QA round up to `maxQaRounds`:
   1. Run Generator.
   2. Run Evaluator.
   3. If sprint status is `Pass`, continue to next sprint.
   4. If `Fail` and rounds remain, loop back to Generator.
   5. If `Fail` and max rounds reached, apply configured policy:
      - `halt` (default), or
      - `advance-with-warning`.
5. Exit when all sprints are terminal `Pass`.

## Interoperability contract (workflow switching)

The following transitions are explicitly supported:

- `harness.sh` -> SDK `resume`
- SDK `run-loop` -> Cursor manual (`runners/cursor/*.sh`)
- Cursor manual -> SDK `resume`
- SDK local -> SDK cloud (and reverse), if repo/artifacts are in sync

Operational contract:

- runners must read canonical docs before acting
- runners must write `docs/workflow-handoff.json` after each phase
- runners must not rely on private in-memory state from previous workflow
- a phase can always be resumed by any other runner using repo files alone

## Cost and safety controls

### Model routing

Config file: `sdk-orchestrator.config.json`

- `plannerModel`: default lower-cost general model
- `generatorModel`: balanced model
- `evaluatorModel`: strongest model (quality gate)
- optional escalation rules (e.g., upgrade generator model after two fails)

### Budget policy

- Per-run token budget ceiling (soft stop).
- Per-sprint max retry rounds.
- Optional wall-clock timeout per phase.
- `dryRun` mode to compute next actions without launching agents.

### Failure handling

- Distinguish SDK startup failures from run-result failures.
- Auto-retry only when marked retryable.
- Persist last error message and actionable next step.
- Never auto-overwrite canonical docs on parse/validation failure.

## CLI surface

Proposed commands:

- `npm run harness:sdk -- run-loop --prompt "..."`
- `npm run harness:sdk -- resume`
- `npm run harness:sdk -- plan --prompt "..."`
- `npm run harness:sdk -- build [--sprint N]`
- `npm run harness:sdk -- qa [--sprint N]`
- `npm run harness:sdk -- status`

Equivalent operational behavior to current harness, but with resumable SDK agents.

## Human-in-the-loop integration

- `run-loop --pause-after-phase` for manual review after Planner/Generator/Evaluator.
- `status` prints current sprint, phase, round, and last run IDs.
- Existing `runners/cursor/*.sh` (and `scripts/cursor-*.sh` stubs) remain usable for manual takeover.
- Manual edits to `docs/` remain first-class and are respected on `resume`.

## Migration plan

### Phase 1 (safe bootstrap)

- Add orchestrator implementation under `sdk-orchestrator/`.
- Keep `harness.sh` untouched.
- Validate one sample project reaches equivalent artifacts using both paths.

### Phase 2 (parity + observability)

- Add transcript/run metadata logging and structured event output.
- Add policy controls and model routing.
- Add smoke tests for state transitions.

### Phase 3 (optional cloud mode)

- Add cloud runtime config (`repos`, branch handling, optional PR creation).
- Add team-safe key loading and secret handling.
- Document local vs cloud operational playbooks.

## Risks and mitigations

- **Risk:** markdown status parsing brittleness
  - **Mitigation:** strict parser with clear errors and no silent fallbacks
- **Risk:** drift between shell and SDK behavior
  - **Mitigation:** shared transition tests against fixture `sprint-status.md` files
- **Risk:** hidden cost growth in autonomous loops
  - **Mitigation:** per-phase budgets + default halt-on-fail at max rounds
- **Risk:** lock-in to a single runtime mode
  - **Mitigation:** dual support for local/cloud and no change to artifact contract

## Acceptance criteria for this option

1. Can run a full Planner -> Generator -> Evaluator loop without bash orchestration.
2. Resuming after interruption continues from `docs/sprint-status.md` correctly.
3. Produces the same required artifacts and status transitions as runtime contract.
4. Supports model-by-phase configuration and a max QA round policy.
5. Allows manual phase takeover without corrupting orchestrator state.
6. Supports cross-workflow continuation via `docs/workflow-handoff.json` without losing phase context.

## Open decisions

1. Default policy when max QA rounds reached: halt vs advance-with-warning.
2. Whether cloud mode should auto-create PRs or remain artifact-only initially.
