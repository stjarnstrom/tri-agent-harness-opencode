import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const COMMON = path.join(ROOT, "scripts", "harness-common.sh");

// Bash prelude sourced by every scenario: harness-common.sh plus stubbed-out
// side-effect helpers (gate, orchestrator plumbing) and a helper to flip a
// sprint-status row — the same file protocol the real agents use.
const PRELUDE = `
set -euo pipefail
source "${COMMON}"

run_pre_qa_gate() { return 0; }
validate_phase() { :; }
write_handoff() { :; }
harness_post_qa_write() { :; }

set_row_status() {
  local sprint="$1" status="$2"
  awk -F'|' -v s="$sprint" -v st="$status" '
    BEGIN { OFS = "|" }
    /^\\|[[:space:]]*[0-9]+/ {
      num = $2
      gsub(/^[ \\t]+|[ \\t]+$/, "", num)
      if (num == s) { $4 = " " st " " }
    }
    { print }
  ' docs/sprint-status.md > docs/sprint-status.md.tmp
  mv docs/sprint-status.md.tmp docs/sprint-status.md
}
`;

async function makeProject(sprintCount = 2) {
  const dir = await mkdtemp(path.join(tmpdir(), "sprint-loop-"));
  await mkdir(path.join(dir, "docs"), { recursive: true });
  await mkdir(path.join(dir, "agents"), { recursive: true });
  await writeFile(path.join(dir, "agents", "generator.md"), "GENERATOR PERSONA\n");
  await writeFile(path.join(dir, "agents", "evaluator.md"), "EVALUATOR PERSONA\n");
  const rows = [];
  for (let i = 1; i <= sprintCount; i += 1) {
    rows.push(`| ${i} | Sprint ${i} | Not started | |`);
  }
  await writeFile(
    path.join(dir, "docs", "sprint-status.md"),
    [
      "# Sprint Status",
      "",
      "| Sprint | Title | Status | Notes |",
      "| --- | --- | --- | --- |",
      ...rows,
      "",
    ].join("\n"),
  );
  return dir;
}

async function runLoop(cwd, scenario, { env = {} } = {}) {
  try {
    const { stdout, stderr } = await execFileAsync(
      "bash",
      ["-c", PRELUDE + scenario],
      { cwd, env: { ...process.env, ...env } },
    );
    return { code: 0, stdout, stderr };
  } catch (error) {
    if (typeof error.code !== "number") throw error;
    return { code: error.code, stdout: error.stdout ?? "", stderr: error.stderr ?? "" };
  }
}

async function readCalls(cwd) {
  return readFile(path.join(cwd, "agent-calls.log"), "utf8")
    .then((raw) => raw.split("\n").filter(Boolean))
    .catch(() => []);
}

// A generator stub that writes the contract and flips the row, plus an
// evaluator stub whose verdict is decided by the function `verdict <sprint>`.
const AGENT_STUB = `
run_phase_agent() {
  local phase="$1" sprint="$2" prompt="$3"
  echo "$phase $sprint" >> agent-calls.log
  printf '%s\\n' "$prompt" > "last-prompt-$phase.txt"
  case "$phase" in
    generator)
      : > "docs/sprint-\${sprint}-contract.md"
      set_row_status "$sprint" "Ready for QA"
      ;;
    evaluator)
      if verdict "$sprint"; then
        printf 'Result: PASS\\n' > "docs/qa-report-sprint-\${sprint}.md"
        set_row_status "$sprint" "Pass"
      else
        printf 'Result: FAIL\\n' > "docs/qa-report-sprint-\${sprint}.md"
        set_row_status "$sprint" "Fail"
      fi
      ;;
  esac
}
`;

test("loop advances through all sprints on the happy path", async () => {
  const dir = await makeProject(2);
  const { code, stdout } = await runLoop(
    dir,
    `${AGENT_STUB}
verdict() { return 0; }
harness_run_sprint_loop 3`,
  );
  assert.equal(code, 0);
  assert.match(stdout, /All sprints complete!/);
  assert.match(stdout, /Sprint 1 PASSED on round 1/);
  assert.match(stdout, /Sprint 2 PASSED on round 1/);
  assert.deepEqual(await readCalls(dir), [
    "generator 1",
    "evaluator 1",
    "generator 2",
    "evaluator 2",
  ]);
});

test("loop injects lessons + autonomous suffix into both phase prompts", async () => {
  const dir = await makeProject(1);
  const { code } = await runLoop(
    dir,
    `${AGENT_STUB}
verdict() { return 0; }
harness_run_sprint_loop 3`,
  );
  assert.equal(code, 0);
  const generatorPrompt = await readFile(path.join(dir, "last-prompt-generator.txt"), "utf8");
  const evaluatorPrompt = await readFile(path.join(dir, "last-prompt-evaluator.txt"), "utf8");
  for (const prompt of [generatorPrompt, evaluatorPrompt]) {
    assert.match(prompt, /harness\/LESSONS\.md/);
    assert.match(prompt, /AUTONOMOUS MODE/);
  }
  assert.match(evaluatorPrompt, /docs\/mechanical-checks-sprint-1\.md/);
});

