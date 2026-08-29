# Mechanical Checks — Sprint 2

> **Example only.** Written by `scripts/pre-qa-gate.sh` after Generator completes.

**Sprint:** 2  
**Date:** 2026-08-15  
**Gate runner:** pre-qa-gate.sh

## Result: PASS

## Checks

| Check | Status | Notes |
|-------|--------|-------|
| Sprint contract exists | PASS | `docs/sprint-2-contract.md` |
| Generator self-evaluation | PASS | Checklist present with items |
| Sprint status | PASS | Row 2 = Ready for QA |
| `app/package.json` | PASS | Product root present |
| Application source | PASS | `app/src/` |
| Harness lint (`bun lint:harness`) | PASS | 0 errors |
| App lint | PASS | `npm run lint` exit 0 |
| Secret scan | PASS | No staged secrets |
| Self-eval not empty | PASS | At least one `[ ]` or `[x]` item |

## Summary

All mechanical checks passed. Evaluator may proceed to Playwright testing.
