# Application package.json Scripts (Generator Reference)

When scaffolding an application in a harness repo, **keep harness scripts separate
from product scripts**. The pre-QA gate runs application checks only — it must
not execute orchestrator unit tests via `npm test`.

## Harness scripts (scaffold — do not remove)

| Script | Purpose |
|--------|---------|
| `test:harness` | Orchestrator/state-machine tests in `tests/*.test.mjs` |
| `lint:harness` | Agent-prompt ESLint rules |
| `pre-qa-gate` | Mechanical gate (orchestrator invokes this) |

The harness scaffold sets `"test": "npm run test:harness"` until an app exists.

## Application scripts (Generator adds when creating the app)

| Script | Purpose | Pre-QA gate |
|--------|---------|-------------|
| `test:unit` | App unit/integration tests (Vitest, node:test, etc.) | **Runs** |
| `test:e2e` | Playwright E2E (`playwright test`) | **Runs** |
| `test` | Optional convenience: `npm run test:unit && npm run test:e2e` | Runs only if it does **not** reference `test:harness` |
| `build` | Production build | **Runs** |
| `typecheck` | `tsc --noEmit` or equivalent | **Runs** if present |
| `dev` | Dev server for Evaluator | Not run by gate |

## Example after Sprint 1 scaffolds a Vite app

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "typecheck": "tsc -b --noEmit",
    "test:unit": "vitest run",
    "test:e2e": "playwright test",
    "test": "npm run test:unit && npm run test:e2e",
    "lint:harness": "eslint --config .eslintrc.harness.cjs",
    "test:harness": "node --test tests/*.test.mjs",
    "pre-qa-gate": "bash scripts/pre-qa-gate.sh"
  }
}
```

## Anti-patterns (pre-QA gate will fail or skip incorrectly)

```json
"test": "node --test tests/*.test.mjs && playwright test"
```

This mixes harness orchestrator tests with app E2E. Use separate `test:unit` /
`test:e2e` instead.

```json
"test": "npm run test:harness && playwright test"
```

Same problem — gate detects `test:harness` in `test` and requires `test:unit`.
