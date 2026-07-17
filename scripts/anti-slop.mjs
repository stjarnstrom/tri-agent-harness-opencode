#!/usr/bin/env node
// Anti-slop weekly garbage collection script.
// Run every Friday: identifies friction points from the past week's PRs,
// then helps convert recurring issues into automated guardrails.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { parseLedger } from './lib/lessons-core.mjs';

const __dirname = import.meta.dirname;
const ROOT = join(__dirname, '..');
// HARNESS_GC_DIR override lets tests point at a fixture cache.
const GC_DIR = process.env.HARNESS_GC_DIR || join(ROOT, '.gc-cache');
const REPORT_FILE = join(GC_DIR, 'weekly-report.jsonl');

// Ensure cache directory exists.
if (!existsSync(GC_DIR)) {
  mkdirSync(GC_DIR, { recursive: true });
}

function loadReport() {
  if (!existsSync(REPORT_FILE)) {
    return [];
  }
  const entries = [];
  const lines = readFileSync(REPORT_FILE, 'utf-8').split('\n').filter(Boolean);
  for (const [index, line] of lines.entries()) {
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === 'object') {
        entries.push(parsed);
      }
    } catch {
      console.warn(`WARN (weekly-report.jsonl): skipping invalid JSON on line ${index + 1}`);
    }
  }
  return entries;
}

function saveReport(entries) {
  writeFileSync(REPORT_FILE, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
}

function getWeekStart() {
  const now = new Date();
  const day = now.getDay(); // 0=Sun
  const diffToMonday = (day + 6) % 7; // days since Monday
  const monday = new Date(now);
  monday.setDate(now.getDate() - diffToMonday);
  // Format from local parts — toISOString() would shift the date in UTC+ zones.
  const pad = (n) => String(n).padStart(2, '0');
  return `${monday.getFullYear()}-${pad(monday.getMonth() + 1)}-${pad(monday.getDate())}`;
}

// log_qa_failure (harness-common.sh) stamps entries with ts; manual entries use week.
function entryWeek(entry) {
  if (typeof entry.week === 'string') return entry.week;
  if (typeof entry.ts === 'string') return entry.ts.split('T')[0];
  return null;
}

// Repeat QA failures of one sprint differ per round in description — group by sprint.
function groupKey(entry) {
  if (entry.category === 'qa-failure' && entry.sprint !== undefined) {
    return `qa-failure:sprint-${entry.sprint}`;
  }
  return `${entry.category}:${entry.description}`;
}

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

console.log('=== Harness Anti-Slop Weekly GC ===\n');
console.log(`Week starting: ${getWeekStart()}\n`);
printLessonsSummary();

// Load previous entries to find recurring patterns.
const allEntries = loadReport();
const weekStart = getWeekStart();
const thisWeeksEntries = allEntries.filter((e) => {
  const week = entryWeek(e);
  return week !== null && week >= weekStart;
});

if (thisWeeksEntries.length === 0) {
  console.log('No issues logged this week.\n');
  console.log('To log an issue, run:');
  console.log('  echo \'{"week":"...","category":"lint|review|merge-conflict|prompt-ambiguity","description":"...","fix":"..."}\' >> .gc-cache/weekly-report.jsonl\n');
  console.log('At end of week, review duplicates to identify patterns for automation.');
  process.exit(0);
}

// Group by category and description to find recurring issues.
const groups = new Map();
for (const entry of thisWeeksEntries) {
  const key = groupKey(entry);
  if (!groups.has(key)) {
    groups.set(key, []);
  }
  groups.get(key).push(entry);
}

console.log('Recurring issues found:\n');
for (const [key, entries] of groups) {
  if (entries.length > 1) {
    const [{ category, description, fix }] = entries;
    console.log(`  [${category}] "${description}" — ${entries.length} times`);
    console.log(`    Suggested fix: ${fix || 'Automate this into a lint rule or review persona.'}\n`);
  }
}

const duplicates = [...groups.entries()].filter(([, v]) => v.length > 1).length;
console.log(`\nTotal recurring issues: ${duplicates}`);
if (duplicates > 0) {
  console.log('\nThis week\'s action items:');
  for (const [, entries] of groups) {
    if (entries.length > 1) {
      const [{ category, description }] = entries;
      console.log(`  - Convert "${description}" into a ${category === 'lint' ? 'custom lint rule' : category === 'review' ? 'review persona checklist item' : 'process improvement'}`);
    }
  }
}
