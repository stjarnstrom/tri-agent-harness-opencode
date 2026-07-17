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
const positional =
  fromIndex === -1 ? args : args.filter((_, i) => i !== fromIndex && i !== fromIndex + 1);
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
