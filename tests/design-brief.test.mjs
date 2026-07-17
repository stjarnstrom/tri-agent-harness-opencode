import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  collectDesignBriefContext,
  getPlannerMode,
  getPlanningState,
  hasDesignBriefInput,
  isDesignScoutComplete,
  isPlanningComplete,
  needsPlanning,
} from "../sdk-orchestrator/design-brief.mjs";
import { buildPlannerPrompt } from "../sdk-orchestrator/prompts.mjs";
import { getNextDecision } from "../sdk-orchestrator/orchestrator.mjs";
import { assertPhaseOutputs } from "../sdk-orchestrator/validate.mjs";

async function withTempDir(run) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "design-brief-"));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("hasDesignBriefInput detects brief markdown", async () => {
  await withTempDir(async (cwd) => {
    await mkdir(path.join(cwd, "design"), { recursive: true });
    await writeFile(path.join(cwd, "design", "brief.md"), "Editorial dark aesthetic\n");

    assert.equal(await hasDesignBriefInput(cwd), true);
    assert.equal(await getPlannerMode(cwd), "full");
  });
});

test("getPlanningState returns scout when no brief", async () => {
  await withTempDir(async (cwd) => {
    assert.equal(await getPlanningState(cwd), "scout");
    assert.equal(await getPlannerMode(cwd), "scout");
    assert.equal(await needsPlanning(cwd), true);
  });
});

test("getPlanningState returns full when HARNESS_YES and no brief", async () => {
  await withTempDir(async (cwd) => {
    assert.equal(await getPlanningState(cwd, { harnessYes: true }), "full");
    assert.equal(await getPlannerMode(cwd, { harnessYes: true }), "full");
  });
});

test("isDesignScoutComplete when options exist without sprint status", async () => {
  await withTempDir(async (cwd) => {
    await mkdir(path.join(cwd, "docs"), { recursive: true });
    await writeFile(path.join(cwd, "docs", "design-options.md"), "# Options\n");

    assert.equal(await isDesignScoutComplete(cwd), true);
    assert.equal(await getPlanningState(cwd), "await-selection");
  });
});

test("getPlanningState finalize when selected direction exists", async () => {
  await withTempDir(async (cwd) => {
    await mkdir(path.join(cwd, "docs"), { recursive: true });
    await mkdir(path.join(cwd, "design"), { recursive: true });
    await writeFile(path.join(cwd, "docs", "design-options.md"), "# Options\n");
    await writeFile(path.join(cwd, "design", "selected-direction.md"), "Option B\n");

    assert.equal(await getPlanningState(cwd), "finalize");
    assert.equal(await getPlannerMode(cwd), "finalize");
  });
});

test("isPlanningComplete when spec and sprint status exist", async () => {
  await withTempDir(async (cwd) => {
    await mkdir(path.join(cwd, "docs"), { recursive: true });
    await writeFile(path.join(cwd, "docs", "spec.md"), "# Spec\n");
    await writeFile(path.join(cwd, "docs", "sprint-status.md"), "| 1 | A | Not started |\n");

    assert.equal(await isPlanningComplete(cwd), true);
    assert.equal(await needsPlanning(cwd), false);
  });
});

test("collectDesignBriefContext includes brief text and reference paths", async () => {
  await withTempDir(async (cwd) => {
    await mkdir(path.join(cwd, "design", "references"), { recursive: true });
    await writeFile(path.join(cwd, "design", "brief.md"), "Warm brutalist palette\n");
    await writeFile(path.join(cwd, "design", "references", "mood.png"), "fake");

    const context = await collectDesignBriefContext(cwd);
    assert.match(context, /authoritative — do not override/);
    assert.match(context, /Warm brutalist palette/);
    assert.match(context, /design\/references\/mood\.png/);
  });
});

test("buildPlannerPrompt injects brief and scout mode instructions", async () => {
  await withTempDir(async (cwd) => {
    await mkdir(path.join(cwd, "agents"), { recursive: true });
    await mkdir(path.join(cwd, "design"), { recursive: true });
    await writeFile(path.join(cwd, "agents", "planner.md"), "# Planner\n");
    await writeFile(path.join(cwd, "design", "brief.md"), "Neon terminal green\n");

    const originalCwd = process.cwd();
    process.chdir(cwd);
    try {
      const prompt = await buildPlannerPrompt({ productPrompt: "Build a DAW" });
      assert.match(prompt, /Neon terminal green/);
      assert.match(prompt, /FULL PLAN MODE/);
    } finally {
      process.chdir(originalCwd);
    }
  });
});

test("buildPlannerPrompt uses scout instructions when no brief", async () => {
  await withTempDir(async (cwd) => {
    await mkdir(path.join(cwd, "agents"), { recursive: true });
    await writeFile(path.join(cwd, "agents", "planner.md"), "# Planner\n");

    const originalCwd = process.cwd();
    process.chdir(cwd);
    try {
      const prompt = await buildPlannerPrompt({ productPrompt: "Build a DAW" });
      assert.match(prompt, /DESIGN SCOUT MODE/);
      assert.match(prompt, /docs\/design-options\.md/);
    } finally {
      process.chdir(originalCwd);
    }
  });
});

test("getNextDecision returns await-design-selection after scout", async () => {
  await withTempDir(async (cwd) => {
    await mkdir(path.join(cwd, "docs"), { recursive: true });
    await writeFile(path.join(cwd, "docs", "design-options.md"), "# Options\n");

    const originalCwd = process.cwd();
    process.chdir(cwd);
    try {
      const decision = await getNextDecision();
      assert.equal(decision.action, "await-design-selection");
    } finally {
      process.chdir(originalCwd);
    }
  });
});

test("assertPhaseOutputs accepts design scout planner output", async () => {
  await withTempDir(async (cwd) => {
    await mkdir(path.join(cwd, "docs"), { recursive: true });
    await writeFile(path.join(cwd, "docs", "design-options.md"), "# Options\n");

    const originalCwd = process.cwd();
    process.chdir(cwd);
    try {
      const result = await assertPhaseOutputs("planner", 1);
      assert.equal(result.mode, "scout");
    } finally {
      process.chdir(originalCwd);
    }
  });
});
