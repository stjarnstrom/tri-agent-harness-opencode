# Tri-Agent Harness (OpenCode)

> OpenCode-only orchestration + professional guardrails.
> Updated by the Planner agent at project start.

---

## Required reading (every agent, every session)

1. **`harness/AGENT-INSTRUCTIONS.md`** — Sandbox, lints-as-instructions, anti-slop rules
2. **`docs/runtime-contract.md`** — File ownership and phase boundaries
3. This file — project-specific context (stack, design, status)

---

## What this is

[One sentence description — filled in by Planner]

**Status:** Planning / Active / Complete
**Current sprint:** —
**Last QA:** —

---

## Architecture

This project uses an **OpenCode-only harness** with two layers:

### Orchestration (who runs when)
- **Planner**: Expands a short prompt into spec, sprint plan, and status tracker.
- **Generator**: Builds sprint-by-sprint under `app/`; commits pass pre-commit hooks.
- **Pre-QA Gate**: Mechanical checks (lints, artifacts) before Evaluator runs.
- **Evaluator**: Playwright testing + rubric grading + review persona checklists.

Agents communicate through files in `docs/`. Personas in `agents/`. Criteria in `agents/criteria/`. OpenCode entry points in `.opencode/agents/`.

### Model policy (OpenCode)

Autonomous runs use the OpenCode CLI (`opencode run`). Default model: `anthropic/claude-sonnet-4-5`.

Override with `HARNESS_MODEL` on the `./opencode-harness.sh` command. Optional: `HARNESS_OPENCODE_ATTACH` to attach to `opencode serve`.

### Environment (always on)
- Git pre-commit hook: sandbox, lints, secret scan (`bun run setup`)
- Context hygiene via `opencode.jsonc` (`permission.read` deny rules) — see "Context Hygiene" in `harness/AGENT-INSTRUCTIONS.md`
- ESLint harness plugin: lints are agent instructions (`bun lint:harness`)
- Review personas: `review-personas/` for focused code review
- Anti-slop loop: recurring QA failures → new guardrails (`bun gc:weekly`)

## Key Principles

1. **Separate creation from judgment.** Generator never has final say on quality.
2. **Mechanical before subjective.** Pre-QA gate catches lint/artifact failures before Playwright.
3. **Grading criteria make quality concrete.** See `agents/criteria/`.
4. **Evaluator tests the live app** via Playwright, not just code review.
5. **Sprint contracts prevent scope drift.** See `docs/templates/sprint-contract.md`.
6. **Product code lives under `app/`.** Harness infrastructure stays at repo root.

---

## Stack

[Defaults — Planner adapts for each product]

**Frontend (always)**

- React 18+ with TypeScript (strict mode)
- Vite for bundling
- Tailwind CSS for utility styling
- React Router v6 for routing
- Zustand for non-trivial state management
- Framer Motion for animation

**Full stack (when backend needed)**

- FastAPI (Python) for the API layer
- SQLite for prototyping, PostgreSQL for production
- Alembic for migrations
- Pydantic for data validation

**Testing**

- Playwright for E2E (always install, always configure under `app/`)
- Vitest for unit tests when needed

**AI integration**

- Anthropic SDK (claude-sonnet-4-6 as default model)
- Build real AI features as product value, not demos

---

## Code style

- TypeScript strict mode, no `any` without a comment explaining why
- Functional components only — no class components
- Co-locate types with the code that uses them
- Prefer explicit over clever
- Run `bun lint:harness` before committing — lint messages are fix instructions
- No console.log left in committed code (enforced by harness lint rule)

---

## Design defaults

Every project should feel intentional and specific. The bar is high:

- Read and follow the frontend-design skill when building UI
- Commit to a strong aesthetic direction before writing a line of CSS
- Avoid every generic AI pattern: no Inter/Roboto defaults, no purple-gradient-
over-white-card layouts, no cookie-cutter component assemblies
- Mobile-responsive is not optional — build it from the start, not as an
afterthought
- Spacing, typography hierarchy, and color consistency are treated as
first-class requirements, not nice-to-haves

---

## Design language

[Filled in by Planner — adapt the design defaults above for this specific product]

- Aesthetic: —
- Colors: —
- Typography: —
- Motion: —
- Signature element: —

---

## Running the project

```bash
# Harness setup (first time)
bun install && bun run setup

# App setup (after Generator scaffolds app/)
cd app && npm install && npm run dev

# Harness lints
bun lint:harness

# Tests
npm run test:harness   # harness helper tests only
cd app && npx playwright test   # app E2E (after Generator scaffolds test:e2e)
```

---

## Docs

- Full spec: `docs/spec.md`
- Sprint plan: `docs/sprint-plan.md`
- Sprint status: `docs/sprint-status.md`
- Sprint contracts: `docs/sprint-[N]-contract.md`
- Mechanical checks: `docs/mechanical-checks-sprint-[N].md`
- QA reports: `docs/qa-report-sprint-[N].md`
- Product root: `app/README.md`

---

## Commands

**Autonomous mode** (`./opencode-harness.sh`):

```bash
./opencode-harness.sh "product prompt"              # full loop
./opencode-harness.sh "product prompt" 5            # max 5 QA rounds per sprint
HARNESS_ON_MAX_ROUNDS=advance ./opencode-harness.sh "..."  # advance on persistent failure
HARNESS_PAUSE=sprint ./opencode-harness.sh "..."    # confirm before each sprint
HARNESS_MAX_SPRINTS_PER_RUN=1 ./opencode-harness.sh "..."  # one sprint per run
HARNESS_MODEL=anthropic/claude-sonnet-4-5 ./opencode-harness.sh "..."  # override model
HARNESS_OPENCODE_ATTACH=http://localhost:4096 ./opencode-harness.sh "..."  # attach to serve
```

**Sibling tools** (separate repos): [tri-agent-harness](https://github.com/stjarnstrom/tri-agent-harness) (Claude Code), [tri-agent-harness-cursor](https://github.com/stjarnstrom/tri-agent-harness-cursor) (Cursor CLI).

**Guardrails:**

- `bun run setup` — Install git hooks
- `bun lint:harness` — Run agent-prompt lint rules
- `bun gc:weekly` — Anti-slop review of recurring failures

---

## Key decisions

[Filled in as the project evolves]
