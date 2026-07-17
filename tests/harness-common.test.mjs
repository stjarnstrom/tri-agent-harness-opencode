import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { chmod, mkdtemp, mkdir, writeFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const COMMON = path.join(ROOT, "scripts", "harness-common.sh");

// Run a snippet with harness-common.sh sourced, from `cwd`.
// Returns { code, stdout, stderr } and never throws on non-zero exit.
async function runCommon(cwd, snippet) {
  try {
    const { stdout, stderr } = await execFileAsync(
      "bash",
      ["-c", `source "${COMMON}"; ${snippet}`],
      { cwd },
    );
    return { code: 0, stdout, stderr };
  } catch (error) {
    if (typeof error.code !== "number") throw error;
    return { code: error.code, stdout: error.stdout ?? "", stderr: error.stderr ?? "" };
  }
}

async function makeProject(rows) {
  const dir = await mkdtemp(path.join(tmpdir(), "harness-common-"));
  await mkdir(path.join(dir, "docs"), { recursive: true });
  await writeFile(
    path.join(dir, "docs", "sprint-status.md"),
    [
      "# Sprint Status",
      "",
      "| Sprint | Title | Status | Notes |",
      "| --- | --- | --- | --- |",
      ...rows.map(([num, title, status]) => `| ${num} | ${title} | ${status} | |`),
      "",
    ].join("\n"),
  );
  return dir;
}

// ─── get_total_sprints ────────────────────────────────────────────────

test("get_total_sprints prints a single 0 for a table with no rows", async () => {
  const dir = await makeProject([]);
  const { code, stdout } = await runCommon(dir, "get_total_sprints");
  assert.equal(code, 0);
  assert.equal(stdout.trim(), "0");
  // Regression: `grep -cE ... || echo 0` used to print "0" twice.
  assert.equal(stdout.split("\n").filter(Boolean).length, 1);
});

test("get_total_sprints counts rows", async () => {
  const dir = await makeProject([
    [1, "Foundation", "Pass"],
    [2, "Features", "Not started"],
  ]);
  const { stdout } = await runCommon(dir, "get_total_sprints");
  assert.equal(stdout.trim(), "2");
});

// ─── get_current_sprint ───────────────────────────────────────────────

test("get_current_sprint returns first unfinished sprint", async () => {
  const dir = await makeProject([
    [1, "Foundation", "Pass"],
    [2, "Features", "Not started"],
  ]);
  const { stdout } = await runCommon(dir, "get_current_sprint");
  assert.equal(stdout.trim(), "2");
});

test("get_current_sprint returns done when all pass/skipped", async () => {
  const dir = await makeProject([
    [1, "Foundation", "Pass"],
    [2, "Features", "Skipped"],
  ]);
  const { stdout } = await runCommon(dir, "get_current_sprint");
  assert.equal(stdout.trim(), "done");
});

test("get_current_sprint treats unrecognized status as current and warns", async () => {
  const dir = await makeProject([
    [1, "Foundation", "PASS"], // casing variant is NOT a recognized terminal status
    [2, "Features", "Not started"],
  ]);
  const { stdout, stderr } = await runCommon(dir, "get_current_sprint");
  assert.equal(stdout.trim(), "1");
  assert.match(stderr, /unrecognized status 'PASS'/i);
});

test("get_current_sprint treats 'Blocked' as current and warns", async () => {
  const dir = await makeProject([
    [1, "Foundation", "Pass"],
    [2, "Features", "Blocked"],
    [3, "Polish", "Not started"],
  ]);
  const { stdout, stderr } = await runCommon(dir, "get_current_sprint");
  assert.equal(stdout.trim(), "2");
  assert.match(stderr, /unrecognized status 'Blocked'/i);
});

// ─── harness_require_positive_int / harness_validate_run_config ──────

test("harness_require_positive_int accepts positive integers", async () => {
  const dir = await makeProject([]);
  for (const value of ["1", "3", "10"]) {
    const { code } = await runCommon(dir, `harness_require_positive_int MAX_QA_ROUNDS "${value}"`);
    assert.equal(code, 0, `expected '${value}' to be accepted`);
  }
});

test("harness_require_positive_int rejects non-integers and zero", async () => {
  const dir = await makeProject([]);
  for (const value of ["abc", "", "0", "-1", "1.5", "2x"]) {
    const { code, stderr } = await runCommon(
      dir,
      `harness_require_positive_int MAX_QA_ROUNDS "${value}"`,
    );
    assert.notEqual(code, 0, `expected '${value}' to be rejected`);
    assert.match(stderr, /MAX_QA_ROUNDS/);
  }
});

test("harness_validate_run_config validates HARNESS_MAX_SPRINTS_PER_RUN when set", async () => {
  const dir = await makeProject([]);
  let result = await runCommon(dir, 'HARNESS_MAX_SPRINTS_PER_RUN=abc; harness_validate_run_config 3');
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /HARNESS_MAX_SPRINTS_PER_RUN/);

  result = await runCommon(dir, 'HARNESS_MAX_SPRINTS_PER_RUN=2; harness_validate_run_config 3');
  assert.equal(result.code, 0);

  result = await runCommon(dir, "harness_validate_run_config abc");
  assert.notEqual(result.code, 0);
});

