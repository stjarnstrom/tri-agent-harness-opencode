# Harness Retrospector — Cross-Run Learning Loop

**Date:** 2026-07-13
**Status:** Approved design, pending implementation plan

## Problem

The harness has a skeleton of a learning loop, but it is almost entirely manual:

- `log_qa_failure` (scripts/harness-common.sh) records only "Sprint X failed round Y" —
  the *reason* for failure is never captured in structured form.
- `scripts/anti-slop.mjs` groups hand-written JSONL entries and prints suggestions;
  a human must both write the entries and convert them into guardrails.
- QA reports (`docs/qa-report-sprint-N.md`) contain rich failure detail that is never
  mined, and nothing feeds back into agent prompts, review personas, or lint rules.

Result: every run repeats the mistakes of previous runs. The harness does not learn.

## Goal

Close the loop automatically:

1. Capture *why* sprints fail QA, in structured form.
2. Distill recurring failures into short, generalized lessons that all three agents
   read on every future run.
3. When a pattern recurs (two-strike rule, per CONTRIBUTING.md), draft a real
   guardrail — an ESLint harness rule or review-persona checklist item — as a
   human-reviewed proposal.
4. Persist learning **cross-project**: lessons live in the harness template repo and
   travel into every new product workspace.

## Decisions made during brainstorming

| Question | Decision |
|----------|----------|
| Where does learned knowledge land? | Both: curated lessons file read by agents, and auto-drafted guardrail proposals |
| When does learning run? | A fourth harness phase ("Retrospector", Fable) at the end of each `harness.sh` run |
| Human gate? | Lessons are written automatically; guardrail proposals require human review/commit |
| Memory scope | Cross-project: ledger + lessons checked into the harness repo |
| Mechanism | Approach A: Retrospector agent + structured ledger, with structured capture in QA reports |

## Architecture & data flow

```
QA reports (per sprint)          harness/lessons.jsonl        harness/LESSONS.md
  └─ structured LESSON-            (checked-in ledger:           (curated, capped at 25,
     CANDIDATES block       ──►     fingerprint, strikes,   ──►   phase-tagged rules —
     written by Evaluator           sources, status)              required reading for
                                        │                         all three agents)
                                        │ 2+ strikes
                                        ▼
                              docs/proposals/guardrail-<slug>.md
                              (draft ESLint rule / persona item — human reviews & commits)
```

The **Retrospector** phase runs once at the end of every `harness.sh` run — on
success *and* on halt (failures are the learning signal). It:

1. Reads all `docs/qa-report-sprint-*.md`, sprint contracts, and `harness/lessons.jsonl`.
2. Matches new lesson candidates against existing ledger fingerprints; increments
   strike counts or adds new entries.
3. Rewrites `harness/LESSONS.md` from the ledger (curate, merge, prune — never append-only).
4. For every fingerprint at 2+ strikes without a guardrail, drafts a proposal file.

Also exposed interactively as `/project:retro`, mirroring `/plan`, `/build`, `/qa`.

## Components

### New files

| File | Purpose |
|------|---------|
| `agents/retrospector.md` | Phase instructions: distillation rules, cap policy, proposal format |
| `.claude/agents/retrospector.md` | Subagent definition, `model: claude-fable-5`, tools: Read/Write/Edit/Glob/Grep/Bash |
| `.claude/commands/retro.md` | `/project:retro` command dispatching to the retrospector subagent (same pattern as `.claude/commands/qa.md`) |
| `harness/LESSONS.md` | Curated lesson memory, seeded with a format header and zero lessons |
| `harness/lessons.jsonl` | Structured ledger — **checked in** (not `.gc-cache`, which is ephemeral/ignored) |
| `scripts/sync-lessons.mjs` | `bun lessons:sync <template-path>` — merge a product clone's ledger back into the template repo by fingerprint |
| `scripts/validate-lessons.mjs` | Deterministic guard: LESSONS.md ≤ 25 entries, correct format, well-formed ledger lines |
| `docs/proposals/` | Guardrail proposal drafts land here |
| `tests/lessons.test.mjs` | Unit tests for merge/fingerprint/validate logic |

### Modified files

| File | Change |
|------|--------|
| `harness.sh` | Retrospector phase after the sprint loop (runs on success and on halt); `HARNESS_RETRO=off` skips it; `HARNESS_RETRO_MODEL` override consistent with other phases |
| `scripts/harness-common.sh` | `log_qa_failure` enriched to reference the QA report path for the failed round |
| `agents/evaluator.md` | QA report template gains a machine-readable `LESSON-CANDIDATES` block (see format below) |
| `agents/planner.md`, `agents/generator.md`, `agents/evaluator.md` | `harness/LESSONS.md` added to required reading (phase-relevant entries only) |
| Harness prompts in `harness.sh` / cursor / opencode / SDK runners | Same required-reading addition where the prompt text is assembled |
| `scripts/anti-slop.mjs` | Also reads `harness/lessons.jsonl` so weekly GC and the retro share one data source |
| `.eslintrc.harness.cjs` / `package.json` | `validate-lessons.mjs` wired into `lint:harness` (as a script step); `lessons:sync` script added |
| `CLAUDE.md`, `docs/runtime-contract.md` | Document the fourth phase, file ownership (Retrospector owns `harness/LESSONS.md`, `harness/lessons.jsonl`, `docs/proposals/`) |
| `README.md` | Document the learning loop: Retrospector phase, LESSONS.md, two-strike guardrail proposals, `lessons:sync`, `HARNESS_RETRO=off` |

