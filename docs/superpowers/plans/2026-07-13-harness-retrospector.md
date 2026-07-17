# Harness Retrospector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the harness learn across runs: capture structured QA-failure lessons, feed them back into agent prompts via a curated `harness/LESSONS.md`, and draft guardrail proposals when a pattern hits 2 strikes.

**Architecture:** A checked-in JSONL ledger (`harness/lessons.jsonl`) is the source of truth. The Evaluator emits structured `LESSON-CANDIDATES` blocks in QA reports; a new Retrospector phase (Fable) updates the ledger at the end of each `harness.sh` run; deterministic scripts render `harness/LESSONS.md` from the ledger, validate it, and merge clone ledgers back into the template repo.

**Tech Stack:** Bash (harness.sh, pre-commit hook), plain Node.js ESM scripts (no new deps), `node --test` for tests, Claude Code subagents/commands for the interactive path.

**Spec:** `docs/superpowers/specs/2026-07-13-harness-retrospector-design.md`

## Global Constraints

- Node >= 20.12.0 (engines field) — `import.meta.dirname` is available.
- No new npm dependencies.
- Ledger categories: exactly `a11y | correctness | design | performance | process | lint`.
- Ledger phases: exactly `planner | generator | evaluator`.
- Ledger statuses: exactly `active | graduated | retired`.
- Max 25 **active** lessons (constant `MAX_ACTIVE_LESSONS = 25`).
- The Retrospector is best-effort: its failure must never fail a harness run.
- `harness/LESSONS.md` is machine-rendered from the ledger — agents/humans never hand-edit it.
- Run `bun lint:harness` before committing; run tests with `npm run test:harness`.
- Commit messages must pass the pre-commit hook (no .env files, no secrets).

---

### Task 1: Lessons core module (pure logic, TDD)

**Files:**
- Create: `scripts/lib/lessons-core.mjs`
- Test: `tests/lessons.test.mjs`

**Interfaces:**
- Produces (used by Tasks 2 and 7):
  - `CATEGORIES: string[]`, `PHASES: string[]`, `STATUSES: string[]`, `MAX_ACTIVE_LESSONS: number`
  - `parseLedger(text: string) -> { entries: Entry[], errors: string[] }` (malformed/invalid lines become errors, never throws)
  - `validateEntry(entry: object) -> string[]` (empty array = valid)
  - `selectActive(entries: Entry[], cap?: number) -> Entry[]` (active only, sorted strikes desc → latest source date desc → id asc, capped)
  - `renderLessonsMd(entries: Entry[]) -> string` (full LESSONS.md content, single trailing newline)
  - `mergeLedgers(baseEntries: Entry[], incomingEntries: Entry[]) -> Entry[]`
  - `serializeLedger(entries: Entry[]) -> string` (one JSON object per line)
  - `latestSourceDate(entry: Entry) -> string`
- Entry shape: `{ id, category, phase, rule, strikes, status, sources: [{ project, sprint, date }] }`

- [ ] **Step 1: Write the failing tests**

Create `tests/lessons.test.mjs` (mirrors the import/test style of `tests/sprint-status.test.mjs`):

```js
import assert from "node:assert/strict";
import test from "node:test";
import {
  CATEGORIES,
  MAX_ACTIVE_LESSONS,
  mergeLedgers,
  parseLedger,
  renderLessonsMd,
  selectActive,
  serializeLedger,
  validateEntry,
} from "../scripts/lib/lessons-core.mjs";

function entry(overrides = {}) {
  return {
    id: "a11y-button-contrast",
    category: "a11y",
    phase: "generator",
    rule: "Verify WCAG AA contrast on all colored interactive elements.",
    strikes: 2,
    status: "active",
    sources: [{ project: "acme-dashboard", sprint: 2, date: "2026-07-13" }],
    ...overrides,
  };
}

test("validateEntry accepts a well-formed entry", () => {
  assert.deepEqual(validateEntry(entry()), []);
});

test("validateEntry rejects bad id, category, phase, strikes, status, sources", () => {
  assert.ok(validateEntry(entry({ id: "Bad Slug!" })).length > 0);
  assert.ok(validateEntry(entry({ category: "vibes" })).length > 0);
  assert.ok(validateEntry(entry({ phase: "retrospector" })).length > 0);
  assert.ok(validateEntry(entry({ strikes: 0 })).length > 0);
  assert.ok(validateEntry(entry({ status: "archived" })).length > 0);
  assert.ok(validateEntry(entry({ sources: [] })).length > 0);
  assert.ok(validateEntry(entry({ rule: "" })).length > 0);
  assert.ok(validateEntry(entry({ rule: "x".repeat(241) })).length > 0);
});

test("parseLedger skips malformed lines and reports errors", () => {
  const good = JSON.stringify(entry());
  const text = `${good}\nnot json\n${JSON.stringify(entry({ id: "second-lesson" }))}\n${JSON.stringify({ id: "missing-fields" })}\n`;
  const { entries, errors } = parseLedger(text);
  assert.equal(entries.length, 2);
  assert.equal(errors.length, 2);
});

test("parseLedger of empty text yields no entries and no errors", () => {
  assert.deepEqual(parseLedger(""), { entries: [], errors: [] });
});

test("selectActive filters, sorts by strikes then recency, and caps", () => {
  const entries = [
    entry({ id: "one-strike", strikes: 1, sources: [{ project: "p", sprint: 1, date: "2026-01-01" }] }),
    entry({ id: "graduated-lesson", status: "graduated", strikes: 9 }),
    entry({ id: "three-strikes", strikes: 3 }),
    entry({ id: "newer-one-strike", strikes: 1, sources: [{ project: "p", sprint: 1, date: "2026-06-01" }] }),
  ];
  const active = selectActive(entries);
  assert.deepEqual(
    active.map((e) => e.id),
    ["three-strikes", "newer-one-strike", "one-strike"],
  );
  const many = Array.from({ length: 30 }, (_, i) => entry({ id: `lesson-${String(i).padStart(2, "0")}` }));
  assert.equal(selectActive(many).length, MAX_ACTIVE_LESSONS);
});

test("renderLessonsMd groups active lessons by phase and skips non-active", () => {
  const md = renderLessonsMd([
    entry({ id: "gen-lesson" }),
    entry({ id: "eval-lesson", phase: "evaluator", category: "process", rule: "Re-test previously passed criteria after fixes." }),
    entry({ id: "grad-lesson", status: "graduated" }),
  ]);
  assert.match(md, /## Generator/);
  assert.match(md, /## Evaluator/);
  assert.match(md, /\*\*\[a11y\]\*\* Verify WCAG AA contrast/);
  assert.match(md, /2 strikes/);
  assert.doesNotMatch(md, /grad-lesson/);
  assert.ok(md.endsWith("\n"));
  assert.ok(!md.endsWith("\n\n"));
});

test("renderLessonsMd with no active lessons renders the empty placeholder", () => {
  const md = renderLessonsMd([]);
  assert.match(md, /No lessons yet/);
});

test("mergeLedgers unions sources, takes max strikes, prefers graduated, keeps base rule text", () => {
  const base = [entry({ rule: "Base wording.", strikes: 2 })];
  const incoming = [
    entry({
      rule: "Clone wording.",
      strikes: 1,
      status: "graduated",
      sources: [
        { project: "acme-dashboard", sprint: 2, date: "2026-07-13" }, // duplicate
        { project: "other-app", sprint: 1, date: "2026-07-20" },
      ],
    }),
    entry({ id: "brand-new-lesson", category: "design" }),
  ];
  const merged = mergeLedgers(base, incoming);
  assert.equal(merged.length, 2);
  const m = merged.find((e) => e.id === "a11y-button-contrast");
  assert.equal(m.sources.length, 2);
  assert.equal(m.strikes, 2);
  assert.equal(m.status, "graduated");
  assert.equal(m.rule, "Base wording.");
});

test("mergeLedgers recurrence bumps strikes to distinct source count", () => {
  const base = [entry({ strikes: 1 })];
  const incoming = [entry({ strikes: 1, sources: [{ project: "other-app", sprint: 3, date: "2026-08-01" }] })];
  const [m] = mergeLedgers(base, incoming);
  assert.equal(m.strikes, 2);
});

test("serializeLedger round-trips through parseLedger", () => {
  const entries = [entry(), entry({ id: "second-lesson" })];
  const { entries: parsed } = parseLedger(serializeLedger(entries));
  assert.deepEqual(parsed, entries);
});

test("CATEGORIES matches the spec", () => {
  assert.deepEqual(CATEGORIES, ["a11y", "correctness", "design", "performance", "process", "lint"]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/lessons.test.mjs`