// ─── watchdog evaluator freshness check ───────────────────────────────

async function makeEvaluatorReadyProject() {
  const dir = await makeProject([[1, "Foundation", "Pass"]]);
  await writeFile(
    path.join(dir, "docs", "qa-report-sprint-1.md"),
    "# QA Report\n\nResult: PASS\n",
  );
  return dir;
}

test("watchdog evaluator ready-check rejects a stale (unchanged mtime) report", async () => {
  const dir = await makeEvaluatorReadyProject();
  const { mtimeMs } = await stat(path.join(dir, "docs", "qa-report-sprint-1.md"));
  const baseline = Math.floor(mtimeMs / 1000);
  const { code } = await runCommon(
    dir,
    `harness_watchdog_phase_ready evaluator 1 "${baseline}"`,
  );
  assert.notEqual(code, 0, "round-1 report with unchanged mtime must not satisfy readiness");
});

test("watchdog evaluator ready-check accepts a rewritten report", async () => {
  const dir = await makeEvaluatorReadyProject();
  const { code } = await runCommon(
    dir,
    `harness_watchdog_phase_ready evaluator 1 "12345"`,
  );
  assert.equal(code, 0);
});

test("watchdog evaluator ready-check accepts when no baseline (fresh report)", async () => {
  const dir = await makeEvaluatorReadyProject();
  const { code } = await runCommon(dir, `harness_watchdog_phase_ready evaluator 1 ""`);
  assert.equal(code, 0);
});

test("watchdog ready-check still gates on artifacts for non-evaluator phases", async () => {
  const dir = await makeProject([[1, "Foundation", "Not started"]]);
  const { code } = await runCommon(dir, `harness_watchdog_phase_ready generator 1 ""`);
  assert.notEqual(code, 0);
});

// ─── stale .git/index.lock cleanup ────────────────────────────────────

test("harness_cleanup_git_index_lock removes lock when no git process runs", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "index-lock-"));
  await execFileAsync("git", ["init", "-q"], { cwd: dir });
  const lock = path.join(dir, ".git", "index.lock");
  await writeFile(lock, "");
  const { code } = await runCommon(
    dir,
    "harness_git_processes_running() { return 1; }; harness_cleanup_git_index_lock",
  );
  assert.equal(code, 0);
  assert.equal(existsSync(lock), false);
});

