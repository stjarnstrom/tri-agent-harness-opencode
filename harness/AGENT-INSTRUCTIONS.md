# Agent Instructions — Tool-Agnostic Core Rules

These rules apply regardless of which AI coding agent you use (Claude Code, Cursor, OpenCode, etc.).
Each tool reads this file in its own way:

- **Claude Code**: Referenced via `CLAUDE.md` → "Read `harness/AGENT-INSTRUCTIONS.md`"
- **Cursor**: Referenced via `.cursorrules` → same content adapted for Cursor's format
- **OpenCode**: Loaded via `opencode.jsonc` → `instructions` array; phase agents in `.opencode/agents/`

## Domain Packages

When working inside a domain package (e.g. `packages/billing/`), read that package's `CLAUDE.md` before making changes. Claude Code loads these automatically; Cursor, OpenCode, and other tools must read them explicitly.

## The Four Rules Every Agent Must Follow

### 1. Sandbox First

Never read, write, or modify files outside the project root without explicit user permission.
The pre-commit hook (`harness/hooks/pre-commit`) enforces this at git level — but don't rely on it as your only guardrail. If you're about to `cat /etc/passwd` or `rm -rf ~/Downloads`, stop and ask first.

**Network:** In Claude Code, sandboxed Bash commands can only reach the domains allowlisted in `.claude/settings.json` (`sandbox.network.allowedDomains`) — npm registry, Playwright CDN, Anthropic API, GitHub, Google Fonts, and localhost. If a build step fails on a blocked domain, don't work around the sandbox — surface it so the domain can be added to the allowlist deliberately.

**Secrets:** Never read, paste, or hardcode real credentials. The workflow:

1. Read `.env.example` for variable **names** and placeholder shapes — that file is safe to commit.
2. Real values live in `.env.local` or `.env` (gitignored, listed in `.cursorignore`).
3. Reference secrets in code as `process.env.VAR_NAME` — never as string literals.
4. If you need a new env var, add it to `.env.example` with a dummy value and tell the user to set the real one locally.

The pre-commit hook blocks staging `.env` files and scans for leaked keys. OpenCode denies reads of `.env` and credential paths via `opencode.jsonc` `permission.read`; Cursor uses `.cursorignore` (install via `bun run setup`).

### 2. Lints Are Instructions, Not Diagnostics

When a harness lint fires:
- Don't suppress it without reading the message.
- The error message IS the prompt — it tells you exactly what import/path/fix to apply.
- If you've seen this before in this session, suggest adding a rule rather than fixing it manually again.
- See [`CONTRIBUTING.md`](../CONTRIBUTING.md) for the full two-strike workflow.

### 3. Code First, Spec Last

Don't over-engineer upfront. Generate working code from high-level intent, then let the harness refine it:
1. Write the code (messy is fine).
2. Run lints → fix what they tell you.
3. Commit when clean.
4. Document design decisions AFTER merging — the working code IS the spec.

### 4. Catch Your Own Slop

If you correct yourself for the same mistake twice in a session:
- Stop and flag it explicitly.
- Run `bun lint:harness` to check if a rule exists.
- If no rule catches it, propose adding one. Recurring mistakes belong in the harness.

## Context Hygiene — Denied Paths

Junk context is deny-listed, not just gitignored. Dependencies, build output,
lockfiles, coverage reports, and minified/generated artifacts are never source
of truth — reading them burns tokens and degrades retrieval. Each tool enforces
the same list its own way:

- **Claude Code**: `permissions.deny` `Read(...)` rules in `.claude/settings.json`.
  There is no `.claudeignore` — deny rules are the native mechanism, they take
  precedence over allow rules, and they also apply to Grep/Glob and recognized
  file commands in Bash.
- **Cursor**: `.cursorignore` (installed by `bun run setup`).
- **OpenCode**: `permission.read` denies in `opencode.jsonc`.

The denied set: `node_modules/`, `dist/`, `build/`, `.next/`, `out/`,
`.turbo/`, `coverage/`, `.nyc_output/`, `playwright-report/`, `test-results/`,
`blob-report/`, `__pycache__/`, `.venv/`, `venv/`, lockfiles
(`package-lock.json`, `bun.lock`, `yarn.lock`, `pnpm-lock.yaml`), and
minified/map files — plus the secrets listed under Rule 1.

If a read is denied, that is intentional. Do not work around it by shelling
out or copying the file. Get the information a supported way instead:

- Dependency versions → read `package.json`, or run `npm ls <pkg>` / `bun pm ls`.
- Library API shapes → read the package's published types via your editor
  tooling, or its docs — not `node_modules` source.
- Build problems → re-run the build and read its *output log*, not `dist/`.
- Test failures → read the test source and runner output, not `test-results/`.

If a denied path is genuinely required (e.g. debugging a suspected bug inside
a dependency), stop and ask the user to lift the rule for that session rather
than bypassing it.