Expected: FAIL — `Cannot find module '.../scripts/lib/lessons-core.mjs'`

- [ ] **Step 3: Write the implementation**

Create `scripts/lib/lessons-core.mjs`:

```js
// Pure logic for the harness lessons ledger (harness/lessons.jsonl) and the
// rendered harness/LESSONS.md. No filesystem access — CLIs wrap this module.

export const CATEGORIES = ["a11y", "correctness", "design", "performance", "process", "lint"];
export const PHASES = ["planner", "generator", "evaluator"];
export const STATUSES = ["active", "graduated", "retired"];
export const MAX_ACTIVE_LESSONS = 25;

const ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RULE_LENGTH = 240;

function isValidSource(source) {
  return (
    source !== null &&
    typeof source === "object" &&
    typeof source.project === "string" &&
    source.project.length > 0 &&
    Number.isInteger(source.sprint) &&
    typeof source.date === "string" &&
    DATE_PATTERN.test(source.date)
  );
}

export function validateEntry(entry) {
  const problems = [];
  if (typeof entry.id !== "string" || !ID_PATTERN.test(entry.id)) {
    problems.push("id must be a kebab-case slug");
  }
  if (!CATEGORIES.includes(entry.category)) {
    problems.push(`category must be one of ${CATEGORIES.join("|")}`);
  }
  if (!PHASES.includes(entry.phase)) {
    problems.push(`phase must be one of ${PHASES.join("|")}`);
  }
  if (typeof entry.rule !== "string" || entry.rule.trim().length === 0 || entry.rule.length > MAX_RULE_LENGTH) {
    problems.push(`rule must be a non-empty string of at most ${MAX_RULE_LENGTH} chars`);
  }
  if (!Number.isInteger(entry.strikes) || entry.strikes < 1) {
    problems.push("strikes must be a positive integer");
  }
  if (!STATUSES.includes(entry.status)) {
    problems.push(`status must be one of ${STATUSES.join("|")}`);
  }
  if (!Array.isArray(entry.sources) || entry.sources.length === 0 || !entry.sources.every(isValidSource)) {
    problems.push("sources must be a non-empty array of {project, sprint, date}");
  }
  return problems;
}

export function parseLedger(text) {
  const entries = [];
  const errors = [];
  text.split("\n").forEach((line, index) => {
    if (line.trim().length === 0) return;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      errors.push(`line ${index + 1}: invalid JSON`);
      return;
    }
    const problems = validateEntry(parsed);
    if (problems.length > 0) {
      errors.push(`line ${index + 1} (${parsed.id ?? "?"}): ${problems.join("; ")}`);
      return;
    }
    entries.push(parsed);
  });
  return { entries, errors };
}

export function latestSourceDate(entry) {
  return entry.sources.map((s) => s.date).sort().at(-1) ?? "";
}

export function selectActive(entries, cap = MAX_ACTIVE_LESSONS) {
  return entries
    .filter((e) => e.status === "active")
    .sort(
      (a, b) =>
        b.strikes - a.strikes ||
        latestSourceDate(b).localeCompare(latestSourceDate(a)) ||
        a.id.localeCompare(b.id),
    )
    .slice(0, cap);
}

export function renderLessonsMd(entries) {
  const active = selectActive(entries);
  const lines = [
    "# Harness Lessons",
    "",
    "> Machine-maintained. Distilled from QA failures across runs by the",
    "> Retrospector. Source of truth: `harness/lessons.jsonl` — regenerate this",
    "> file with `node scripts/render-lessons.mjs`. Do not edit by hand.",
    "",
  ];
  if (active.length === 0) {
    lines.push("_No lessons yet. Run the harness; the Retrospector fills this in._");
    return lines.join("\n") + "\n";
  }
  for (const phase of PHASES) {
    const phaseEntries = active.filter((e) => e.phase === phase);
    if (phaseEntries.length === 0) continue;
    lines.push(`## ${phase[0].toUpperCase()}${phase.slice(1)}`, "");
    for (const e of phaseEntries) {
      const strikeLabel = e.strikes === 1 ? "1 strike" : `${e.strikes} strikes`;
      lines.push(`- **[${e.category}]** ${e.rule} *(${strikeLabel})*`);
    }
    lines.push("");
  }
  while (lines.at(-1) === "") lines.pop();
  return lines.join("\n") + "\n";
}

const STATUS_RANK = { graduated: 2, active: 1, retired: 0 };

function sourceKey(source) {
  return `${source.project}#${source.sprint}#${source.date}`;
}

