import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createInitialState,
  readOrchestratorState,
  resolveQaRound,
  updateOrchestratorState,
  writeOrchestratorState,
} from "../sdk-orchestrator/state-store.mjs";
import {
  readWorkflowHandoff,
  writeWorkflowHandoff,
} from "../sdk-orchestrator/workflow-handoff.mjs";

async function withTempDir(run) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "state-store-"));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function validHandoff(overrides = {}) {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    sourceWorkflow: "test",
    lastCompletedPhase: "generator",
    targetSprint: 1,
    qaRound: 1,
    expectedNextAction: "run-evaluator",
    artifactsWritten: ["docs/sprint-status.md"],
    ...overrides,
  };
}

// --- Finding 1: atomic writes + tolerant reads ---

test("readOrchestratorState returns null for corrupt JSON instead of throwing", async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "orchestrator-state.json");
    await writeFile(file, "{ not json !!!", "utf8");
    assert.equal(await readOrchestratorState(file), null);
  });
});

test("readOrchestratorState returns null for schema-invalid content (non-object)", async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "orchestrator-state.json");
    await writeFile(file, "[1,2,3]\n", "utf8");
    assert.equal(await readOrchestratorState(file), null);
  });
});

test("writeOrchestratorState leaves no tmp files behind and round-trips", async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "nested", "orchestrator-state.json");
    const state = createInitialState({ productPrompt: "p" });
    await writeOrchestratorState(state, file);

    const entries = await readdir(path.dirname(file));
    assert.deepEqual(entries, ["orchestrator-state.json"]);

    const readBack = await readOrchestratorState(file);
    assert.equal(readBack.productPrompt, "p");
  });
});

test("readWorkflowHandoff returns null for corrupt JSON instead of throwing", async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "workflow-handoff.json");
    await writeFile(file, "{{{", "utf8");
    assert.equal(await readWorkflowHandoff(file), null);
  });
});

test("readWorkflowHandoff returns null for schema-invalid handoff instead of throwing", async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "workflow-handoff.json");
    await writeFile(file, JSON.stringify({ version: 99, hello: true }), "utf8");
    assert.equal(await readWorkflowHandoff(file), null);
  });
});

test("writeWorkflowHandoff writes atomically and round-trips", async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "docs", "workflow-handoff.json");
    await writeWorkflowHandoff(validHandoff(), file);

    const entries = await readdir(path.dirname(file));
    assert.deepEqual(entries, ["workflow-handoff.json"]);

    const readBack = await readWorkflowHandoff(file);
    assert.equal(readBack.lastCompletedPhase, "generator");
  });
});

// --- Finding 2: reset must be a full replace, not a merge ---

test("writing initial state replaces stale qaRounds and phaseHistory", async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "orchestrator-state.json");
    await updateOrchestratorState(
      {
        currentSprint: 3,
        qaRounds: { 1: 3, 2: 2 },
        phaseHistory: [{ phase: "evaluator", sprint: 2, qaRound: 2 }],
      },
      file,
    );

    await writeOrchestratorState(createInitialState({ productPrompt: "fresh" }), file);

    const state = await readOrchestratorState(file);
    assert.deepEqual(state.qaRounds, {});
    assert.deepEqual(state.phaseHistory, []);
    assert.equal(state.currentSprint, null);
    assert.equal(state.productPrompt, "fresh");
  });
});

test("updateOrchestratorState still merges qaRounds and appends phaseHistory", async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "orchestrator-state.json");
    await updateOrchestratorState({ qaRounds: { 1: 1 }, phaseHistory: [{ phase: "generator" }] }, file);
    const state = await updateOrchestratorState(
      { qaRounds: { 2: 1 }, phaseHistory: [{ phase: "evaluator" }] },
      file,
    );
    assert.deepEqual(state.qaRounds, { 1: 1, 2: 1 });
    assert.equal(state.phaseHistory.length, 2);
  });
});

// --- resolveQaRound: lost-bookkeeping round recovery ---

test("resolveQaRound bumps from state when evaluator run was recorded but handoff lost", () => {
  const qaRound = resolveQaRound({
    state: {
      qaRounds: { 2: 1 },
      lastCompletedPhase: "evaluator",
      lastRun: { phase: "evaluator", sprint: 2, qaRound: 1 },
    },
    handoff: null,
    sprint: 2,
    action: "run-generator",
  });
  assert.equal(qaRound, 2);
});

test("resolveQaRound bumps when docs show a Fail + QA report but bookkeeping missed the round", () => {
  const qaRound = resolveQaRound({
    state: null,
    handoff: null,
    sprint: 1,
    action: "run-generator",
    sprintStatus: "Fail",
    qaReportExists: true,
  });
  assert.equal(qaRound, 2);
});

test("resolveQaRound does not double-bump when handoff already recorded the evaluator", () => {
  const qaRound = resolveQaRound({
    state: null,
    handoff: {
      targetSprint: 1,
      qaRound: 1,
      lastCompletedPhase: "evaluator",
    },
    sprint: 1,
    action: "run-generator",
    sprintStatus: "Fail",
    qaReportExists: true,
  });
  assert.equal(qaRound, 2);
});

test("resolveQaRound leaves run-evaluator rounds untouched by Fail-row recovery", () => {
  const qaRound = resolveQaRound({
    state: null,
    handoff: null,
    sprint: 1,
    action: "run-evaluator",
    sprintStatus: "Fail",
    qaReportExists: true,
  });
  assert.equal(qaRound, 1);
});
