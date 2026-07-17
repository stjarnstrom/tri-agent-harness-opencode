import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

async function makeProject({ status, report }) {
  const dir = await mkdtemp(path.join(tmpdir(), "qa-pass-"));
  await mkdir(path.join(dir, "docs"), { recursive: true });
  await writeFile(
    path.join(dir, "docs", "sprint-status.md"),
    [
      "# Sprint Status",
      "",
      "| Sprint | Title | Status | Notes |",
      "| --- | --- | --- | --- |",
      `| 1 | Foundation | ${status} | |`,
      "",
    ].join("\n"),
  );
  if (report !== undefined) {
    await writeFile(path.join(dir, "docs", "qa-report-sprint-1.md"), report);
  }
  return dir;
}

async function bashSprintPassed(cwd) {
  try {
    await execFileAsync(
      "bash",
      ["-c", `source "${ROOT}/scripts/harness-common.sh"; sprint_passed 1`],
      { cwd },
    );
    return true;
  } catch (error) {
    if (typeof error.code === "number") return false;
    throw error;
  }
}

async function mjsSprintPassed(cwd) {
  const { sprintPassed } = await import("../sdk-orchestrator/validate.mjs");
  const prev = process.cwd();
  process.chdir(cwd);
  try {
    return await sprintPassed(1);
  } finally {
    process.chdir(prev);
  }
}

const FAIL_REPORT_WITH_PASS_WORD = [
  "# QA Report — Sprint 1",
  "",
  "Result: FAIL — 12 of 15 criteria passed",
  "",
].join("\n");

const TEMPLATE_REPORT = [
  "# QA Report — Sprint 1",
  "",
  "Result: PASS / FAIL",
  "",
].join("\n");

const PASS_REPORT = [
  "# QA Report — Sprint 1",
  "",
  "Result: PASS",
  "",
].join("\n");

test("bash sprint_passed rejects FAIL report mentioning criteria passed", async () => {
  const dir = await makeProject({ status: "Fail", report: FAIL_REPORT_WITH_PASS_WORD });
  assert.equal(await bashSprintPassed(dir), false);
});

test("bash sprint_passed rejects template 'Result: PASS / FAIL' line", async () => {
  const dir = await makeProject({ status: "Fail", report: TEMPLATE_REPORT });
  assert.equal(await bashSprintPassed(dir), false);
});

test("bash sprint_passed accepts Pass row with PASS report", async () => {
  const dir = await makeProject({ status: "Pass", report: PASS_REPORT });
  assert.equal(await bashSprintPassed(dir), true);
});

test("bash sprint_passed rejects Fail row even when report says PASS", async () => {
  const dir = await makeProject({ status: "Fail", report: PASS_REPORT });
  assert.equal(await bashSprintPassed(dir), false);
});

test("mjs sprintPassed rejects FAIL report mentioning criteria passed", async () => {
  const dir = await makeProject({ status: "Fail", report: FAIL_REPORT_WITH_PASS_WORD });
  assert.equal(await mjsSprintPassed(dir), false);
});

test("mjs sprintPassed rejects template 'Result: PASS / FAIL' line", async () => {
  const dir = await makeProject({ status: "Fail", report: TEMPLATE_REPORT });
  assert.equal(await mjsSprintPassed(dir), false);
});

test("mjs sprintPassed accepts Pass row", async () => {
  const dir = await makeProject({ status: "Pass", report: PASS_REPORT });
  assert.equal(await mjsSprintPassed(dir), true);
});