// Merge a clone's ledger (incoming) into the template's (base).
// Union sources by (project, sprint, date); strikes is the max of both sides
// and the distinct source count; graduated > active > retired; the base
// (template) rule wording wins.
export function mergeLedgers(baseEntries, incomingEntries) {
  const byId = new Map(baseEntries.map((e) => [e.id, { ...e, sources: [...e.sources] }]));
  for (const incoming of incomingEntries) {
    const base = byId.get(incoming.id);
    if (!base) {
      byId.set(incoming.id, { ...incoming, sources: [...incoming.sources] });
      continue;
    }
    const seen = new Set(base.sources.map(sourceKey));
    for (const source of incoming.sources) {
      if (!seen.has(sourceKey(source))) {
        base.sources.push(source);
        seen.add(sourceKey(source));
      }
    }
    base.strikes = Math.max(base.strikes, incoming.strikes, base.sources.length);
    if (STATUS_RANK[incoming.status] > STATUS_RANK[base.status]) {
      base.status = incoming.status;
    }
  }
  return [...byId.values()];
}

export function serializeLedger(entries) {
  if (entries.length === 0) return "";
  return entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/lessons.test.mjs`
Expected: PASS (all tests)

Also run the full suite: `npm run test:harness`
Expected: PASS (no regressions)

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/lessons-core.mjs tests/lessons.test.mjs
git commit -m "feat(lessons): add lessons ledger core module (parse/validate/render/merge)"
```

---

### Task 2: CLI wrappers, seed files, package scripts, pre-commit validation

**Files:**
- Create: `scripts/validate-lessons.mjs`
- Create: `scripts/render-lessons.mjs`
- Create: `scripts/sync-lessons.mjs`
- Create: `harness/lessons.jsonl` (empty seed)
- Create: `harness/LESSONS.md` (rendered seed)
- Create: `docs/proposals/.gitkeep`
- Modify: `package.json` (scripts block)
- Modify: `harness/hooks/pre-commit` (insert step 2.5 after the JS/TS lint section, before the env-file guard)
- Test: `tests/lessons.test.mjs` (append CLI smoke tests)

**Interfaces:**
- Consumes: everything exported from `scripts/lib/lessons-core.mjs` (Task 1).
- Produces (used by Tasks 4, 5, 8):
  - `node scripts/render-lessons.mjs [rootDir]` — rewrites `<root>/harness/LESSONS.md` from `<root>/harness/lessons.jsonl`; malformed lines warn + skip; exit 0.
  - `node scripts/validate-lessons.mjs [rootDir]` — exit 1 with reasons on: missing files, malformed/invalid lines, duplicate ids, >25 active, LESSONS.md out of sync with render.
  - `node scripts/sync-lessons.mjs <templateDir> [--from <sourceDir>]` — merges source ledger into template ledger, rewrites template ledger + LESSONS.md.
  - npm scripts: `lessons:validate`, `lessons:render`, `lessons:sync`.

- [ ] **Step 1: Append failing CLI smoke tests**

Append to `tests/lessons.test.mjs`:

```js
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const scriptsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "scripts");

async function makeRepo(ledgerText) {
  const root = await mkdtemp(path.join(tmpdir(), "lessons-"));
  await mkdir(path.join(root, "harness"), { recursive: true });
  await writeFile(path.join(root, "harness", "lessons.jsonl"), ledgerText);
  return root;
}

test("render + validate CLIs round-trip on a valid ledger", async () => {
  const root = await makeRepo(JSON.stringify(entry()) + "\n");
  await execFileAsync("node", [path.join(scriptsDir, "render-lessons.mjs"), root]);
  const md = await readFile(path.join(root, "harness", "LESSONS.md"), "utf-8");
  assert.match(md, /Verify WCAG AA contrast/);
  await execFileAsync("node", [path.join(scriptsDir, "validate-lessons.mjs"), root]); // exit 0
});

test("validate CLI fails when LESSONS.md is out of sync", async () => {
  const root = await makeRepo(JSON.stringify(entry()) + "\n");
  await writeFile(path.join(root, "harness", "LESSONS.md"), "# stale\n");
  await assert.rejects(
    execFileAsync("node", [path.join(scriptsDir, "validate-lessons.mjs"), root]),
    (err) => err.code === 1 && /out of sync/.test(err.stderr),
  );
});

test("validate CLI fails on malformed ledger lines", async () => {
  const root = await makeRepo("not json\n");
  await execFileAsync("node", [path.join(scriptsDir, "render-lessons.mjs"), root]);
  await assert.rejects(
    execFileAsync("node", [path.join(scriptsDir, "validate-lessons.mjs"), root]),
    (err) => err.code === 1 && /invalid JSON/.test(err.stderr),
  );
});

test("sync CLI merges a clone ledger into the template", async () => {
  const template = await makeRepo(JSON.stringify(entry()) + "\n");
  const clone = await makeRepo(
    JSON.stringify(entry({ sources: [{ project: "other-app", sprint: 1, date: "2026-07-20" }] })) +
      "\n" +
      JSON.stringify(entry({ id: "brand-new-lesson", category: "design" })) +
      "\n",
  );
  await execFileAsync("node", [path.join(scriptsDir, "sync-lessons.mjs"), template, "--from", clone]);
  const merged = await readFile(path.join(template, "harness", "lessons.jsonl"), "utf-8");
  const { entries } = parseLedger(merged);
  assert.equal(entries.length, 2);
  assert.equal(entries.find((e) => e.id === "a11y-button-contrast").strikes, 2);
  const md = await readFile(path.join(template, "harness", "LESSONS.md"), "utf-8");
  assert.match(md, /brand-new-lesson|design/);
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `node --test tests/lessons.test.mjs`
Expected: Task 1 tests PASS; the four new CLI tests FAIL (scripts don't exist).

- [ ] **Step 3: Write the three CLIs**

Create `scripts/render-lessons.mjs`:

```js
#!/usr/bin/env node
// Rewrite harness/LESSONS.md from harness/lessons.jsonl (the source of truth).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseLedger, renderLessonsMd } from "./lib/lessons-core.mjs";

const root = process.argv[2] ?? join(import.meta.dirname, "..");
const ledgerPath = join(root, "harness", "lessons.jsonl");
const lessonsPath = join(root, "harness", "LESSONS.md");

const text = existsSync(ledgerPath) ? readFileSync(ledgerPath, "utf-8") : "";
const { entries, errors } = parseLedger(text);
for (const error of errors) {
  console.warn(`WARN: skipping ${error}`);
}
writeFileSync(lessonsPath, renderLessonsMd(entries));
console.log(`Rendered ${lessonsPath} (${entries.length} ledger entries).`);
```

Create `scripts/validate-lessons.mjs`:

```js
#!/usr/bin/env node
// Deterministic backstop against LLM-written drift in the lessons ledger.
// Exit 1 on any problem; wired into the pre-commit hook.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { MAX_ACTIVE_LESSONS, parseLedger, renderLessonsMd } from "./lib/lessons-core.mjs";

const root = process.argv[2] ?? join(import.meta.dirname, "..");
const ledgerPath = join(root, "harness", "lessons.jsonl");
const lessonsPath = join(root, "harness", "LESSONS.md");

const problems = [];
if (!existsSync(ledgerPath)) problems.push("harness/lessons.jsonl is missing");
if (!existsSync(lessonsPath)) problems.push("harness/LESSONS.md is missing");

if (problems.length === 0) {
  const { entries, errors } = parseLedger(readFileSync(ledgerPath, "utf-8"));
  problems.push(...errors);

  const ids = new Set();
  for (const entry of entries) {
    if (ids.has(entry.id)) problems.push(`duplicate ledger id: ${entry.id}`);
    ids.add(entry.id);
  }

  const activeCount = entries.filter((e) => e.status === "active").length;
  if (activeCount > MAX_ACTIVE_LESSONS) {
    problems.push(
      `${activeCount} active lessons exceed the cap of ${MAX_ACTIVE_LESSONS} — retire the weakest (status: "retired")`,
    );
  }

  if (renderLessonsMd(entries) !== readFileSync(lessonsPath, "utf-8")) {
    problems.push("harness/LESSONS.md is out of sync with the ledger — run: node scripts/render-lessons.mjs");
  }
}

if (problems.length > 0) {
  console.error("Lessons validation FAILED:");
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log("Lessons validation passed.");
```

Create `scripts/sync-lessons.mjs`:

```js
#!/usr/bin/env node
// Merge this repo's lessons ledger back into the harness template repo, so
// learning from product clones compounds. Usage:
//   node scripts/sync-lessons.mjs <template-repo-path> [--from <source-repo-path>]
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mergeLedgers, parseLedger, renderLessonsMd, serializeLedger } from "./lib/lessons-core.mjs";

const args = process.argv.slice(2);
const fromIndex = args.indexOf("--from");
const sourceRoot = fromIndex !== -1 ? args[fromIndex + 1] : join(import.meta.dirname, "..");
const positional = args.filter((_, i) => i !== fromIndex && i !== fromIndex + 1);
const templateRoot = positional[0];

if (!templateRoot || (fromIndex !== -1 && !args[fromIndex + 1])) {
  console.error("Usage: node scripts/sync-lessons.mjs <template-repo-path> [--from <source-repo-path>]");
  process.exit(1);
}

function readLedger(root, label) {
  const ledgerPath = join(root, "harness", "lessons.jsonl");
  if (!existsSync(ledgerPath)) return [];
  const { entries, errors } = parseLedger(readFileSync(ledgerPath, "utf-8"));
  for (const error of errors) console.warn(`WARN (${label}): skipping ${error}`);
  return entries;
}

const templateEntries = readLedger(templateRoot, "template");
const sourceEntries = readLedger(sourceRoot, "source");
const merged = mergeLedgers(templateEntries, sourceEntries);

writeFileSync(join(templateRoot, "harness", "lessons.jsonl"), serializeLedger(merged));
writeFileSync(join(templateRoot, "harness", "LESSONS.md"), renderLessonsMd(merged));
console.log(
  `Merged ${sourceEntries.length} source entries into template (${templateEntries.length} -> ${merged.length}).`,
);
```

- [ ] **Step 4: Seed the ledger and rendered file, add proposals dir**

```bash
touch harness/lessons.jsonl
node scripts/render-lessons.mjs
mkdir -p docs/proposals && touch docs/proposals/.gitkeep
```

Expected: `harness/LESSONS.md` now contains the "No lessons yet" placeholder.

- [ ] **Step 5: Add npm scripts**

In `package.json`, add to `"scripts"` (after `"gc:weekly"`):

```json
    "lessons:validate": "node scripts/validate-lessons.mjs",
    "lessons:render": "node scripts/render-lessons.mjs",
    "lessons:sync": "node scripts/sync-lessons.mjs",
```

- [ ] **Step 6: Add pre-commit validation step**

In `harness/hooks/pre-commit`, insert between the "Harness lints on staged JS/TS" section and the "Block staging env / credential files" section:

```bash
# ── 2.5 Lessons ledger validation ────────────────────────────────────────────
if echo "$STAGED_FILES" | grep -qE '^harness/(lessons\.jsonl|LESSONS\.md)$'; then
  echo "Validating lessons ledger..."
  if ! node "$ROOT/scripts/validate-lessons.mjs" "$ROOT"; then
    echo ""
    echo "Lessons validation failed. Fix harness/lessons.jsonl or run: node scripts/render-lessons.mjs"
    exit 1
  fi
fi
```

Then reinstall the hook: `bun run setup`

- [ ] **Step 7: Run tests to verify they pass**

Run: `node --test tests/lessons.test.mjs` — Expected: PASS (all, including CLI smoke tests)
Run: `npm run test:harness` — Expected: PASS
Run: `npm run lessons:validate` — Expected: `Lessons validation passed.`
Run: `bash -n harness/hooks/pre-commit` — Expected: no output (valid syntax)

- [ ] **Step 8: Commit** (this commit also exercises the new hook path since `harness/lessons.jsonl` and `harness/LESSONS.md` are staged)

```bash
git add scripts/validate-lessons.mjs scripts/render-lessons.mjs scripts/sync-lessons.mjs \
  harness/lessons.jsonl harness/LESSONS.md docs/proposals/.gitkeep package.json \
  harness/hooks/pre-commit tests/lessons.test.mjs
git commit -m "feat(lessons): add ledger CLIs, seed files, and pre-commit validation"
```

Expected: pre-commit prints `Validating lessons ledger...` then `Lessons validation passed.`

---

### Task 3: Evaluator capture — LESSON-CANDIDATES block + richer failure log

**Files:**
- Modify: `agents/evaluator.md` (report template in the `## Output` section)
- Modify: `.claude/agents/evaluator.md` (task list)
- Modify: `scripts/harness-common.sh` (`log_qa_failure`)

**Interfaces:**
- Produces: every QA report ends with an HTML-comment block `<!-- LESSON-CANDIDATES ... -->` containing YAML-style list items with keys `category`, `phase`, `root_cause`, `rule`. The Retrospector (Task 4) consumes this exact format.
- `log_qa_failure` JSONL gains a `"report"` field with the report path.

- [ ] **Step 1: Extend the QA report template in `agents/evaluator.md`**

In the `## Output` section's report template (the fenced block ending with the `## Recommendation` section), append after the Recommendation section, still inside the template:

```
## Lesson candidates

[REQUIRED, machine-read by the Retrospector. One item per distinct failure
root cause found this round; leave the list empty on a clean PASS. Keep each
rule generalized — a future project should benefit, not just this one.]

<!-- LESSON-CANDIDATES
- category: a11y | correctness | design | performance | process | lint
  phase: planner | generator | evaluator
  root_cause: "One sentence: why this failure happened."
  rule: "Imperative, generalized, max 240 chars: what to do differently next time."
-->
```

And add one rule to the `## Critical mindset` Rules list:

```
- **End every report with the LESSON-CANDIDATES block.** Generalize each root
cause into a rule a future project can apply; an empty block is valid on a
clean pass.
```

- [ ] **Step 2: Update `.claude/agents/evaluator.md`**

In the `## Your task` numbered list, insert after item 5 ("Write the full report..."):

```
6. End the report with the `LESSON-CANDIDATES` block per `agents/evaluator.md` —
   the Retrospector mines it after the run.
```

Renumber the old item 6 ("Update `docs/sprint-status.md`...") to 7.

- [ ] **Step 3: Enrich `log_qa_failure` in `scripts/harness-common.sh`**

Replace the `printf` in `log_qa_failure` with:

```bash
  printf '{"ts":"%s","category":"qa-failure","sprint":%s,"round":%s,"report":"docs/qa-report-sprint-%s.md","description":"Sprint %s failed QA round %s"}\n' \
    "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
    "$sprint" \
    "$qa_round" \
    "$sprint" \
    "$sprint" \
    "$qa_round" \
    >> "$cache_file"
```

- [ ] **Step 4: Verify**

Run: `bash -n scripts/harness-common.sh` — Expected: no output
Run: `grep -c "LESSON-CANDIDATES" agents/evaluator.md .claude/agents/evaluator.md` — Expected: `agents/evaluator.md:2` and `.claude/agents/evaluator.md:1`
Run: `bash -c 'source scripts/harness-common.sh; cd "$(mktemp -d)"; log_qa_failure 3 2; cat .gc-cache/weekly-report.jsonl'` — Expected: one JSON line containing `"report":"docs/qa-report-sprint-3.md"`

- [ ] **Step 5: Commit**

```bash
git add agents/evaluator.md .claude/agents/evaluator.md scripts/harness-common.sh
git commit -m "feat(lessons): evaluator emits structured LESSON-CANDIDATES; richer failure log"
```

---

### Task 4: Retrospector persona, subagent, and /retro command

**Files:**
- Create: `agents/retrospector.md`
- Create: `.claude/agents/retrospector.md`
- Create: `.claude/commands/retro.md`

**Interfaces:**
- Consumes: `LESSON-CANDIDATES` blocks (Task 3 format), `harness/lessons.jsonl` (Task 1 entry shape), `node scripts/render-lessons.mjs` and `node scripts/validate-lessons.mjs` (Task 2).
- Produces: updated `harness/lessons.jsonl` + `harness/LESSONS.md`, proposal files `docs/proposals/guardrail-<id>.md`. Task 5's harness phase invokes this persona.

- [ ] **Step 1: Create `agents/retrospector.md`**

```markdown
# Retrospector Agent

You are the harness's memory. Your job is to distill this run's QA failures
into durable, generalized lessons so future runs do not repeat them — and to
escalate recurring patterns into concrete guardrail proposals.

**Read `harness/AGENT-INSTRUCTIONS.md` for sandbox rules.** You do not write
application code. You write only: `harness/lessons.jsonl`, files under
`docs/proposals/`, and (via the render script) `harness/LESSONS.md`.

---

## Inputs

1. Every `docs/qa-report-sprint-*.md` — especially the `LESSON-CANDIDATES`
   HTML-comment block at the end of each report.
2. `docs/sprint-*-contract.md` — for context on what was being built.
3. `harness/lessons.jsonl` — the existing ledger (one JSON object per line).
4. `.gc-cache/weekly-report.jsonl` if present — QA failure counts.

If no QA reports exist, write nothing and stop.

## Ledger entry format

```json
{"id":"a11y-button-contrast","category":"a11y","phase":"generator","rule":"Verify WCAG AA contrast on all colored interactive elements.","strikes":2,"status":"active","sources":[{"project":"acme-dashboard","sprint":2,"date":"2026-07-13"}]}
```

- `id`: stable kebab-case slug you choose; once created it never changes.
- `category`: `a11y | correctness | design | performance | process | lint`
- `phase`: which agent should absorb the lesson: `planner | generator | evaluator`
- `rule`: imperative, generalized, max 240 chars. A future project must
  benefit — "Sprint 2's button was low-contrast" is an incident, not a lesson.
- `strikes`: distinct (project, sprint) occurrences of this pattern.
- `status`: `active` (in LESSONS.md) | `graduated` (guardrail committed) |
  `retired` (pruned).
- `sources`: one entry per occurrence; `project` is the repo directory name.

## Procedure

1. Collect all lesson candidates from the QA reports.
2. For each candidate, decide: does it match an existing ledger entry
   (same underlying pattern, even if worded differently)?
   - **Match** → append a source `{project, sprint, date}` (skip if that
     project+sprint is already recorded) and set `strikes` to the number of
     distinct sources. Improve the rule wording only if clearly better.
   - **No match** → add a new entry, `strikes: 1`, `status: "active"`.
3. Never delete ledger lines. To prune, set `status` to `"retired"`.
   If active entries exceed 25, retire the weakest (fewest strikes, oldest).
4. Run `node scripts/render-lessons.mjs` to regenerate `harness/LESSONS.md`.
   Never edit that file by hand.
5. Run `node scripts/validate-lessons.mjs` — fix any reported problem.
6. For every **active** entry with `strikes >= 2` that has no file in
   `docs/proposals/`, write a proposal (format below).
7. Commit everything you changed with message
   `chore(retro): distill lessons from this run`.

## Guardrail proposal format

Write `docs/proposals/guardrail-<id>.md`:

```markdown
# Guardrail proposal: <id>

**Lesson:** <rule text> (<N> strikes: <project/sprint list>)
**Mechanism:** ESLint harness rule | review-persona checklist item | pre-QA gate check
**Status:** proposed — a human reviews, commits the guardrail, then sets the
ledger entry's status to "graduated".

## Draft implementation

[The actual artifact, complete and ready to review:
- For a lint rule: the rule source for harness/eslint-plugin-harness/ plus
  where to register it.
- For a persona item: the exact checklist lines to add and to which file in
  review-personas/.
- For a gate check: the exact block to add to scripts/pre-qa-gate.sh.]

## Why this beats a lesson

[1-2 sentences: what the guardrail catches mechanically that prompt-reading
might miss.]
```

## Judgment rules

- Be selective. One sharp lesson beats five vague ones. Skip candidates that
  are one-off flukes with no generalizable rule.
- Merge aggressively: "buttons lack contrast" and "text unreadable on colored
  background" are the same pattern (`a11y` contrast).
- A lesson must change future behavior. If you cannot say what an agent would
  do *differently*, it is not a lesson.
- Do not log lessons about the harness itself here; those belong in
  `.gc-cache/weekly-report.jsonl` for the weekly GC.
```

- [ ] **Step 2: Create `.claude/agents/retrospector.md`**

```markdown
---
name: retrospector
description: Retrospector phase of the harness. Use after a run (or on demand via /retro) to distill QA failures into the lessons ledger, regenerate harness/LESSONS.md, and draft guardrail proposals for recurring patterns. Runs in its own isolated context.
tools: Read, Write, Edit, Glob, Grep, Bash
model: claude-fable-5
---

You are the **Retrospector Agent** of the build harness — its cross-run memory.

You run in your **own isolated context**. Assume no prior conversation; every
input is on disk. You never modify application code, agent personas, lint
rules, or review personas directly — recurring patterns become *proposals* in
`docs/proposals/` for a human to review.

## Required reading (before you write anything)

1. `agents/retrospector.md` — your full persona: ledger format, matching
   rules, proposal template. Read it in full and follow it exactly.
2. `harness/AGENT-INSTRUCTIONS.md` — sandbox rules.
3. Every `docs/qa-report-sprint-*.md` (the `LESSON-CANDIDATES` blocks) and
   `docs/sprint-*-contract.md`.
4. `harness/lessons.jsonl` — the existing ledger.

## Your task

1. Distill this run's QA failures into ledger updates per your persona.
2. Run `node scripts/render-lessons.mjs`, then `node scripts/validate-lessons.mjs`
   and fix any problems it reports.
3. Draft `docs/proposals/guardrail-<id>.md` for active lessons at 2+ strikes
   that lack one.
4. Commit with `chore(retro): distill lessons from this run`.

If there are no QA reports, stop and report that there is nothing to learn.

## Return to the orchestrator

Return a concise summary: lessons added/updated (id + strikes), lessons
retired, proposals drafted, and validation status. Your final message is read
by the orchestrator; the ledger and proposals are the real output.
```

- [ ] **Step 3: Create `.claude/commands/retro.md`**

```markdown
Dispatch the retrospective to the **retrospector** subagent so it runs in its
own clean, isolated context — do **not** distill lessons in this conversation
yourself.

Launch the `retrospector` subagent now using the Agent tool
(`subagent_type: retrospector`). Pass it this task:

> Read `agents/retrospector.md` and your other required inputs. Distill the
> `LESSON-CANDIDATES` blocks from all QA reports into `harness/lessons.jsonl`,
> regenerate `harness/LESSONS.md` via `node scripts/render-lessons.mjs`, run
> `node scripts/validate-lessons.mjs`, draft guardrail proposals for lessons at
> 2+ strikes, and commit.
>
> Additional context: $ARGUMENTS

Why a subagent: distillation should judge the run's artifacts cold, without
this session's context biasing which failures feel important. All handoff is
through files: the ledger, `harness/LESSONS.md`, and `docs/proposals/`.

When the subagent returns, relay its summary to me: lessons added/updated,
lessons retired, proposals drafted (these need my review), and validation
status.
```

- [ ] **Step 4: Verify**

Run: `npm run lessons:validate` — Expected: passes (persona files don't touch the ledger)
Run: `grep -l "subagent_type: retrospector" .claude/commands/retro.md` — Expected: the file path prints

- [ ] **Step 5: Commit**

```bash
git add agents/retrospector.md .claude/agents/retrospector.md .claude/commands/retro.md
git commit -m "feat(lessons): add Retrospector persona, subagent, and /retro command"
```

---

### Task 5: Retrospector phase in harness.sh (autonomous path)

**Files:**
- Modify: `harness.sh` (model policy block, new function, call after sprint loop, header echo)
- Modify: `scripts/harness-common.sh` (`handle_max_rounds` halt path invokes an optional hook)

**Interfaces:**
- Consumes: `agents/retrospector.md` (Task 4), `$GUARDRAIL_CONTEXT` / `$HARNESS_AUTONOMOUS_SUFFIX` (existing).
- Produces: `HARNESS_RETRO` (`on` default | `off`), `HARNESS_RETRO_MODEL` (default `claude-fable-5`), function `harness_run_retro_hook` consumed by `handle_max_rounds`.

- [ ] **Step 1: Add the retro model to the model policy block in `harness.sh`**

After the line `HARNESS_EVALUATOR_MODEL="${HARNESS_EVALUATOR_MODEL:-claude-fable-5}"` add:

```bash
HARNESS_RETRO_MODEL="${HARNESS_RETRO_MODEL:-claude-fable-5}"
```

After `EVALUATOR_MODEL="${HARNESS_MODEL:-$HARNESS_EVALUATOR_MODEL}"` add:

```bash
RETRO_MODEL="${HARNESS_MODEL:-$HARNESS_RETRO_MODEL}"
```

After `evaluator_model_args=(--model "$EVALUATOR_MODEL")` add:

```bash
retro_model_args=(--model "$RETRO_MODEL")
```

In the startup banner, change the `echo "  Models: ..."` line to:

```bash
  echo "  Models: planner=$PLANNER_MODEL  generator=$GENERATOR_MODEL  evaluator=$EVALUATOR_MODEL  retro=$RETRO_MODEL"
```

- [ ] **Step 2: Define the retro function in `harness.sh`**

Insert immediately after the model-args block (before the "Ensure guardrails are installed" section), so it is defined before the sprint loop can halt:

```bash
# ─── Retrospector (cross-run learning, best-effort) ─────────────────
# Runs at the end of every run — including halts — unless HARNESS_RETRO=off.
# Failure here never fails the run: learning is best-effort.
harness_run_retrospector() {
  if [ "${HARNESS_RETRO:-on}" = "off" ]; then
    echo ""
    echo "▶ RETROSPECTOR skipped (HARNESS_RETRO=off)"
    return 0
  fi
  if ! ls docs/qa-report-sprint-*.md >/dev/null 2>&1; then
    echo ""
    echo "▶ RETROSPECTOR skipped (no QA reports to learn from)"
    return 0
  fi

  echo ""
  echo "▶ PHASE 3: RETROSPECTOR"
  echo "  Distilling lessons from this run's QA reports..."
  echo ""

  if ! claude --dangerously-skip-permissions \
    "${retro_model_args[@]}" \
    -p "$(cat agents/retrospector.md)

$GUARDRAIL_CONTEXT
Read every docs/qa-report-sprint-*.md (the LESSON-CANDIDATES blocks) and every docs/sprint-*-contract.md.
Read harness/lessons.jsonl — the existing ledger.

Update the ledger per your instructions. Then run 'node scripts/render-lessons.mjs', then 'node scripts/validate-lessons.mjs' and fix any problems. Draft docs/proposals/guardrail-<id>.md for active lessons at 2+ strikes. Commit with message 'chore(retro): distill lessons from this run'.
$HARNESS_AUTONOMOUS_SUFFIX"; then
    echo "⚠ Retrospector failed — continuing (learning is best-effort)."
  fi
}

# Hook consumed by handle_max_rounds (harness-common.sh) on the halt path.
harness_run_retro_hook() {
  harness_run_retrospector
}
```

- [ ] **Step 3: Call it after the sprint loop**

In `harness.sh`, between the end of the sprint `while` loop (`done` at the outer loop) and the `# ─── Summary ───` section, add:

```bash
# ─── Phase 3: Retrospector ──────────────────────────────────────────
harness_run_retrospector
```

- [ ] **Step 4: Invoke the hook on the halt path in `scripts/harness-common.sh`**

In `handle_max_rounds`, the halt branch currently ends with `exit 1`. Immediately before the `echo ""` that starts the halt message, add:

```bash
  if declare -F harness_run_retro_hook >/dev/null; then
    harness_run_retro_hook
  fi
```

(The cursor/opencode runners source this file but do not define the hook, so it is a no-op there.)

- [ ] **Step 5: Verify**

Run: `bash -n harness.sh && bash -n scripts/harness-common.sh` — Expected: no output
Run: `npm run test:harness` — Expected: PASS
Run: `grep -n "harness_run_retro_hook" harness.sh scripts/harness-common.sh` — Expected: definition in harness.sh, invocation in harness-common.sh

- [ ] **Step 6: Commit**

```bash
git add harness.sh scripts/harness-common.sh
git commit -m "feat(lessons): run Retrospector phase at end of every harness run"
```

---

### Task 6: Inject LESSONS.md into all agent prompts

**Files:**
- Modify: `scripts/harness-common.sh` (new `LESSONS_CONTEXT` block; planner prompt builder)
- Modify: `harness.sh` (generator and evaluator prompts)
- Modify: `.claude/agents/planner.md`, `.claude/agents/generator.md`, `.claude/agents/evaluator.md` (required reading lists)

**Interfaces:**
- Consumes: `harness/LESSONS.md` (Task 2).
- Produces: `LESSONS_CONTEXT` shell variable available to all runners sourcing harness-common.sh.

- [ ] **Step 1: Add `LESSONS_CONTEXT` to `scripts/harness-common.sh`**

In the "Shared agent context blocks" section, after the `GUARDRAIL_CONTEXT` definition, add:

```bash
LESSONS_CONTEXT="
Read harness/LESSONS.md — distilled lessons from previous runs' QA failures. Treat the entries in your phase's section as binding instructions, not suggestions."
```

- [ ] **Step 2: Inject into the planner prompt builder**

In `harness_build_planner_prompt` (same file), after the line `printf '%s\n' "$GUARDRAIL_CONTEXT"` add:

```bash
  printf '%s\n' "$LESSONS_CONTEXT"
```

- [ ] **Step 3: Inject into the generator and evaluator prompts in `harness.sh`**

In the Generator `claude -p` heredoc-style prompt, after the line `$GENERATOR_LINT_CONTEXT` add a line:

```
$LESSONS_CONTEXT
```

In the Evaluator prompt, after the line `$GUARDRAIL_CONTEXT` add a line:

```
$LESSONS_CONTEXT
```

- [ ] **Step 4: Add to the interactive subagents' required reading**

In `.claude/agents/planner.md`, `.claude/agents/generator.md`, and `.claude/agents/evaluator.md`, add this bullet to the end of each "Required reading" numbered list (adjusting the number to continue the list):

```
N. `harness/LESSONS.md` — distilled lessons from previous runs' QA failures.
   Treat the entries in your phase's section as binding instructions.
```

- [ ] **Step 5: Verify**

Run: `bash -n harness.sh && bash -n scripts/harness-common.sh` — Expected: no output
Run: `bash -c 'source scripts/harness-common.sh; harness_build_planner_prompt "test prompt" | grep -c "harness/LESSONS.md"'` — Expected: `1`
Run: `grep -l "harness/LESSONS.md" .claude/agents/planner.md .claude/agents/generator.md .claude/agents/evaluator.md` — Expected: all three paths print

- [ ] **Step 6: Commit**

```bash
git add scripts/harness-common.sh harness.sh .claude/agents/planner.md .claude/agents/generator.md .claude/agents/evaluator.md
git commit -m "feat(lessons): all agents read harness/LESSONS.md as required reading"
```

---

### Task 7: Teach anti-slop.mjs about the ledger

**Files:**
- Modify: `scripts/anti-slop.mjs`

**Interfaces:**
- Consumes: `parseLedger` from `scripts/lib/lessons-core.mjs` (Task 1), `harness/lessons.jsonl` (Task 2).

- [ ] **Step 1: Add a lessons summary section**

IMPORTANT: `anti-slop.mjs` calls `process.exit(0)` when no weekly entries exist, so the summary must print BEFORE that early exit — not at the end of the file.

In `scripts/anti-slop.mjs`, add to the imports:

```js
import { parseLedger } from './lib/lessons-core.mjs';
```

Add this function right after the `getWeekStart()` function definition:

```js
function printLessonsSummary() {
  const ledgerFile = join(ROOT, 'harness', 'lessons.jsonl');
  if (!existsSync(ledgerFile)) return;
  const { entries, errors } = parseLedger(readFileSync(ledgerFile, 'utf-8'));
  for (const error of errors) console.warn(`WARN (lessons ledger): ${error}`);
  const active = entries.filter((e) => e.status === 'active');
  const escalatable = active.filter((e) => e.strikes >= 2);
  console.log('=== Lessons ledger (harness/lessons.jsonl) ===');
  console.log(`  Active: ${active.length}  Graduated: ${entries.filter((e) => e.status === 'graduated').length}  Retired: ${entries.filter((e) => e.status === 'retired').length}`);
  if (escalatable.length > 0) {
    console.log('  At 2+ strikes (check docs/proposals/ for pending guardrail proposals):');
    for (const e of escalatable) {
      console.log(`    - [${e.phase}][${e.category}] ${e.id} (${e.strikes} strikes)`);
    }
  }
  console.log('');
}
```

Then call it right after the `console.log(\`Week starting: ...\`)` line (before the early-exit block):

```js
printLessonsSummary();
```

- [ ] **Step 2: Verify**

Run: `bun gc:weekly` — Expected: existing output plus a `=== Lessons ledger ===` section reporting `Active lessons: 0  Graduated: 0  Retired: 0`

- [ ] **Step 3: Commit**

```bash
git add scripts/anti-slop.mjs
git commit -m "feat(lessons): weekly GC reports lessons ledger status"
```

---

### Task 8: Documentation — README, CLAUDE.md, runtime contract

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`
- Modify: `docs/runtime-contract.md`

**Interfaces:** none (documentation of Tasks 1–7's behavior; all names below must match what those tasks shipped: `HARNESS_RETRO`, `HARNESS_RETRO_MODEL`, `lessons:validate|render|sync`, `/project:retro`, `harness/LESSONS.md`, `harness/lessons.jsonl`, `docs/proposals/guardrail-<id>.md`).

- [ ] **Step 1: README.md**

Add a top-level section `## Learning loop (Retrospector)` after the `## What happens during a run` section:

```markdown
## Learning loop (Retrospector)

The harness learns across runs. At the end of every `./harness.sh` run
(including halts), a fourth phase — the **Retrospector** (Fable) — mines the
`LESSON-CANDIDATES` blocks the Evaluator writes into each QA report:

1. **Ledger** — patterns land in `harness/lessons.jsonl` (checked in), with a
   stable id, strike count, and sources.
2. **Lessons** — `node scripts/render-lessons.mjs` regenerates
   `harness/LESSONS.md` from the ledger: max 25 active lessons, grouped by
   phase. All three agents read it as required reading on every run.
3. **Guardrail proposals** — a lesson at 2+ strikes gets a draft guardrail in
   `docs/proposals/guardrail-<id>.md` (a real lint rule, persona checklist
   item, or gate check). A human reviews and commits it; the lesson then
   graduates out of LESSONS.md — enforced beats remembered.

Commands:

```bash
HARNESS_RETRO=off ./harness.sh "..."   # skip the retro phase
bun lessons:validate                    # ledger + LESSONS.md consistency check
bun lessons:render                      # regenerate LESSONS.md from the ledger
bun lessons:sync <template-repo-path>   # merge a product clone's ledger home
```

Interactive equivalent: `/project:retro` dispatches the `retrospector`
subagent on demand.
```

In the environment-variables section of the README, add rows/lines for
`HARNESS_RETRO` (`on` default | `off`) and `HARNESS_RETRO_MODEL`
(default `claude-fable-5`, overridden by `HARNESS_MODEL`).

- [ ] **Step 2: CLAUDE.md**

1. In the "Orchestration (who runs when)" list, add after the Evaluator line:
   ```
   - **Retrospector** (Fable): End-of-run learning — distills QA failures into `harness/LESSONS.md` and drafts guardrail proposals at 2 strikes.
   ```
2. In the model policy table, add the row:
   ```
   | Retrospector | `claude-fable-5` | Judgment call: generalizing failures into durable lessons |
   ```
   and mention `HARNESS_RETRO_MODEL` in the override sentence.
3. In "Interactive mode (Claude Code slash commands)", add:
   ```
   - `/project:retro` — Distill QA failures into lessons and guardrail proposals
   ```
4. In "Commands → Autonomous mode", add:
   ```bash
   HARNESS_RETRO=off ./harness.sh "..."       # skip end-of-run learning
   ```
5. In "Guardrails", add:
   ```
   - `bun lessons:validate` / `bun lessons:render` / `bun lessons:sync` — lessons ledger tools (see README "Learning loop")
   ```
6. In the "Docs" list, add:
   ```
   - Lessons: `harness/LESSONS.md` (rendered) / `harness/lessons.jsonl` (ledger)
   - Guardrail proposals: `docs/proposals/guardrail-[id].md`
   ```

- [ ] **Step 3: docs/runtime-contract.md**

1. In the runner list at the top, no change needed. In "Architecture Layers", change layer 2 to:
   ```
   2. **Orchestration:** Planner → Generator → **Pre-QA Gate** → Evaluator loop, then **Retrospector** at end of run.
   ```
2. Under "Canonical Files", add a subsection:
   ```markdown
   ### Learning artifacts (owned by the Retrospector)
   - `harness/lessons.jsonl`: cross-run lessons ledger (source of truth; append/update entries, never hand-edit LESSONS.md).
   - `harness/LESSONS.md`: rendered from the ledger by `scripts/render-lessons.mjs`; required reading for Planner, Generator, and Evaluator.
   - `docs/proposals/guardrail-[id].md`: draft guardrails for lessons at 2+ strikes; humans review, commit, then mark the ledger entry `graduated`.
   - `docs/qa-report-sprint-[N].md` gains a required `LESSON-CANDIDATES` block (written by the Evaluator, consumed by the Retrospector).
   ```
3. In the model-policy paragraph, add the Retrospector on `claude-fable-5` with `HARNESS_RETRO_MODEL` override, and note `HARNESS_RETRO=off` disables the phase on `harness.sh` (the Cursor/OpenCode runners do not run it yet).

- [ ] **Step 4: Verify**

Run: `grep -c "Retrospector" README.md CLAUDE.md docs/runtime-contract.md` — Expected: nonzero count in each
Run: `npm run test:harness && npm run lessons:validate` — Expected: PASS / passed

- [ ] **Step 5: Commit**

```bash
git add README.md CLAUDE.md docs/runtime-contract.md
git commit -m "docs(lessons): document the Retrospector learning loop"
```

---

## Final verification (after all tasks)

- [ ] `npm run test:harness` — all tests pass
- [ ] `npm run lessons:validate` — passes
- [ ] `bun lint:harness scripts/lib/lessons-core.mjs scripts/validate-lessons.mjs scripts/render-lessons.mjs scripts/sync-lessons.mjs` — clean
- [ ] `bash -n harness.sh && bash -n scripts/harness-common.sh && bash -n harness/hooks/pre-commit` — clean
- [ ] End-to-end dry run of the retro path without burning tokens: create a fake `docs/qa-report-sprint-1.md` containing a `LESSON-CANDIDATES` block in a scratch clone, run `HARNESS_RETRO=off ./harness.sh` → confirm the skip message; then confirm `/project:retro` exists in `.claude/commands/`. (A live retro run happens naturally on the next real harness run.)
