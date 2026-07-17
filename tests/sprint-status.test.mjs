import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  computeNextActionFromRows,
  markSprintSkipped,
  readSprintRows,
  updateSprintStatus,
} from "../sdk-orchestrator/sprint-status.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function rowsFromFixture(name) {
  const filePath = path.join(__dirname, "fixtures", name, "sprint-status.md");
  return readSprintRows(filePath);
}

test("missing rows resolves to run-planner", () => {
  const decision = computeNextActionFromRows([]);
  assert.equal(decision.action, "run-planner");
});

test("first not-started sprint resolves to run-generator", async () => {
  const rows = await rowsFromFixture("sprint-1-not-started");
  const decision = computeNextActionFromRows(rows);
  assert.equal(decision.action, "run-generator");
  assert.equal(decision.sprint, 1);
});

test("ready-for-qa sprint resolves to run-evaluator", async () => {
  const rows = await rowsFromFixture("sprint-2-ready-for-qa");
  const decision = computeNextActionFromRows(rows);
  assert.equal(decision.action, "run-evaluator");
  assert.equal(decision.sprint, 2);
});

test("failed sprint resolves to run-generator retry", async () => {
  const rows = await rowsFromFixture("sprint-2-fail");
  const decision = computeNextActionFromRows(rows);
  assert.equal(decision.action, "run-generator");
  assert.equal(decision.sprint, 2);
});

test("all pass resolves to done", async () => {
  const rows = await rowsFromFixture("all-pass");
  const decision = computeNextActionFromRows(rows);
  assert.equal(decision.action, "done");
});

test("skipped sprint resolves to next not-started sprint", async () => {
  const rows = await rowsFromFixture("sprint-1-skipped");
  const decision = computeNextActionFromRows(rows);
  assert.equal(decision.action, "run-generator");
  assert.equal(decision.sprint, 2);
});

test("markSprintSkipped updates sprint status row", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "harness-status-"));
  const filePath = path.join(dir, "sprint-status.md");
  await writeFile(
    filePath,
    `# Sprint Status

| Sprint | Title | Status | Notes |
| --- | --- | --- | --- |
| 1 | Foundation | Fail | Round 3 |
| 2 | Core | Not started | |
`,
    "utf8",
  );

  await markSprintSkipped({
    sprint: 1,
    notes: "Max QA rounds reached; advanced with known issues",
    filePath,
  });

  const rows = await readSprintRows(filePath);
  assert.equal(rows[0].status, "Skipped");

  const raw = await readFile(filePath, "utf8");
  assert.match(raw, /Skipped \| Max QA rounds reached/);
});

test("updateSprintStatus throws when sprint row is missing", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "harness-status-"));
  const filePath = path.join(dir, "sprint-status.md");
  await writeFile(
    filePath,
    `| Sprint | Title | Status | Notes |
| --- | --- | --- | --- |
| 1 | Foundation | Fail | |
`,
    "utf8",
  );

  await assert.rejects(
    () => updateSprintStatus({ sprint: 99, status: "Skipped", filePath }),
    /Sprint 99 not found/,
  );
});
