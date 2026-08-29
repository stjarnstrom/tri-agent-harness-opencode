# Example artifacts (Taskflow)

Static, fictional outputs from a **habit tracker with streak analytics** product ("Taskflow"). Use these to demo the harness **without running** `./opencode-harness.sh`.

The story: Sprint 1 (shell + design system) passed. Sprint 2 (log habits + streak display) **failed QA round 1**, was fixed, and **passed round 2**. Sprint 3 is still not started.

## Walk the loop (recommended order)

| # | File | Phase | What to point out |
|---|------|-------|-------------------|
| 1 | [pre-plan-input.md](pre-plan-input.md) | *(before harness)* | Messy brief → Planner still writes canonical spec |
| 2 | [spec-excerpt.md](spec-excerpt.md) | Planner | Vision, design language, features |
| 3 | [sprint-status-mid-run.md](sprint-status-mid-run.md) | State | Sprint 2 Ready for QA — loop about to gate |
| 4 | [sprint-2-contract.md](sprint-2-contract.md) | Generator | Scope + acceptance criteria + self-eval |
| 5 | [mechanical-checks-sprint-2-pass.md](mechanical-checks-sprint-2-pass.md) | Pre-QA Gate | Mechanical PASS before subjective QA |
| 6 | [qa-report-sprint-2-fail.md](qa-report-sprint-2-fail.md) | Evaluator | Round 1 FAIL + lesson candidates |
| 7 | [qa-report-sprint-2-pass.md](qa-report-sprint-2-pass.md) | Evaluator | Round 2 PASS after fix |
| 8 | [sprint-status-after-retry.md](sprint-status-after-retry.md) | State | Fail → Pass on same sprint |
| 9 | [lessons-excerpt.md](lessons-excerpt.md) | Anti-slop | Distilled rules for future runs |
| 10 | [guardrail-proposal-excerpt.md](guardrail-proposal-excerpt.md) | Learning | Two-strike → proposed lint rule |

## Optional (bookkeeping)

| File | Purpose |
|------|---------|
| [workflow-handoff.json](workflow-handoff.json) | Phase boundary manifest (autonomous loop) |
| [orchestrator-state.json](orchestrator-state.json) | Round counting (illustrative) |

These are **illustrative** — real runs write live files under `docs/` in your project root.

## Cheat sheet

One-page summary for presentations: [../CHEATSHEET.md](../CHEATSHEET.md).
