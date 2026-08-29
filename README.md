# Tri-Agent Harness (OpenCode)

Orchestration and guardrails in one harness: **Planner → Generator → Pre-QA Gate → Evaluator**.

This repo is an **OpenCode harness scaffold**, not a finished application. You provide a product prompt; agents create planning artifacts in `docs/` and application code under `app/` sprint by sprint.

> **OpenCode only.** Sibling starter harnesses: [Claude Code](https://github.com/stjarnstrom/tri-agent-harness) (adds Retrospector) and [Cursor CLI](https://github.com/stjarnstrom/tri-agent-harness-cursor).

## The core insight

Most agent workflows collapse creation and judgment into one conversation. This harness separates them:

1. **Creation** — the Generator builds; it never has final say on quality.
2. **Mechanical gates** — lints, artifacts, and secrets are checked *before* subjective QA.
3. **Judgment** — the Evaluator tests the live app with Playwright and grades against rubrics.

**Environment defines the rails. Orchestration drives the train.**

```
Layer 3: Phase gates     pre-qa-gate.sh (lints, artifacts, secrets)
Layer 2: Orchestration   Planner → Generator ↔ Evaluator (sprint loop)
Layer 1: Environment     hooks, ESLint plugin, sandbox, review personas
```

## One sprint, end to end

Each sprint is a contract-driven loop. Agents communicate only through files in `docs/` (see [`docs/runtime-contract.md`](docs/runtime-contract.md)).

```
User prompt
    ↓
Planner  →  docs/spec.md, docs/sprint-plan.md, docs/sprint-status.md
    ↓
Generator  →  docs/sprint-N-contract.md, app/*, commits
    ↓
Pre-QA Gate  →  docs/mechanical-checks-sprint-N.md  (PASS / FAIL)
    ↓
Evaluator  →  docs/qa-report-sprint-N.md  (grades + recommendations)
    ↓
Pass → next sprint  |  Fail → Generator retry (round++, up to budget)
```

| Phase | Reads | Writes | Who decides quality? |
|-------|-------|--------|----------------------|
| **Planner** | Prompt, `agents/criteria/*`, optional `design/brief.md` | Spec, sprint plan, status tracker | — |
| **Generator** | Spec, contract template, prior QA report if retrying | Sprint contract, `app/` code, status → Ready for QA | Self-eval only (first pass) |
| **Pre-QA Gate** | `app/` source, harness lints | Mechanical checks report | Script (deterministic) |
| **Evaluator** | Contract, criteria, live app via Playwright | QA report, status → Pass/Fail | Evaluator (isolated context) |

Visual walkthrough: [field guide](https://stjarnstrom.github.io/tri-agent-harness-opencode/guide/) (source: [`docs/guide/`](docs/guide/)).

**Demo without running the harness:** walk the static Taskflow examples in [`docs/examples/`](docs/examples/README.md) (Sprint 2 fail → pass). One-page team reference: [`docs/CHEATSHEET.md`](docs/CHEATSHEET.md).

## Try it

```bash
git init
bun install && bun run setup
cp .env.example .env.local

# One sprint, then stop — good for a first look
HARNESS_MAX_SPRINTS_PER_RUN=1 ./opencode-harness.sh "Build a project management tool with kanban boards"
```

Resume after interruption by re-running the same command. State lives in `docs/sprint-status.md`.

| Requirement | Notes |
|-------------|-------|
| **Git repo** | Hooks install into `.git/hooks/` — without one, guardrails warn but still run |
| **Bun or Node ≥ 20** | `bun install` preferred |
| **OpenCode CLI** (`opencode`) | Required for `./opencode-harness.sh`; must be installed and authenticated |
| **`.env.local`** | Copy from `.env.example`; never commit secrets |

Optional: **gitleaks** for full secret scan in pre-commit; **Playwright** installed by the Generator under `app/`.

## Guardrails (Layer 1)

These run on every agent invocation and every commit:

- **Pre-commit hook** — sandbox boundary, harness lints, secret scan (`bun run setup`)
- **ESLint harness plugin** — lint messages are agent instructions (`bun lint:harness`)
- **Context hygiene** — deps, build output, and lockfiles are read-denied via `opencode.jsonc`
- **Review personas** — security, frontend architecture, reliability checklists in `review-personas/`

When an agent hits a harness lint, the error text tells it exactly what to fix. Recurring mistakes become permanent constraints via the [two-strike rule](CONTRIBUTING.md).

## Grading (Layer 3, subjective half)

After mechanical checks pass, the Evaluator:

1. Starts the dev server from `app/` and drives **Playwright** like a real user.
2. Grades against **`agents/criteria/`** rubrics (feature completeness, product depth, code quality).
3. Runs **review persona** checklists for security and architecture.
4. Writes **`docs/qa-report-sprint-N.md`** with a binary Pass/Fail.

Mechanical FAIL in the pre-QA gate report = automatic sprint FAIL — the Evaluator never runs until the gate passes. Gate failures consume a QA round, same as an Evaluator failure.

## Running it

### Autonomous (recommended)

```bash
./opencode-harness.sh "your product prompt"
./opencode-harness.sh "your product prompt" 5    # max QA rounds per sprint
```

Override the OpenCode model with `HARNESS_MODEL` (default: `anthropic/claude-sonnet-4-5`).

Attach to a running OpenCode server with `HARNESS_OPENCODE_ATTACH=http://localhost:4096`.

OpenCode agent definitions live in `.opencode/agents/`; phase personas and rubrics live in `agents/`.

`opencode run` sometimes finishes writing artifacts but never exits. The harness runs an **artifact watchdog** (on by default):

```bash
HARNESS_AGENT_WATCHDOG=1          # set 0 to wait for opencode to exit on its own
HARNESS_AGENT_POLL_SEC=15
HARNESS_AGENT_STABLE_POLLS=2
HARNESS_PHASE_TIMEOUT=7200
```

## Product layout

| Path | Purpose |
|------|---------|
| Repo root | Harness: `opencode-harness.sh`, `scripts/`, `harness/`, `docs/`, `agents/`, `.opencode/` |
| `app/` | **Product root** — Generator scaffolds here |

From sprint 2 onward, the pre-QA gate requires `app/package.json` and source under `app/`. See [`app/README.md`](app/README.md).

## Optional inputs

- **`design/brief.md`** — visual direction before planning ([`design/README.md`](design/README.md))
- **Rich pre-plans from another chat** — paste as the product prompt; strip implementation prescriptions. Visual rules belong in `design/brief.md`, not the prompt.
- **`extras/`** — add-on rubrics and patterns not required for the core loop

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `HARNESS_MODEL` | `anthropic/claude-sonnet-4-5` | OpenCode model for all phases |
| `HARNESS_OPENCODE_ATTACH` | — | Attach to `opencode serve` URL |
| `HARNESS_PAUSE` | `off` (`sprint` on fresh project) | Checkpoint before sprint/phase |
| `HARNESS_MAX_SPRINTS_PER_RUN` | unlimited | Stop after N sprints |
| `HARNESS_ON_MAX_ROUNDS` | `halt` | Or `advance` to skip stuck sprints |
| `HARNESS_YES` | `0` | `1` skips pause prompts |
| `HARNESS_AGENT_WATCHDOG` | `1` | Stop hung `opencode run` when artifacts land |
| `HARNESS_SANDBOX` | git root | Pre-commit filesystem boundary |

## Documentation map

| If you want to… | Read |
|-----------------|------|
| Visual field guide | [GitHub Pages](https://stjarnstrom.github.io/tri-agent-harness-opencode/guide/) · [`docs/guide/`](docs/guide/) |
| One-page cheat sheet (presentations) | [`docs/CHEATSHEET.md`](docs/CHEATSHEET.md) |
| Example artifacts without running the harness | [`docs/examples/`](docs/examples/README.md) |
| File ownership and phase boundaries | [`docs/runtime-contract.md`](docs/runtime-contract.md) |
| Agent sandbox and lint rules | [`harness/AGENT-INSTRUCTIONS.md`](harness/AGENT-INSTRUCTIONS.md) |
| Improving guardrails over time | [`CONTRIBUTING.md`](CONTRIBUTING.md) |
| Optional add-ons | [`extras/README.md`](extras/README.md) |

## Before your first run

**First runs pause by default** on a fresh project (`HARNESS_PAUSE=sprint`). Answer `a` for the rest of the run, or set `HARNESS_PAUSE=off` / `HARNESS_YES=1`.

**Cost is real.** Vague prompts often plan 8–10 sprints. Cap with `HARNESS_MAX_SPRINTS_PER_RUN=1`.

**QA needs a runnable app.** First-run failures are often `cd app && npx playwright install` or a busy port.

**One clone = one product.** Start each product from a fresh clone. The generated app lives under `app/` in this repo.

**Autonomy means real permissions.** Agents use `--dangerously-skip-permissions`; hooks catch bad commits, not bad commands.

## Sibling harnesses

| Repo | Runner |
|------|--------|
| [tri-agent-harness](https://github.com/stjarnstrom/tri-agent-harness) | Claude Code |
| [tri-agent-harness-cursor](https://github.com/stjarnstrom/tri-agent-harness-cursor) | Cursor CLI |
| **this repo** | OpenCode (`./opencode-harness.sh`) |

## Guardrail commands

```bash
bun lint:harness          # ESLint rules with agent-prompt error messages
bun gc:weekly             # Review recurring failures → new rules
bun run setup             # Install pre-commit hook
npm run test:harness      # Harness unit tests
```
