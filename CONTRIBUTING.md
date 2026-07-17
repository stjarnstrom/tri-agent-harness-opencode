# Contributing to the Harness

This repo is a scaffold, not an application. Contributions here improve the guardrails your team (and agents) operate under. The goal is simple: **every recurring agent mistake should become a permanent constraint**, not a repeated correction in chat.

Read [`harness/AGENT-INSTRUCTIONS.md`](harness/AGENT-INSTRUCTIONS.md) first — especially rules 2 and 4.

## The Two-Strike Rule

If you correct an agent for the **same mistake twice** — in one session, across PRs, or in code review — the harness has failed. Stop fixing it manually and automate it.

```
Agent makes mistake
       ↓
First time  → fix it, log it (see below)
       ↓
Second time → STOP. Open a harness PR instead of another chat correction.
       ↓
Pick the right layer (lint / persona / domain doc / structure)
       ↓
Ship the guardrail → mistake can't recur silently
```

"Same mistake" means the same *class* of error, not necessarily the same line of code. Examples:

- Uses bare `fetch()` instead of your timeout helper
- Hardcodes a type that already exists in `@app/shared-types`
- Imports from `src/internal/` instead of the package public API
- Adds `console.log` in production paths

## Step 1: Log It When It Happens

Don't wait for Friday GC. Log friction as you hit it:

```bash
echo '{"week":"2026-06-29","category":"lint","description":"Agent used bare fetch() in billing checkout","fix":"Already covered by fetch-needs-timeout — ensure rule is enabled in project ESLint config"}' >> .gc-cache/weekly-report.jsonl
```

Use these categories:

| Category | When to use |
|----------|-------------|
| `lint` | A pattern detectable in source code (imports, API calls, file size) |
| `review` | Needs human judgment but repeats often — belongs in a review persona checklist |
| `prompt-ambiguity` | Agent misunderstood project structure or domain boundaries |
| `merge-conflict` | Process/tooling friction, not a code pattern |

Fields:

- `week` — ISO date of the Monday that week starts (e.g. `2026-06-29`)
- `description` — one sentence, specific enough to grep for duplicates
- `fix` — what guardrail would prevent this permanently

`.gc-cache/` is gitignored. Each developer logs locally; Friday GC aggregates patterns.

## Step 2: Pick the Right Layer

Not everything belongs in a lint rule. Use this decision tree:

```
Can ESLint (or similar) detect it reliably from the AST?
  YES → add a lint rule (or extend one-canonical-pattern)
  NO  ↓

Does it need judgment but follow a checklist?
  YES → add to the matching review-personas/*.md
  NO  ↓

Is it domain-specific (billing rules, auth flows)?
  YES → add to packages/<domain>/CLAUDE.md
  NO  ↓

Is it about repo layout or package boundaries?
  YES → update harness/workspace-template.md + TypeScript project references
  NO  ↓

Is it a one-off or env-specific?
  YES → document in README or a runbook — don't automate
```

**Prefer lints when you can.** They're the only layer that runs on every commit without someone remembering to invoke a review agent.

## Step 3: Add a Lint Rule

### When a lint rule is the right fix

- The mistake has a **detectable syntax pattern** (wrong import path, forbidden API call, missing option)
- You'd want it caught **before merge**, not only in review
- The fix is **mechanical** — the error message can tell the agent exactly what to do

### File layout

```
harness/eslint-plugin-harness/
├── index.js              # register new rules here
├── utils.js              # shared helpers (test paths, globs)
└── rules/
    └── my-new-rule.js    # one rule per file
```

### Writing the message (this is the product)

The error message **is the agent prompt**. A good message has:

1. **Category tag** — `[SECURITY]`, `[RELIABILITY]`, `[PATTERN]`, etc.
2. **What's wrong** — one line
3. **How to fix** — numbered steps with exact imports and paths from *your* project
4. **Example** — copy-pasteable correct code

Bad:

```
Avoid using fetch directly.
```

