import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
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
  // The graduated entry gets rule text that appears nowhere else, so the
  // doesNotMatch below actually fails if graduated entries are rendered
  // (the markdown never contains ids, only rule text).
  const md = renderLessonsMd([
    entry({ id: "gen-lesson" }),
    entry({ id: "eval-lesson", phase: "evaluator", category: "process", rule: "Re-test previously passed criteria after fixes." }),
    entry({ id: "grad-lesson", status: "graduated", rule: "Graduated-only wording that must never be rendered." }),
  ]);
  assert.match(md, /## Generator/);
  assert.match(md, /## Evaluator/);
  assert.match(md, /\*\*\[a11y\]\*\* Verify WCAG AA contrast/);
  assert.match(md, /2 strikes/);
  assert.doesNotMatch(md, /Graduated-only wording that must never be rendered/);
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

// ─── CLI smoke tests ─────────────────────────────────────────────────

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
  // Distinctive rule text: rendered LESSONS.md contains rule text (not ids),
  // and a bare /design/ match would be satisfied by the category label alone.
  const clone = await makeRepo(
    JSON.stringify(entry({ sources: [{ project: "other-app", sprint: 1, date: "2026-07-20" }] })) +
      "\n" +
      JSON.stringify(
        entry({
          id: "brand-new-lesson",
          category: "design",
          rule: "Use the committed palette tokens for every chart series color.",
        }),
      ) +
      "\n",
  );
  await execFileAsync("node", [path.join(scriptsDir, "sync-lessons.mjs"), template, "--from", clone]);
  const merged = await readFile(path.join(template, "harness", "lessons.jsonl"), "utf-8");
  const { entries } = parseLedger(merged);
  assert.equal(entries.length, 2);
  assert.equal(entries.find((e) => e.id === "a11y-button-contrast").strikes, 2);
  const md = await readFile(path.join(template, "harness", "LESSONS.md"), "utf-8");
  assert.match(md, /Use the committed palette tokens for every chart series color/);
});

test("sync CLI works without --from (defaults source to this repo)", async () => {
  const template = await makeRepo(JSON.stringify(entry()) + "\n");
  await execFileAsync("node", [path.join(scriptsDir, "sync-lessons.mjs"), template]);
  const merged = await readFile(path.join(template, "harness", "lessons.jsonl"), "utf-8");
  const { entries } = parseLedger(merged);
  assert.ok(entries.some((e) => e.id === "a11y-button-contrast"));
});

test("sync CLI rejects --from with no value", async () => {
  const template = await makeRepo(JSON.stringify(entry()) + "\n");
  await assert.rejects(
    execFileAsync("node", [path.join(scriptsDir, "sync-lessons.mjs"), template, "--from"]),
    (err) => err.code === 1 && /Usage/.test(err.stderr),
  );
});
