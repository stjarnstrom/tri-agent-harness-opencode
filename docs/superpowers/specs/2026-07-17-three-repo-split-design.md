# Design: Three tool-specific harness repos

**Date:** 2026-07-17  
**Status:** Approved  
**Goal:** One honest product surface per agent tool — no partial-parity footnotes in the happy path.

## Decision

Split the multi-runner monorepo into **three GitHub repositories**:

| Repo | Tool | Canonical entry |
|------|------|-----------------|
| [`tri-agent-harness`](https://github.com/stjarnstrom/tri-agent-harness) (this repo) | Claude Code | `./harness.sh` |
| `tri-agent-harness-cursor` (new) | Cursor CLI | `./cursor-harness.sh` |
| `tri-agent-harness-opencode` (new) | OpenCode CLI | `./opencode-harness.sh` |

**Not** long-lived branches. Branches hide the wrong default and invite merge conflicts across incompatible trees.

**Not** a shared npm “core” package in v1. Accept duplicated `agents/`, gate scripts, and criteria; port improvements deliberately. A shared package can be reconsidered later if drift becomes painful.

## Product layout (all three)

Within each repo, the generated product lives under **`app/`**:

```
repo/
  harness.sh (or tool-specific runner)
  agents/, harness/, docs/, scripts/   ← harness
  app/                                 ← product only (scaffolded by Generator)
    package.json, src/, playwright…
```

Root `package.json` remains harness tooling only. Pre-QA gate requires `app/package.json` and app source under `app/`.

Sibling-copy dogfood remains recommended when iterating on the **template itself**; day-to-day product work is “clone the right tool repo → run.”

## What each repo ships / does not ship

### `tri-agent-harness` (Claude)

- Ships: autonomous `./harness.sh`, interactive `/plan` `/build` `/qa` `/retro`, Retrospector, Fable/Sonnet model policy, Claude sandbox settings.
- Does not ship: Cursor/OpenCode runners, `runners/`, root compatibility stubs for other tools.
- README: “Claude Code only.” Optional one-liner pointing at sibling repos — no parity table that implies sameness.
- `docs/guide.html`: Claude-only Starting a product, modes, and field notes (`./harness.sh` only).

### `tri-agent-harness-cursor` (new)

- Ships: `./cursor-harness.sh`, Cursor handoffs (`runners/cursor/` flattened to top-level scripts), artifact watchdog, Cursor model defaults.
- Does not ship: Claude CLI loop, Retrospector (until explicitly built), Claude slash commands.
- README: honest limits (no Retrospector in v1).
- `docs/guide.html`: Cursor-only walkthrough (`./cursor-harness.sh`); no Claude slash-command section as the happy path.

### `tri-agent-harness-opencode` (new)

- Ships: `./opencode-harness.sh`, OpenCode config/agents, watchdog, OpenCode model defaults.
- Does not ship: Claude/Cursor loops, Retrospector (until built).
- README: honest limits.
- `docs/guide.html`: OpenCode-only walkthrough (`./opencode-harness.sh`).

## Cut procedure

### Phase 1 — This repo becomes Claude-only + `app/`

1. Remove `runners/`, root `cursor-harness.sh` / `opencode-harness.sh` stubs, `scripts/cursor-*.sh` stubs.
2. Remove optional-runner docs from README, `CLAUDE.md`, `docs/runtime-contract.md`, `docs/guide.html` (keep a single “Other tools” link section).
3. Update Generator, pre-QA gate, templates, and tests so the product root is `app/`.
4. Update Starting a product guide accordingly.
5. Tag / commit on `main` as the Claude-only baseline.

### Phase 2 — Create sibling repos on GitHub

1. `gh repo create stjarnstrom/tri-agent-harness-cursor --public` (or private to match parent).
2. Same for `tri-agent-harness-opencode`.
3. From a clean tree at the last multi-runner commit (or current + restore Cursor/OpenCode files from git history):
   - Push filtered content to each new remote.
   - Strip the other tools’ files; rename entry scripts to repo-root happy path.
   - Apply the same `app/` product-root convention.
4. Each sibling README states capabilities and hard limits.

### Phase 3 — Cross-links only

- Claude README → links to Cursor and OpenCode repos as **alternatives**, not adapters.
- Cursor/OpenCode READMEs → link back to Claude as the fullest-featured variant (Retrospector).

## Sync / drift policy

- Improvements to personas, criteria, or the pre-QA gate land in **Claude first**.
- Port to siblings with an explicit PR (or a documented `scripts/port-from-claude.sh` later — not required for v1).
- Lessons: Claude keeps Retrospector; siblings may omit learning-loop docs until parity exists.

## Out of scope (v1)

- Shared published package for the runtime contract.
- Renaming the local checkout directory (`agent-harness-loops` → `tri-agent-harness`) — optional, cosmetic.
- Building Retrospector for Cursor/OpenCode.
- Automating bi-directional sync.

## Success criteria

- A new user cloning `tri-agent-harness` never sees Cursor/OpenCode setup instructions in Quick start.
- Product code cannot be mistaken for harness code (`app/` boundary).
- `tri-agent-harness-cursor` and `tri-agent-harness-opencode` exist on GitHub with working one-command entry points and honest READMEs.
- Each repo has a `docs/guide.html` whose Starting a product / modes / field notes match **that tool only**.
- `npm run test:harness` passes on the Claude repo after the strip + `app/` change.

## Implementation order

1. Spec approved (this doc).
2. Phase 1 in this repo (Claude-only + `app/`).
3. Phase 2 create and populate sibling GitHub repos.
4. Phase 3 cross-links + short announce note in Claude README.
