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
const SCRIPT = path.join(ROOT, "scripts", "anti-slop.mjs");

function tsEntry(sprint, round) {
  // Same shape as log_qa_failure in scripts/harness-common.sh
  return JSON.stringify({
    ts: new Date().toISOString(),
    category: "qa-failure",
    sprint,
    round,
    report: `docs/qa-report-sprint-${sprint}.md`,
    description: `Sprint ${sprint} failed QA round ${round}`,
  });
}

async function runAntiSlop(lines) {
  const gcDir = await mkdtemp(path.join(tmpdir(), "gc-cache-"));
  await writeFile(path.join(gcDir, "weekly-report.jsonl"), lines.join("\n") + "\n");
  const { stdout } = await execFileAsync("node", [SCRIPT], {
    env: { ...process.env, HARNESS_GC_DIR: gcDir },
  });
  return stdout;
}

test("counts automated qa-failure entries written with a ts field", async () => {
  const stdout = await runAntiSlop([tsEntry(2, 1)]);
  assert.doesNotMatch(stdout, /No issues logged this week/);
});

test("repeat QA failures of one sprint across rounds count as recurring", async () => {
  const stdout = await runAntiSlop([tsEntry(2, 1), tsEntry(2, 2)]);
  assert.match(stdout, /2 times/);
  assert.match(stdout, /Total recurring issues: 1/);
});

test("a corrupt JSONL line is skipped with a warning, not a crash", async () => {
  const stdout = await runAntiSlop(['{"truncated', tsEntry(2, 1), tsEntry(2, 2)]);
  assert.match(stdout, /Total recurring issues: 1/);
});

test("handle_max_rounds does not double-log the final QA failure", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "max-rounds-"));
  try {
    await execFileAsync(
      "bash",
      [
        "-c",
        `source "${ROOT}/scripts/harness-common.sh"; MAX_QA_ROUNDS=2 HARNESS_ON_MAX_ROUNDS=halt handle_max_rounds 1`,
      ],
      { cwd: dir },
    );
    assert.fail("handle_max_rounds should exit 1 on the halt path");
  } catch (error) {
    assert.equal(error.code, 1);
  }
  // The failing round was already logged by the sprint loop; the halt
  // handler must not append a duplicate entry.
  const logged = await readFile(path.join(dir, ".gc-cache", "weekly-report.jsonl"), "utf8")
    .then((raw) => raw.split("\n").filter(Boolean).length)
    .catch(() => 0);
  assert.equal(logged, 0);
});