## Data formats

### LESSON-CANDIDATES block (end of each QA report, written by Evaluator)

```html
<!-- LESSON-CANDIDATES
- category: a11y | correctness | design | performance | process | lint
  phase: planner | generator | evaluator
  root_cause: "One sentence: why this failure happened."
  rule: "Imperative, generalized, ≤ 2 lines: what to do differently."
-->
```

Structured so the Retrospector never parses freeform prose. Empty block is valid
(passing sprints may have no candidates).

### Ledger entry (`harness/lessons.jsonl`, one JSON object per line)

```json
{"id":"a11y-button-contrast","category":"a11y","phase":"generator",
 "rule":"Verify WCAG AA contrast on all colored interactive elements.",
 "strikes":2,"status":"active",
 "sources":[{"project":"acme-dashboard","sprint":2,"date":"2026-07-13"}]}
```

(`project` is the workspace's repo directory name.)

- `id` is the fingerprint: a stable kebab-case slug chosen by the Retrospector;
  matching new candidates to existing ids is an LLM judgment call, but the id
  itself is canonical once created.
- `status`: `active` | `graduated` (guardrail committed) | `retired` (pruned).

### LESSONS.md entry

```markdown
- **[generator][a11y]** Verify WCAG AA contrast on all colored interactive
  elements. *(2 strikes)*
```

Grouped by phase so each agent reads only its section (plus a shared "all" section).

## Lesson lifecycle (anti-bloat rules)

1. **Capture** — Evaluator emits structured candidates; no prose mining.
2. **Distill** — a lesson is a *generalized* imperative rule ("Verify WCAG contrast
   on colored buttons"), never an incident log ("Sprint 2 button failed").
3. **Cap & prune** — LESSONS.md is fully rewritten each retro from the ledger:
   max 25 active lessons, duplicates merged, weakest (lowest strikes, oldest) pruned
   to `retired`. Enforced deterministically by `validate-lessons.mjs`.
4. **Graduate & retire** — at 2 strikes the Retrospector drafts
   `docs/proposals/guardrail-<id>.md` containing a concrete diff (ESLint rule source
   or persona checklist addition). When a human commits the guardrail, the lesson's
   status becomes `graduated` and it is **removed from LESSONS.md** — enforced beats
   remembered. This is what keeps the prompt-visible file small forever.

## Cross-project sync

Product runs happen in clones of this template repo. `scripts/sync-lessons.mjs`
merges the clone's ledger into the template's by fingerprint (summing sources,
taking max strikes, preferring `graduated` status), then regenerates the template's
LESSONS.md. Run manually after a product run worth learning from:
`bun lessons:sync ~/Code/harness-engineering/agent-harness-loops`.

## Error handling

- The Retrospector phase is **best-effort**: a failure prints a warning and exits 0
  for the overall run — it must never fail or block a harness run.
- Malformed ledger lines are skipped with a warning, never fatal.
- Missing `LESSON-CANDIDATES` blocks in older QA reports are tolerated (empty candidates).
- Guardrail proposals are never auto-applied to lint config or personas; the human
  gate is the commit/merge.
- `validate-lessons.mjs` failing in `lint:harness` blocks commits (via the existing
  pre-commit hook) — this is the deterministic backstop against LLM-written bloat.

## Testing

- `tests/lessons.test.mjs`: fingerprint merge logic in `sync-lessons.mjs`
  (sum sources, max strikes, status precedence), validator accept/reject cases
  (>25 lessons, malformed JSONL, bad entry shape).
- Harness smoke: `HARNESS_RETRO=off` skips cleanly; a run with a fixture QA report
  containing a LESSON-CANDIDATES block produces ledger entries and a rewritten
  LESSONS.md (can be tested by invoking the retro prompt assembly in isolation).
- `validate-lessons.mjs` wired into `lint:harness` so CI/pre-commit catches drift.

## Out of scope (YAGNI)

- Automatic committing of guardrails (human gate is deliberate).
- Per-sprint retro during a run (end-of-run only; revisit if lessons prove too coarse).
- Pass-rate/model-comparison analytics dashboard (separate idea, not this system).
- Auto-sync of ledgers from clones (manual `lessons:sync` invocation).
