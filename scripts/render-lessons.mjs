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
