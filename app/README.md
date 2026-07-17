# Product root

The **Generator** scaffolds your application here — not at the repo root.

Expected layout after Sprint 1 (adapt to stack, but keep everything under `app/`):

```
app/
  package.json      # product scripts: dev, build, test:unit, test:e2e
  src/              # application source
  playwright.config.ts
```

The harness stays at the repo root (`scripts/`, `harness/`, `docs/`). From sprint 2 onward, the pre-QA gate requires `app/package.json` and application source under `app/`.

See `docs/templates/app-package-scripts.md` for required npm scripts.