test("harness_cleanup_git_index_lock keeps lock while a git process runs", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "index-lock-"));
  await execFileAsync("git", ["init", "-q"], { cwd: dir });
  const lock = path.join(dir, ".git", "index.lock");
  await writeFile(lock, "");
  const { code } = await runCommon(
    dir,
    "harness_git_processes_running() { return 0; }; harness_cleanup_git_index_lock",
  );
  assert.equal(code, 0);
  assert.equal(existsSync(lock), true);
});

test("harness_cleanup_git_index_lock is a no-op outside a git repo", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "index-lock-"));
  const { code } = await runCommon(dir, "harness_cleanup_git_index_lock");
  assert.equal(code, 0);
});

// ─── centralized prompts ──────────────────────────────────────────────

async function makePromptProject() {
  const dir = await makeProject([[1, "Foundation", "Fail"]]);
  await mkdir(path.join(dir, "agents"), { recursive: true });
  await writeFile(path.join(dir, "agents", "generator.md"), "GENERATOR PERSONA BODY\n");
  await writeFile(path.join(dir, "agents", "evaluator.md"), "EVALUATOR PERSONA BODY\n");
  return dir;
}

test("generator prompt includes lessons, guardrails, lint context, and QA context", async () => {
  const dir = await makePromptProject();
  await writeFile(path.join(dir, "docs", "qa-report-sprint-1.md"), "Result: FAIL\n");
  await writeFile(
    path.join(dir, "docs", "mechanical-checks-sprint-1.md"),
    "Result: FAIL\n- lint broke\n",
  );
  const { code, stdout } = await runCommon(dir, "harness_build_generator_prompt 1");
  assert.equal(code, 0);
  assert.match(stdout, /GENERATOR PERSONA BODY/);
  assert.match(stdout, /harness\/LESSONS\.md/); // drift fix (a): lessons everywhere
  assert.match(stdout, /harness\/AGENT-INSTRUCTIONS\.md/);
  assert.match(stdout, /bun lint:harness/);
  assert.match(stdout, /fix ALL failures/);
  assert.match(stdout, /fix ALL listed issues/);
  assert.match(stdout, /building Sprint 1/);
  assert.match(stdout, /AUTONOMOUS MODE/);
});

test("evaluator prompt includes lessons, mechanical context, and autonomous suffix", async () => {
  const dir = await makePromptProject();
  const { code, stdout } = await runCommon(dir, "harness_build_evaluator_prompt 1");
  assert.equal(code, 0);
  assert.match(stdout, /EVALUATOR PERSONA BODY/);
  assert.match(stdout, /harness\/LESSONS\.md/); // drift fix (a)
  // EVALUATOR_MECHANICAL_CONTEXT actually interpolated, with [N] resolved
  assert.match(stdout, /docs\/mechanical-checks-sprint-1\.md/);
  assert.doesNotMatch(stdout, /\[N\]/);
  assert.match(stdout, /review-personas\/security\.md/);
  assert.match(stdout, /qa-report-sprint-1\.md/);
  assert.match(stdout, /Be skeptical/);
  assert.match(stdout, /AUTONOMOUS MODE/); // drift fix (c)
});

// ─── first-run safety ─────────────────────────────────────────────────

// Like runCommon, but with a preamble before sourcing and optional env.
async function runWithPreamble(cwd, preamble, snippet, env = {}) {
  try {
    const { stdout, stderr } = await execFileAsync(
      "bash",
      ["-c", `${preamble} source "${COMMON}"; ${snippet}`],
      { cwd, env: { ...process.env, ...env } },
    );
    return { code: 0, stdout, stderr };
  } catch (error) {
    if (typeof error.code !== "number") throw error;
    return { code: error.code, stdout: error.stdout ?? "", stderr: error.stderr ?? "" };
  }
}

test("harness_ensure_guardrails warns loudly outside a git repo", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "no-git-"));
  const { code, stderr } = await runCommon(dir, "harness_ensure_guardrails");
  assert.equal(code, 0);
  assert.match(stderr, /guardrails are OFF/i);
  assert.match(stderr, /git init/);
});