Good (see [`rules/fetch-needs-timeout.js`](harness/eslint-plugin-harness/rules/fetch-needs-timeout.js)):

```
RELIABILITY [fetch-needs-timeout]: This fetch call has no timeout.

Fetch calls must be wrapped in our internal retry/timeout helper.
Import it from @utils/network (or your project's equivalent).

Example:
  import { fetchWithTimeout } from '@utils/network';
  const data = await fetchWithTimeout(url, { timeoutMs: 5000, retries: 2 });
```

### Register and test

1. Add the rule to `harness/eslint-plugin-harness/index.js`
2. Enable it in `.eslintrc.harness.cjs` (start with `'warn'`, escalate to `'error'` once stable)
3. Run `bun lint:harness` on a file that should trigger it
4. Run `bun lint:harness` on the harness itself — new rules must not break the scaffold

### Prefer extending existing rules

Before writing a new rule, check if an existing one covers it:

- Wrong import for a known concept → `one-canonical-pattern` (configure `approvedImports`)
- Oversized file → `file-too-large` or `component-too-large`
- Secret in string literal → `no-leaked-secrets`

## Step 4: Update a Review Persona

Use when the check needs **context or judgment** but still repeats:

- "Did you handle the empty state?"
- "Are error messages user-facing, not raw provider errors?"
- "Is cleanup registered in the useEffect return?"

Edit the matching file in [`review-personas/`](review-personas/):

- `security.md` — secrets, auth, input validation
- `frontend-architecture.md` — component structure, a11y, data fetching
- `reliability.md` — error handling, race conditions, resource cleanup

Add a bullet under **What to Check** with a concrete example. Keep **What NOT to Review** intact — scoped personas work because they refuse to nitpick everything.

## Step 5: Friday GC (Team Ritual)

Every Friday, someone runs:

```bash
bun gc:weekly
```

The script groups duplicate entries from `.gc-cache/weekly-report.jsonl` and prints action items. In a 15-minute standup:

1. Read the recurring issues aloud
2. Assign an owner for each harness PR
3. Close the loop — if something appeared twice, it should not appear a third time

This is cultural, not optional. The script only helps if people log issues during the week.

## Pull Request Checklist (Harness Changes)

When opening a PR that adds or changes guardrails:

- [ ] **Why** — link to or quote the recurring mistake this prevents (GC log entry, PR comment, or session note)
- [ ] **Layer** — lint / persona / CLAUDE.md / structure — and why that layer fits
- [ ] **Message quality** — lint errors read like instructions, not diagnostics
- [ ] **Severity** — new rules start as `warn`; promote to `error` after one sprint if stable
- [ ] **Self-check** — `bun lint:harness` passes; `bun run setup` still works
- [ ] **Docs** — README or CONTRIBUTING updated if the workflow changes

## Sharing Rules Across Projects

The `harness/eslint-plugin-harness/rules/` directory is designed to be copied or submodule'd across repos. When a rule works in one project:

1. Generalize the message (replace project-specific paths with placeholders or config options)
2. Copy the rule file to other projects' harness directories
3. Configure project-specific paths in each repo's `.eslintrc.harness.cjs`

One rule written once should benefit every team repo that adopts the harness.

## What Not to Contribute Here

- **Project-specific business logic** — that belongs in your app's domain packages
- **Rules that fire on false positives constantly** — agents learn to ignore noisy lints; fix the detector or narrow the scope
- **Suppressions without a harness fix** — `eslint-disable` is a last resort; the two-strike rule applies
- **Model-specific prompt tuning** — this harness constrains the environment; it doesn't replace your agent's system prompt

## Getting Help

- Agent behavior basics → [`harness/AGENT-INSTRUCTIONS.md`](harness/AGENT-INSTRUCTIONS.md)
- Repo layout for agents → [`harness/workspace-template.md`](harness/workspace-template.md)
- Adoption guide → [`README.md`](README.md)
