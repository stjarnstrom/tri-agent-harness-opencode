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
