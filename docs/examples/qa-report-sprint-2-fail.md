# QA Report — Sprint 2: Habits + check-in

**Date:** 2026-08-15  
**Round:** 1  
**Evaluator:** evaluator (isolated context)

## Summary

Sprint 2 implements core habit CRUD and check-in, but **fails** on persistence and empty-state criteria. Design tokens are applied correctly. One blocking bug prevents marking habits done after page refresh.

## Result: FAIL

## Mechanical Checks

Read `docs/mechanical-checks-sprint-2.md` — **Result: PASS**. Lints and artifacts cleared; failure is functional only.

## Scores

| Criterion | Score | Threshold | Result |
|-----------|-------|-----------|--------|
| Feature Completeness | 6 | 8 | FAIL |
| Design Quality | 8 | 7 | PASS |
| Originality | 7 | 6 | PASS |
| Craft | 7 | 6 | PASS |
| Product Depth | 5 | 6 | FAIL |
| Code Quality | 7 | 6 | PASS |
| **Weighted Total** | **6.4** | **7.0** | **FAIL** |

## Functionality test results

**Criterion: Home shows all habits with name and emoji**  
Result: PASS  
Finding: Created 3 habits; all render with emoji or default icon.

**Criterion: Each row shows done/undone state for today**  
Result: PASS  
Finding: Checkbox reflects state before refresh.

**Criterion: Empty state when no habits exist**  
Result: FAIL  
Finding: Cleared localStorage, reloaded `/` — blank white main area, no CTA. Expected copy + "Create habit" link per contract.

**Criterion: Clicking row marks habit done for today**  
Result: PASS  
Finding: Row click toggles done state in-session.

**Criterion: After refresh, done state matches last action**  
Result: FAIL  
Finding: Marked "Read 20 min" done, hard-refreshed — row shows undone. `localStorage` key `taskflow-habits` contains data but store rehydration runs after first render with stale initial state.

**Criterion: User can create habit with name and optional emoji**  
Result: PASS  

**Criterion: User can edit and delete habit**  
Result: PASS  

**Criterion: Midnight ledger palette**  
Result: PASS  

**Criterion: Mobile 44px touch targets**  
Result: PASS  

## Bugs and issues

### Blocking (must fix before next sprint)

1. **Check-in state lost on refresh** — Repro: mark any habit done → F5 → undone. Root cause: Zustand store reads `localStorage` once at module init; hydration must run before paint or use persist middleware correctly.

2. **Missing empty state** — Repro: clear storage → visit `/`. No guidance for first-time user.

### Non-blocking (should fix, can defer)

- Delete confirm dialog uses browser `confirm()` instead of in-app modal (acceptable for v1).

### Observations

- Animation on check-in matches spec timing.

## Design evaluation

Midnight ledger reads coherently — navy background, amber checkmarks. Typography pairing works. Empty state gap hurts first-run experience.

## Recommendation

Sprint 2 **fails QA**. Generator should fix blocking issues and return for re-evaluation:

1. Fix localStorage rehydration so check-in survives refresh
2. Implement empty state with link to `/habits/new`

## Lesson candidates

<!-- LESSON-CANDIDATES
- category: correctness
  phase: generator
  root_cause: "Client store initialized before async localStorage read completed."
  rule: "When persisting UI state to localStorage, use a single rehydration path (e.g. Zustand persist or explicit hydrate-before-render) and verify with a refresh in self-eval."
- category: correctness
  phase: generator
  root_cause: "Empty route rendered null instead of a designed empty state."
  rule: "Every list-first screen must ship an empty state in the same sprint as the list; add it to the contract checklist before marking Ready for QA."
-->