test("loop retries a failed sprint and passes on a later round", async () => {
  const dir = await makeProject(1);
  const { code, stdout } = await runLoop(
    dir,
    `${AGENT_STUB}
verdict() {
  echo x >> "eval-attempts"
  [ "$(wc -l < eval-attempts | tr -d ' ')" -ge 2 ]
}
harness_run_sprint_loop 3`,
  );
  assert.equal(code, 0);
  assert.match(stdout, /Sprint 1 FAILED on round 1/);
  assert.match(stdout, /Sprint 1 PASSED on round 2/);
  assert.deepEqual(await readCalls(dir), [
    "generator 1",
    "evaluator 1",
    "generator 1",
    "evaluator 1",
  ]);
});

test("loop halts with exit 1 at max rounds and logs each failure once", async () => {
  const dir = await makeProject(1);
  const { code, stdout } = await runLoop(
    dir,
    `${AGENT_STUB}
verdict() { return 1; }
harness_run_sprint_loop 2`,
    { env: { HARNESS_ON_MAX_ROUNDS: "halt" } },
  );
  assert.equal(code, 1);
  assert.match(stdout, /HALTED: Max QA rounds reached for Sprint 1/);
  const logged = await readFile(path.join(dir, ".gc-cache", "weekly-report.jsonl"), "utf8");
  assert.equal(logged.split("\n").filter(Boolean).length, 2);
});

test("progress guard exits when a handled sprint is re-selected", async () => {
  const dir = await makeProject(1);
  // advance policy, but mark_sprint_skipped silently does nothing — the row
  // stays Fail, so the loop would re-pick sprint 1 forever without the guard.
  const { code, stderr } = await runLoop(
    dir,
    `${AGENT_STUB}
verdict() { return 1; }
mark_sprint_skipped() { return 0; }
harness_run_sprint_loop 1`,
    { env: { HARNESS_ON_MAX_ROUNDS: "advance" } },
  );
  assert.equal(code, 1);
  assert.match(stderr, /already handled to completion/);
});

test("pre-QA gate failures exhaust rounds instead of looping forever", async () => {
  const dir = await makeProject(1);
  const { code, stdout } = await runLoop(
    dir,
    `${AGENT_STUB}
verdict() { return 0; }
run_pre_qa_gate() { return 1; }
harness_run_sprint_loop 2`,
    { env: { HARNESS_ON_MAX_ROUNDS: "halt" } },
  );
  assert.equal(code, 1);
  assert.match(stdout, /pre-QA gate never passed/);
  assert.match(stdout, /HALTED: Max QA rounds reached for Sprint 1/);
  // Generator ran both rounds, evaluator never ran.
  assert.deepEqual(await readCalls(dir), ["generator 1", "generator 1"]);
});

test("HARNESS_MAX_SPRINTS_PER_RUN stops after N sprints", async () => {
  const dir = await makeProject(2);
  const { code, stdout } = await runLoop(
    dir,
    `${AGENT_STUB}
verdict() { return 0; }
harness_run_sprint_loop 3`,
    { env: { HARNESS_MAX_SPRINTS_PER_RUN: "1" } },
  );
  assert.equal(code, 0);
  assert.match(stdout, /Reached HARNESS_MAX_SPRINTS_PER_RUN=1/);
  assert.deepEqual(await readCalls(dir), ["generator 1", "evaluator 1"]);
  const status = await readFile(path.join(dir, "docs", "sprint-status.md"), "utf8");
  assert.match(status, /\| 2 \| Sprint 2 \| Not started \|/);
});

test("retro hook runs after the loop completes when defined", async () => {
  const dir = await makeProject(1);
  const { code, stdout } = await runLoop(
    dir,
    `${AGENT_STUB}
verdict() { return 0; }
harness_run_retro_hook() { echo "RETRO_HOOK_RAN"; }
harness_run_sprint_loop 3`,
  );
  assert.equal(code, 0);
  assert.match(stdout, /All sprints complete![\s\S]*RETRO_HOOK_RAN/);
});

test("loop without retro hook completes cleanly", async () => {
  const dir = await makeProject(1);
  const { code, stdout } = await runLoop(
    dir,
    `${AGENT_STUB}
verdict() { return 0; }
harness_run_sprint_loop 3`,
  );
  assert.equal(code, 0);
  assert.match(stdout, /All sprints complete!/);
  assert.doesNotMatch(stdout, /RETRO_HOOK_RAN/);
});