test("HARNESS_PAUSE defaults to sprint on a fresh project", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "fresh-project-"));
  const { stdout } = await runWithPreamble(dir, "unset HARNESS_PAUSE;", 'echo "$HARNESS_PAUSE"');
  assert.equal(stdout.trim(), "sprint");
});

test("HARNESS_PAUSE stays off when sprint-status.md already exists", async () => {
  const dir = await makeProject([[1, "Foundation", "Not started"]]);
  const { stdout } = await runWithPreamble(dir, "unset HARNESS_PAUSE;", 'echo "$HARNESS_PAUSE"');
  assert.equal(stdout.trim(), "off");
});

test("explicit HARNESS_PAUSE=off wins on a fresh project", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "fresh-project-"));
  const { stdout } = await runWithPreamble(
    dir,
    "export HARNESS_PAUSE=off;",
    'echo "$HARNESS_PAUSE"',
  );
  assert.equal(stdout.trim(), "off");
});

test("pause config banner explains the first-run default", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "fresh-project-"));
  const { stdout } = await runWithPreamble(
    dir,
    "unset HARNESS_PAUSE;",
    "harness_print_pause_config",
  );
  assert.match(stdout, /First run/i);
  assert.match(stdout, /HARNESS_PAUSE=off/);
});

// ─── preflight ────────────────────────────────────────────────────────

test("harness_preflight fails with instructions when a required CLI is missing", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "preflight-"));
  const { code, stderr } = await runCommon(dir, "harness_preflight definitely-not-a-real-cli-xyz");
  assert.notEqual(code, 0);
  assert.match(stderr, /definitely-not-a-real-cli-xyz/);
});

test("harness_preflight passes when required tools exist", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "preflight-"));
  const { code } = await runCommon(dir, "harness_preflight bash node");
  assert.equal(code, 0);
});

async function makeClaudeStub(dir, exitCode) {
  const bin = path.join(dir, "stub-bin");
  await mkdir(bin, { recursive: true });
  const stub = path.join(bin, "claude");
  await writeFile(stub, `#!/bin/sh\necho "$@" >> "${dir}/claude-calls.log"\nexit ${exitCode}\n`);
  await chmod(stub, 0o755);
  return `${bin}:${process.env.PATH}`;
}

test("model ping succeeds and dedupes repeated models", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "preflight-ping-"));
  const PATH = await makeClaudeStub(dir, 0);
  const { code } = await runWithPreamble(
    dir,
    "",
    "harness_preflight_model_ping model-a model-a model-a",
    { PATH },
  );
  assert.equal(code, 0);
  const calls = (await readFileText(path.join(dir, "claude-calls.log"))).split("\n").filter(Boolean);
  assert.equal(calls.length, 1);
});

test("model ping fails with override guidance when the model is unavailable", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "preflight-ping-"));
  const PATH = await makeClaudeStub(dir, 1);
  const { code, stderr } = await runWithPreamble(
    dir,
    "",
    "harness_preflight_model_ping some-model",
    { PATH },
  );
  assert.notEqual(code, 0);
  assert.match(stderr, /some-model/);
  assert.match(stderr, /HARNESS_(PLANNER_)?MODEL/);
  assert.match(stderr, /HARNESS_PREFLIGHT=off/);
});

test("HARNESS_PREFLIGHT=off skips the model ping entirely", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "preflight-ping-"));
  const PATH = await makeClaudeStub(dir, 1);
  const { code } = await runWithPreamble(
    dir,
    "",
    "harness_preflight_model_ping some-model",
    { PATH, HARNESS_PREFLIGHT: "off" },
  );
  assert.equal(code, 0);
  assert.equal(existsSync(path.join(dir, "claude-calls.log")), false);
});

async function readFileText(filePath) {
  const { readFile } = await import("node:fs/promises");
  return readFile(filePath, "utf8");
}
