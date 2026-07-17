import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadPolicy } from "../sdk-orchestrator/policy.mjs";

const POLICY_ENV_VARS = [
  "HARNESS_MODEL",
  "HARNESS_RUNNER",
  "HARNESS_ON_MAX_ROUNDS",
  "HARNESS_MAX_QA_ROUNDS",
];

async function withCleanEnv(run) {
  const saved = {};
  for (const key of POLICY_ENV_VARS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  try {
    await run();
  } finally {
    for (const key of POLICY_ENV_VARS) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
  }
}

async function withTempDir(run) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "policy-"));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("loadPolicy falls back to defaults when config file is missing", async () => {
  await withCleanEnv(async () => {
    const policy = await loadPolicy(path.join(os.tmpdir(), "does-not-exist-policy.json"));
    assert.equal(policy.maxQaRounds, 3);
    assert.equal(policy.onMaxRoundsReached, "halt");
  });
});

// Finding 4: malformed config must not be silently ignored.
test("loadPolicy throws on malformed JSON config", async () => {
  await withCleanEnv(async () => {
    await withTempDir(async (dir) => {
      const configPath = path.join(dir, "bad-config.json");
      await writeFile(configPath, "{ maxQaRounds: oops", "utf8");
      await assert.rejects(() => loadPolicy(configPath), SyntaxError);
    });
  });
});

// Finding 15: env mapping HARNESS_ON_MAX_ROUNDS=advance -> advance-with-warning.
test("HARNESS_ON_MAX_ROUNDS=advance maps to advance-with-warning", async () => {
  await withCleanEnv(async () => {
    process.env.HARNESS_ON_MAX_ROUNDS = "advance";
    const policy = await loadPolicy(path.join(os.tmpdir(), "does-not-exist-policy.json"));
    assert.equal(policy.onMaxRoundsReached, "advance-with-warning");
  });
});

// Finding 14: wallClockTimeoutPerPhaseMs was never read anywhere — deleted.
test("policy no longer defines the unimplemented wallClockTimeoutPerPhaseMs budget", async () => {
  await withCleanEnv(async () => {
    const policy = await loadPolicy(path.join(os.tmpdir(), "does-not-exist-policy.json"));
    assert.equal("wallClockTimeoutPerPhaseMs" in policy.budgets, false);
  });
});

test("HARNESS_MODEL overrides all phase models", async () => {
  await withCleanEnv(async () => {
    process.env.HARNESS_MODEL = "test-model-1";
    const policy = await loadPolicy(path.join(os.tmpdir(), "does-not-exist-policy.json"));
    assert.deepEqual(policy.models, {
      planner: "test-model-1",
      generator: "test-model-1",
      evaluator: "test-model-1",
    });
  });
});
