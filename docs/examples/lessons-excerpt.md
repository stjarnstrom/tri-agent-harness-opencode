# Harness Lessons — excerpt

> **Example only.** Rendered from `harness/lessons.jsonl` after anti-slop review of Taskflow sprint 2 failures.

---

## Generator

### Persist client state with an explicit rehydration path

**Category:** correctness · **Status:** active · **Strikes:** 1

When persisting UI state to localStorage, use a single rehydration path (e.g. Zustand persist or explicit hydrate-before-render) and verify with a refresh in self-eval.

*Source: Taskflow sprint 2 QA — check-in lost on F5*

### Ship empty states in the same sprint as the list

**Category:** correctness · **Status:** active · **Strikes:** 1

Every list-first screen must ship an empty state in the same sprint as the list; add it to the contract checklist before marking Ready for QA.

*Source: Taskflow sprint 2 QA — blank home with no habits*

---

## Evaluator

*(No entries yet for this example run.)*

---

## Planner

*(No entries yet for this example run.)*
