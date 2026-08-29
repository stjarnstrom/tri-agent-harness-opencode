# Tri-Agent Harness — Cheat Sheet (OpenCode)

One page for team walkthroughs. Full narrative: [README](../README.md). Visual guide: [field guide](https://stjarnstrom.github.io/tri-agent-harness-opencode/guide/) ([source](guide/)).

## The insight

**Create ≠ judge.** The Generator builds; the Evaluator grades in a separate context. **Mechanical before subjective** — lints and artifacts pass before Playwright runs.

```
Layer 1  Environment     hooks · ESLint plugin · sandbox · review personas
Layer 2  Orchestration   Planner → Generator ↔ Evaluator
Layer 3  Phase gates     pre-qa-gate.sh (lints, artifacts, secrets)
```

## The loop

```
Prompt → Planner (spec, sprint plan, status)
       → Generator (contract, app/, Ready for QA)
       → Pre-QA Gate (mechanical-checks-sprint-N.md)
       → Evaluator (qa-report-sprint-N.md, Pass/Fail)
       → next sprint  |  retry (round++)
```

## Phases at a glance

| Phase | Agent / script | Key output |
|-------|----------------|------------|
| Planner | planner | `docs/spec.md`, `docs/sprint-plan.md`, `docs/sprint-status.md` |
| Generator | generator | `docs/sprint-N-contract.md`, code under `app/` |
| Pre-QA Gate | `scripts/pre-qa-gate.sh` | `docs/mechanical-checks-sprint-N.md` |
| Evaluator | evaluator | `docs/qa-report-sprint-N.md` |

**Source of truth:** `docs/sprint-status.md` (not chat history, not orchestrator state).

## Decision tree

```
Generator marked Ready for QA?
  └─ pre-qa-gate.sh N
       FAIL → Generator retry (uses a QA round)
       PASS → Evaluator
            FAIL → Generator retry
            PASS → next sprint (or done)
```

## Run it

| Mode | Command |
|------|---------|
| Autonomous | `./opencode-harness.sh "your product prompt"` |
| One sprint demo | `HARNESS_MAX_SPRINTS_PER_RUN=1 ./opencode-harness.sh "…"` |
| Attach to serve | `HARNESS_OPENCODE_ATTACH=http://localhost:4096 ./opencode-harness.sh "…"` |

**Setup once:** `git init && bun install && bun run setup`

## Guardrails

| Tool | What it does |
|------|----------------|
| `bun run setup` | Install pre-commit hook (sandbox, lints, secrets) |
| `bun lint:harness` | ESLint rules that read as fix instructions |
| `harness/AGENT-INSTRUCTIONS.md` | Sandbox, lints-as-instructions, anti-slop |
| `review-personas/` | Security, frontend, reliability checklists |
| [Two-strike rule](../CONTRIBUTING.md) | Same mistake twice → automate a guardrail |

## Grading

- **Mechanical FAIL** in gate report → sprint FAIL (Evaluator skipped).
- **Rubrics:** `agents/criteria/*`
- **QA report:** weighted scores + per-criterion Pass/Fail
- **Threshold:** weighted total ≥ 7.0 (see `agents/evaluator.md`)

## Useful dials

| Variable | Default | Use when |
|----------|---------|----------|
| `HARNESS_MAX_SPRINTS_PER_RUN` | unlimited | Cap cost; demo one sprint |
| `HARNESS_PAUSE` | `sprint` on fresh project | Checkpoint before each sprint |
| `HARNESS_YES` | `0` | Skip all pause prompts |
| `HARNESS_ON_MAX_ROUNDS` | `halt` | `advance` skips stuck sprints |
| `HARNESS_MODEL` | `anthropic/claude-sonnet-4-5` | Override OpenCode model |
| `HARNESS_AGENT_WATCHDOG` | `1` | Stop hung `opencode run` when artifacts land |

## Example walkthrough (no harness run)

Static fictional artifacts: **[docs/examples/](examples/README.md)** — Taskflow habit tracker, Sprint 2 fail → pass.

## Read next

| Topic | Doc |
|-------|-----|
| Full walkthrough | [README](../README.md) |
| File ownership | [runtime-contract.md](runtime-contract.md) |
| Visual field guide | [GitHub Pages](https://stjarnstrom.github.io/tri-agent-harness-opencode/guide/) · [`guide/`](guide/) |
| Sibling harnesses | [Claude Code](https://github.com/stjarnstrom/tri-agent-harness) · [Cursor CLI](https://github.com/stjarnstrom/tri-agent-harness-cursor) |
