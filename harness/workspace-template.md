# Workspace Template — Agent-Optimized Monorepo Layout

This is a reference directory structure designed so agents can scope their vision to specific subtrees without reading the whole codebase. Each domain package has:

1. **A clear public API** (only `src/index.ts` is "exported" to other packages)
2. **Co-located instructions** (`CLAUDE.md`) describing what rules apply here — the canonical domain filename for all tools (Claude Code loads these automatically; others read them per [`AGENT-INSTRUCTIONS.md`](AGENT-INSTRUCTIONS.md))
3. **TypeScript project references** enforcing boundary checks via `tsc --build` and our lint rule

## Layout

```
packages/
├── auth/                    # Authentication domain
│   ├── CLAUDE.md            # Domain-specific agent instructions (canonical filename)
│   ├── package.json         # Public API: { "main": "./dist/index.js", "types": "./dist/index.d.ts" }
│   ├── tsconfig.json        # Project reference target
│   └── src/
│       ├── index.ts         # ← ONLY public entry point (re-exports)
│       ├── types.ts
│       ├── provider.tsx     # AuthProvider component
│       ├── hooks/           # useAuth, useSession, etc.
│       └── internal/        # Private helpers — NOT exported from index.ts
│           └── jwt.ts
├── billing/                 # Billing domain
│   ├── CLAUDE.md
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts
│       ├── checkout.tsx
│       ├── subscription.ts
│       └── internal/        # Private — billing-specific utilities
├── ui-system/               # Shared UI components (cross-domain)
│   ├── CLAUDE.md
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts         # Re-exports Button, Card, Form, etc.
│       ├── button.tsx
│       ├── card.tsx
│       └── themes/          # Theme tokens — consumed by other packages
├── shared-types/            # Cross-cutting types (no logic)
│   ├── CLAUDE.md
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts         # User, Order, Permission interfaces
│       └── enums.ts
└── utils/                   # Shared utilities (pure functions only)
    ├── CLAUDE.md
    ├── package.json
    ├── tsconfig.json
    └── src/
        ├── index.ts         # fetchWithTimeout, logger, etc.
        ├── network.ts
        └── logging.ts
```

## Key Principles

### 1. Public API = One File Per Package

Each package's `src/index.ts` is the ONLY file other packages may import from. Internal implementation lives in:
- `src/internal/` — private helpers (not exported)
- `src/components/` or `src/hooks/` — only if they're re-exported through index.ts

This means an agent working on billing can safely ignore everything inside `auth/src/internal/`. The TypeScript compiler and our boundary lint will catch violations.

### 2. Domain Coherence Over Technical Cohesion

Group by **domain** (auth, billing, user), not by **technology** (components, hooks, utils). An agent assigned "fix the subscription cancellation bug" should find all relevant code in `packages/billing/` without searching across directories.

### 3. Thin Aggregators for Cross-Cutting Concerns

`shared-types/` and `utils/` exist because they're truly cross-domain. They contain no business logic — only types and pure functions that any package might need. Keep them small; if `utils/` grows past 500 lines, split it by concern (network, logging, formatting).

### 4. Project References Enforce Boundaries

Each package has a `tsconfig.json` with `"composite": true` and references to its dependencies:

```json
{
  "compilerOptions": {
    "composite": true,
    "declaration": true,
    "outDir": "./dist"
  },
  "references": [
    { "path": "../shared-types" },
    { "path": "../utils" }
  ]
}
```

Run `tsc --build` to check all references. Cross-package imports of non-public exports will fail at build time.

### 5. Secrets Stay Out of Git and Context

Real credentials never belong in source or git history. The harness pattern:

| File | Committed? | Agent reads? |
|------|------------|--------------|
| `.env.example` | Yes | Yes — names and dummy values only |
| `.env.local`, `.env` | No (gitignored) | No — blocked by `.cursorignore` and opencode |
| Source code | Yes | Yes — use `process.env.VAR`, never literals |

Pre-commit rejects staged `.env` files and runs gitleaks (or a regex fallback). See [`AGENT-INSTRUCTIONS.md`](AGENT-INSTRUCTIONS.md) for agent-facing rules.

## Adding a New Domain Package

1. Copy the template structure above (minus git history).
2. Create `src/index.ts` with your public re-exports.
3. Add a `CLAUDE.md` describing what this package does and any domain-specific rules for agents working in it. **Use exactly `CLAUDE.md`** — one canonical filename for all tools (Claude Code auto-loads it; Cursor and opencode follow the rule in [`AGENT-INSTRUCTIONS.md`](AGENT-INSTRUCTIONS.md)).
4. Register in root `tsconfig.json` under `"references"`.
5. Update each consumer's tsconfig to add a reference to the new package.

## How Subdirectory CLAUDE.md Files Work

Each domain package gets one `CLAUDE.md` — no per-tool duplicates. When working on code in `packages/billing/`, agents should apply:
1. Root `CLAUDE.md` (project-wide rules)
2. `packages/billing/CLAUDE.md` (domain-specific rules)

Claude Code loads both automatically. Cursor, opencode, and other tools must read the package's `CLAUDE.md` explicitly when scoped to that directory (see [`AGENT-INSTRUCTIONS.md`](AGENT-INSTRUCTIONS.md)).

The subdirectory file **augments** the root — rules from both files apply. Use this to keep domain-specific guidance close to the code without duplicating project-wide conventions in every package.

## What NOT to Do

- **Don't duplicate domain instructions per tool.** One `CLAUDE.md` per package — not separate `AGENTS.md` or `.cursorrules` copies. Other tools read the same file explicitly.
- **Don't create 750 packages.** Scope by meaningful domain, not by file count. Two packages are fine; fifty is overkill.
- **Don't use barrel files as implementation.** `index.ts` should only re-export — no business logic in the entry point.
- **Don't let agents import from `internal/`.** The boundary lint (`one-canonical-pattern`) will catch it if configured. The real enforcement happens at build time via TypeScript project references.
