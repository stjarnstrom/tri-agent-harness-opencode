import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  dryRunSequence,
  evaluateMaxRoundsPolicy,
  runLoop,
} from "../sdk-orchestrator/orchestrator.mjs";
import { runWithFallback } from "../sdk-orchestrator/phase-runners.mjs";
import { buildGeneratorPrompt, buildPlannerPrompt } from "../sdk-orchestrator/prompts.mjs";
import { readOrchestratorState, updateOrchestratorState, resolveQaRound } from "../sdk-orchestrator/state-store.mjs";

const basePolicy = {
  maxQaRounds: 3,
  onMaxRoundsReached: "halt",
  models: { planner: "m", generator: "m", evaluator: "m" },
  runtime: { mode: "local", runner: "sdk", approveMcps: true },
  budgets: { maxPhasesPerRun: null },
};

// Several orchestrator entry points resolve docs/ paths relative to cwd.
async function inTempProject(run) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "orchestrator-"));
  const prevCwd = process.cwd();
  try {
    process.chdir(dir);
    await run(dir);
  } finally {
    process.chdir(prevCwd);
    await rm(dir, { recursive: true, force: true });
  }
}

async function writeSprintStatus(rows) {
  await mkdir("docs", { recursive: true });
  const body = rows
    .map(({ sprint, status }) => `| ${sprint} | Sprint ${sprint} | ${status} | - |`)
    .join("\n");
  await writeFile(
    path.join("docs", "sprint-status.md"),
    `# Sprint Status\n\n| Sprint | Name | Status | Notes |\n|---|---|---|---|\n${body}\n`,
    "utf8",
  );
}

async function writePlanningArtifacts() {
  await mkdir("docs", { recursive: true });
  await writeFile(path.join("docs", "spec.md"), "# Spec\n", "utf8");
}

test("resolveQaRound increments after evaluator failure handoff", () => {
  const qaRound = resolveQaRound({
    state: null,
    handoff: {
      targetSprint: 2,
      qaRound: 1,
      lastCompletedPhase: "evaluator",
    },
    sprint: 2,
    action: "run-generator",
  });

  assert.equal(qaRound, 2);
});

test("evaluateMaxRoundsPolicy continues when rounds remain", async () => {
  const result = await evaluateMaxRoundsPolicy({
    sprint: 2,
    qaRound: 1,
    passed: false,
    policy: basePolicy,
  });

  assert.equal(result.continue, true);
});

test("evaluateMaxRoundsPolicy halts at max rounds by default", async () => {
  const result = await evaluateMaxRoundsPolicy({
    sprint: 2,
    qaRound: 3,
    passed: false,
    policy: basePolicy,
  });

  assert.equal(result.continue, false);
  assert.equal(result.exitCode, 1);
});

test("evaluateMaxRoundsPolicy can advance with warning", async () => {
  const result = await evaluateMaxRoundsPolicy({
    sprint: 2,
    qaRound: 3,
    passed: false,
    policy: {
      ...basePolicy,
      onMaxRoundsReached: "advance-with-warning",
    },
  });

  assert.equal(result.continue, true);
  assert.equal(result.warning, true);
});

// --- Finding 8: dry-run simulates transitions instead of repeating one step ---

test("dryRunSequence walks the whole plan by simulating phase transitions", async () => {
  await inTempProject(async () => {
    await writePlanningArtifacts();
    await writeSprintStatus([
      { sprint: 1, status: "Not started" },
      { sprint: 2, status: "Not started" },
    ]);

    const steps = await dryRunSequence({ policy: basePolicy });
    const actions = steps.map((step) => `${step.action}${step.sprint ? `:${step.sprint}` : ""}`);

    assert.deepEqual(actions, [
      "run-generator:1",
      "run-evaluator:1",
      "run-generator:2",
      "run-evaluator:2",
      "done",
    ]);

    // The first step reflects real on-disk state; later steps are simulated.
    assert.equal(steps[0].simulated, undefined);
    for (const step of steps.slice(1)) {
      assert.equal(step.simulated, true);
    }
  });
});

test("dryRunSequence never emits the same decision twice in a row", async () => {
  await inTempProject(async () => {
    await writePlanningArtifacts();
    await writeSprintStatus([{ sprint: 1, status: "Fail" }]);

    const steps = await dryRunSequence({ policy: basePolicy });
    for (let i = 1; i < steps.length; i += 1) {
      const prev = `${steps[i - 1].action}:${steps[i - 1].sprint ?? ""}`;
      const cur = `${steps[i].action}:${steps[i].sprint ?? ""}`;
      assert.notEqual(cur, prev);
    }
    assert.equal(steps.at(-1).action, "done");
  });
});

// --- Finding 3: runLoop with dryRun must not busy-loop ---

