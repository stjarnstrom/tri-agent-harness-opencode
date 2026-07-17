# Three-repo split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship three honest tool-specific harness repos (`tri-agent-harness`, `-cursor`, `-opencode`) with `app/` product root and a matching `docs/guide.html` in each.

**Architecture:** Cut sibling repos from the current multi-runner tree first (so Cursor/OpenCode code is not lost), specialize each, then strip the Claude repo. Shared personas/gate are duplicated; no shared package in v1.

**Tech Stack:** Bash harness scripts, Node tests, GitHub (`gh`), static `docs/guide.html`.

---

## File map

| Area | Claude repo | Cursor repo | OpenCode repo |
|------|-------------|-------------|---------------|
| Entry | `harness.sh` | `cursor-harness.sh` (root) | `opencode-harness.sh` (root) |
| Remove | `runners/`, stubs, other CLIs | `harness.sh`, `.claude/` interactive (optional keep agents md), OpenCode | Claude/Cursor runners |
| Docs | Claude `guide.html` + README | Cursor-flavored `guide.html` + README | OpenCode-flavored `guide.html` + README |
| Product | `app/` via gate + generator | same | same |

---

### Task 1: Amend design for per-repo guide.html

**Files:**
- Modify: `docs/superpowers/specs/2026-07-17-three-repo-split-design.md`

- [ ] **Step 1:** Add success criterion: each repo has a `docs/guide.html` whose quick start / modes / field notes match that tool only.
- [ ] **Step 2:** Commit.

### Task 2: Create GitHub sibling repos + local workdirs

**Files:**
- Create (remote): `stjarnstrom/tri-agent-harness-cursor`, `stjarnstrom/tri-agent-harness-opencode`
- Create (local): sibling directories under `../`

- [ ] **Step 1:** `gh repo create` matching parent visibility.
- [ ] **Step 2:** `cp -R` this tree to `../tri-agent-harness-cursor` and `../tri-agent-harness-opencode`, fresh `git init` or clone empty and copy files — prefer: clone empty remotes, rsync from current tree excluding `.git`.
- [ ] **Step 3:** Verify remotes point at new GitHub repos.

### Task 3: Specialize Cursor repo

**Files (in cursor workdir):**
- Promote `runners/cursor-harness.sh` → `./cursor-harness.sh`
- Promote handoffs to `scripts/cursor-*.sh` or root `scripts/`
- Delete: `harness.sh`, `runners/opencode-harness.sh`, Claude-only marketing
- Rewrite: `README.md`, `docs/guide.html`, `CLAUDE.md` → Cursor-first (honest: no Retrospector)
- Apply `app/` gate changes (same as Task 5)

- [ ] **Step 1:** Restructure entry scripts.
- [ ] **Step 2:** Rewrite README + guide.html for Cursor.
- [ ] **Step 3:** Run `npm run test:harness` if applicable; commit; push `main`.

### Task 4: Specialize OpenCode repo

Same pattern as Task 3 for OpenCode.

- [ ] **Step 1–3:** Mirror Task 3 for OpenCode; push.

### Task 5: Claude repo — strip runners + `app/` product root

**Files (this repo):**
- Delete: `runners/`, `cursor-harness.sh`, `opencode-harness.sh`, `scripts/cursor-*.sh`
- Modify: `scripts/pre-qa-gate.sh`, `tests/pre-qa-gate.test.mjs`, `agents/generator.md`, `.claude/agents/generator.md`, README, CLAUDE.md, runtime-contract, guide.html, harness-common messages
- Create: `app/.gitkeep` + short `app/README.md` explaining product root

- [ ] **Step 1:** Update pre-QA gate to require `app/package.json` + source under `app/` (fail sprint ≥2 if missing).
- [ ] **Step 2:** Update failing tests first, then gate (TDD).
- [ ] **Step 3:** Update generator instructions to scaffold only under `app/`.
- [ ] **Step 4:** Remove all Cursor/OpenCode runner files and docs; add “Other tools” links to sibling GitHub URLs.
- [ ] **Step 5:** Rewrite `docs/guide.html` for Claude-only + `app/` start path.
- [ ] **Step 6:** `npm run test:harness`; commit; push when user asks.

### Task 6: Cross-links

- [ ] **Step 1:** Each README “Other tools” section links to the other two repos.
- [ ] **Step 2:** Each `guide.html` footer or modes section mentions only that tool; optional single external link to siblings.
- [ ] **Step 3:** Commit on each repo.

### Task 7: Verify

- [ ] **Step 1:** Claude: no `runners/` in tree; guide mentions only `./harness.sh`.
- [ ] **Step 2:** Cursor/OpenCode remotes exist and clone cleanly.
- [ ] **Step 3:** All three guides open and match their entry command.

---

## Execution note

Do **Task 2–4 before Task 5** so Cursor/OpenCode code is copied before Claude deletion.