test("runLoop with dryRun delegates to the simulation and terminates", async () => {
  await inTempProject(async () => {
    await writePlanningArtifacts();
    await writeSprintStatus([{ sprint: 1, status: "Ready for QA" }]);

    const result = await runLoop({ policy: basePolicy, dryRun: true, continueOnly: true });
    assert.equal(result.action, "dry-run");
    assert.ok(Array.isArray(result.steps));
    assert.ok(result.steps.length > 0);
    assert.equal(result.phasesRun, 0);
  });
});

// --- Finding 2: a fresh run-loop start fully resets orchestrator state ---

test("runLoop start replaces stale orchestrator state instead of merging", async () => {
  await inTempProject(async () => {
    await writePlanningArtifacts();
    await writeSprintStatus([{ sprint: 1, status: "Pass" }]);

    await updateOrchestratorState({
      currentSprint: 1,
      qaRounds: { 1: 3 },
      phaseHistory: [{ phase: "evaluator", sprint: 1, qaRound: 3 }],
    });

    const result = await runLoop({ productPrompt: "fresh run", policy: basePolicy });
    assert.equal(result.action, "done");

    const state = await readOrchestratorState();
    assert.deepEqual(state.qaRounds, {});
    assert.deepEqual(state.phaseHistory, []);
    assert.equal(state.productPrompt, "fresh run");
  });
});

// --- Finding 10: only inject fix instructions when the last QA actually failed ---

test("buildGeneratorPrompt omits fix instructions when the QA report passed", async () => {
  await inTempProject(async () => {
    await mkdir("agents", { recursive: true });
    await writeFile(path.join("agents", "generator.md"), "# Generator persona\n", "utf8");
    await writeSprintStatus([{ sprint: 1, status: "Pass" }]);
    await writeFile(
      path.join("docs", "qa-report-sprint-1.md"),
      "# QA Report\n\nResult: PASS — 15 of 15 criteria passed\n",
      "utf8",
    );

    const prompt = await buildGeneratorPrompt({ sprint: 1 });
    assert.ok(!prompt.includes("fix ALL failures"));
  });
});

test("buildGeneratorPrompt injects fix instructions when the QA report failed", async () => {
  await inTempProject(async () => {
    await mkdir("agents", { recursive: true });
    await writeFile(path.join("agents", "generator.md"), "# Generator persona\n", "utf8");
    await writeSprintStatus([{ sprint: 1, status: "Fail" }]);
    await writeFile(
      path.join("docs", "qa-report-sprint-1.md"),
      "# QA Report\n\nResult: FAIL — 12 of 15 criteria passed\n",
      "utf8",
    );

    const prompt = await buildGeneratorPrompt({ sprint: 1 });
    assert.ok(prompt.includes("fix ALL failures"));
  });
});

// --- Finding 9: autonomous suffix must be phase-specific ---

test("planner prompt does not carry the generator's implement-immediately suffix", async () => {
  await inTempProject(async (dir) => {
    await mkdir("agents", { recursive: true });
    await writeFile(path.join("agents", "planner.md"), "# Planner persona\n", "utf8");

    const prompt = await buildPlannerPrompt({ productPrompt: "a todo app", cwd: dir });
    assert.ok(!prompt.includes("implement it immediately"));
    assert.ok(prompt.includes("AUTONOMOUS MODE"));
  });
});

test("generator prompt keeps the implement-immediately instruction", async () => {
  await inTempProject(async () => {
    await mkdir("agents", { recursive: true });
    await writeFile(path.join("agents", "generator.md"), "# Generator persona\n", "utf8");
    await writeSprintStatus([{ sprint: 1, status: "Not started" }]);

    const prompt = await buildGeneratorPrompt({ sprint: 1 });
    assert.ok(prompt.includes("implement it immediately"));
  });
});

// --- Finding 7: runner fallback on soft failure + aggregated errors ---

test("runWithFallback falls back when a runner returns status 'error'", async () => {
  const attempts = [];
  const outcome = await runWithFallback({
    runners: ["sdk", "cli"],
    phase: "generator",
    warn: () => {},
    attempt: async (runner) => {
      attempts.push(runner);
      if (runner === "sdk") {
        return { status: "error", runner: "sdk" };
      }
      return { status: "finished", runner: "cli" };
    },
  });

  assert.deepEqual(attempts, ["sdk", "cli"]);
  assert.equal(outcome.status, "finished");
  assert.equal(outcome.runner, "cli");
});

test("runWithFallback aggregates every runner's error when all fail", async () => {
  await assert.rejects(
    () =>
      runWithFallback({
        runners: ["sdk", "cli"],
        phase: "evaluator",
        warn: () => {},
        attempt: async (runner) => {
          if (runner === "sdk") {
            throw new Error("missing API key");
          }
          throw new Error("cursor binary not found");
        },
      }),
    (error) => {
      assert.ok(error.message.includes("missing API key"));
      assert.ok(error.message.includes("cursor binary not found"));
      assert.ok(error.message.includes("evaluator"));
      return true;
    },
  );
});
