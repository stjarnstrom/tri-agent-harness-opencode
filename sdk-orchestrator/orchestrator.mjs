import { logEvent } from "./event-log.mjs";
import { getPlanningState, needsPlanning } from "./design-brief.mjs";
import { fileExists } from "./fs-utils.mjs";
import {
  buildEvaluatorPrompt,
  buildGeneratorPrompt,
  buildPlannerPrompt,
} from "./prompts.mjs";
import { runPhase } from "./phase-runners.mjs";
import {
  computeNextActionFromRows,
  markSprintSkipped,
  readSprintRows,
  SPRINT_STATUS_FILE,
} from "./sprint-status.mjs";
import {
  createInitialState,
  readOrchestratorState,
  resolveQaRound,
  updateOrchestratorState,
  writeOrchestratorState,
} from "./state-store.mjs";
import { assertPhaseOutputs, sprintPassed } from "./validate.mjs";
import { readWorkflowHandoff, writeWorkflowHandoff, HANDOFF_FILE } from "./workflow-handoff.mjs";

const SOURCE = "sdk-orchestrator";

// Resolve the QA round from bookkeeping (state + handoff) cross-checked
// against the canonical docs, so a lost handoff/state write after an
// evaluator run cannot undercount the round.
async function resolveQaRoundFromDocs({ state, handoff, sprint, action }) {
  const rows = await readSprintRows(SPRINT_STATUS_FILE).catch(() => []);
  const sprintStatus = rows.find((row) => row.sprint === sprint)?.status ?? null;
  const qaReportExists = await fileExists(`docs/qa-report-sprint-${sprint}.md`);

  return resolveQaRound({ state, handoff, sprint, action, sprintStatus, qaReportExists });
}

export async function getNextDecision() {
  const planningState = await getPlanningState();

  if (planningState === "await-selection") {
    return {
      action: "await-design-selection",
      reason: "Design options written; waiting for design/selected-direction.md.",
    };
  }

  if (planningState === "finalize" || planningState === "scout" || planningState === "full") {
    return {
      action: "run-planner",
      reason: "Planning artifacts are missing.",
    };
  }

  const rows = await readSprintRows(SPRINT_STATUS_FILE);
  return computeNextActionFromRows(rows);
}

async function writePhaseHandoff({
  phase,
  sprint,
  qaRound,
  next,
  artifacts,
  runtime = {},
}) {
  const payload = {
    version: 1,
    updatedAt: new Date().toISOString(),
    sourceWorkflow: SOURCE,
    lastCompletedPhase: phase,
    targetSprint: sprint,
    qaRound,
    expectedNextAction: next,
    artifactsWritten: artifacts,
    ...(Object.keys(runtime).length ? { runtime } : {}),
  };

  await writeWorkflowHandoff(payload, HANDOFF_FILE);
}

export async function runSinglePhase({
  action,
  sprint = 1,
  qaRound = 1,
  productPrompt,
  policy,
  cwd = process.cwd(),
  dryRun = false,
}) {
  if (dryRun) {
    return { action, sprint, qaRound, dryRun: true };
  }

  await logEvent({ event: "phase.start", action, sprint, qaRound });

  let phase;
  let prompt;
  let handoffNext;
  let artifacts;

  if (action === "run-planner") {
    if (!productPrompt) {
      throw new Error("productPrompt is required for run-planner.");
    }

    phase = "planner";
    const harnessYes = process.env.HARNESS_YES === "1";
    prompt = await buildPlannerPrompt({ productPrompt, harnessYes, cwd });
    handoffNext = "run-generator";
    artifacts = [
      "docs/spec.md",
      "docs/sprint-plan.md",
      "docs/sprint-status.md",
      "CLAUDE.md",
    ];
    sprint = 1;
    qaRound = 1;
  } else if (action === "run-generator") {
    phase = "generator";
    prompt = await buildGeneratorPrompt({ sprint });
    handoffNext = "run-evaluator";
    artifacts = [`docs/sprint-${sprint}-contract.md`, "docs/sprint-status.md"];
  } else if (action === "run-evaluator") {
    phase = "evaluator";
    prompt = await buildEvaluatorPrompt({ sprint });
    handoffNext = "manual-review";
    artifacts = [`docs/qa-report-sprint-${sprint}.md`, "docs/sprint-status.md"];
  } else if (action === "done") {
    return { action: "done" };
  } else {
    throw new Error(`Cannot execute action '${action}'.`);
  }

  const runResult = await runPhase({ phase, prompt, policy, cwd });
  const validation = await assertPhaseOutputs(phase, sprint);

  if (phase === "planner" && validation.mode === "scout") {
    handoffNext = "await-design-selection";
    artifacts = ["docs/design-options.md"];
  }

  // For the evaluator, resolve the real next action from the canonical docs
  // before writing the handoff, so a single write carries both the decision
  // and the runtime block (agentId/runId) — no placeholder + overwrite.
  let postQa = null;
  if (phase === "evaluator") {
    const passed = await sprintPassed(sprint);
    const decision = await getNextDecision();
    handoffNext = decision.action;
    postQa = { passed, nextAction: decision.action };
  }

  await writePhaseHandoff({
    phase,
    sprint,
    qaRound,
    next: handoffNext,
    artifacts,
    runtime: {
      mode: policy.runtime.mode,
      ...(runResult.agentId ? { agentId: runResult.agentId } : {}),
      ...(runResult.runId ? { runId: runResult.runId } : {}),
    },
  });

  await updateOrchestratorState({
    productPrompt: productPrompt ?? undefined,
    currentSprint: sprint,
    qaRounds: { [String(sprint)]: qaRound },
    lastCompletedPhase: phase,
    lastRun: {
      phase,
      sprint,
      qaRound,
      status: runResult.status,
      runner: runResult.runner,
      agentId: runResult.agentId ?? null,
      runId: runResult.runId ?? null,
      startedAt: runResult.startedAt,
      endedAt: runResult.endedAt,
      durationMs: runResult.durationMs,
    },
    phaseHistory: [
      {
        phase,
        sprint,
        qaRound,
        status: runResult.status,
        at: runResult.endedAt,
      },
    ],
  });

  await logEvent({
    event: "phase.end",
    phase,
    sprint,
    qaRound,
    status: runResult.status,
    durationMs: runResult.durationMs,
    runner: runResult.runner,
  });

  if (postQa) {
    const roundsPolicy = await evaluateMaxRoundsPolicy({
      sprint,
      qaRound,
      passed: postQa.passed,
      policy,
    });
    postQa.roundsPolicy = roundsPolicy;

    // Single-phase invocations (resume/build/qa) are human-driven, so a
    // spent QA budget warns loudly instead of exiting hard — the operator
    // decides whether to keep iterating, skip the sprint, or intervene.
    if (!postQa.passed && qaRound >= policy.maxQaRounds) {
      console.warn(
        `WARNING: sprint ${sprint} failed QA on round ${qaRound}, which meets or exceeds the maxQaRounds budget (${policy.maxQaRounds}). ${roundsPolicy.reason}`,
      );
    }

    await logEvent({
      event: "sprint.result",
      sprint,
      qaRound,
      passed: postQa.passed,
      nextAction: postQa.nextAction,
    });
  }

  return {
    action,
    phase,
    sprint,
    qaRound,
    runResult,
    postQa,
  };
}

export async function evaluateMaxRoundsPolicy({
  sprint,
  qaRound,
  passed,
  policy,
}) {
  if (passed) {
    return { continue: true, reason: "Sprint passed." };
  }

  if (qaRound < policy.maxQaRounds) {
    return { continue: true, reason: "Retrying generator after QA failure." };
  }

  if (policy.onMaxRoundsReached === "advance-with-warning") {
    return {
      continue: true,
      reason: `Max QA rounds (${policy.maxQaRounds}) reached; advancing with warning.`,
      warning: true,
    };
  }

  return {
    continue: false,
    reason: `Max QA rounds (${policy.maxQaRounds}) reached for sprint ${sprint}.`,
    exitCode: 1,
  };
}

export async function dryRunSequence({ productPrompt, maxSteps = 20 } = {}) {
  if (await needsPlanning()) {
    return [
      {
        action: "run-planner",
        reason: "Planning artifacts are missing.",
        ...(productPrompt ? { productPrompt } : {}),
      },
      {
        action: "pending",
        reason: "Further dry-run steps require docs/sprint-status.md after planning.",
      },
    ];
  }

  // Read the on-disk rows once, then simulate each phase's transition in
  // memory (generator → Ready for QA, evaluator → Pass) so the sequence
  // walks the whole plan instead of re-reading unchanged files and emitting
  // the same decision maxSteps times. Steps after the first are marked
  // `simulated` with the assumption they rest on — nothing is written.
  const rows = (await readSprintRows(SPRINT_STATUS_FILE)).map((row) => ({ ...row }));
  const steps = [];

  for (let step = 0; step < maxSteps; step += 1) {
    const decision = computeNextActionFromRows(rows);
    const annotated = step === 0 ? decision : { ...decision, simulated: true };

    if (decision.action === "done" || decision.action === "manual-review") {
      steps.push(annotated);
      break;
    }

    const row = rows.find((entry) => entry.sprint === decision.sprint);
    if (!row) {
      steps.push(annotated);
      break;
    }

    if (decision.action === "run-generator") {
      annotated.assumes = "generator succeeds and marks the sprint 'Ready for QA'";
      row.status = "Ready for QA";
    } else if (decision.action === "run-evaluator") {
      annotated.assumes = "evaluator passes the sprint";
      row.status = "Pass";
    } else {
      steps.push(annotated);
      break;
    }

    steps.push(annotated);
  }

  return steps;
}

export async function resume({
  productPrompt,
  policy,
  cwd = process.cwd(),
  dryRun = false,
  continueLoop = false,
}) {
  if (continueLoop) {
    return runLoop({ productPrompt, policy, cwd, dryRun, continueOnly: true });
  }

  const decision = await getNextDecision();
  if (decision.action === "done") {
    console.log("✅ All sprints complete.");
    return { action: "done" };
  }

  if (decision.action === "manual-review") {
    throw new Error(decision.reason);
  }

  const handoff = await readWorkflowHandoff(HANDOFF_FILE);
  const state = await readOrchestratorState();

  const sprint = decision.sprint ?? 1;
  const qaRound = await resolveQaRoundFromDocs({
    state,
    handoff,
    sprint,
    action: decision.action,
  });

  return runSinglePhase({
    action: decision.action,
    sprint,
    qaRound,
    // A resumed run can omit --prompt; fall back to the prompt persisted
    // when the run started.
    productPrompt: productPrompt ?? state?.productPrompt ?? undefined,
    policy,
    cwd,
    dryRun,
  });
}

export async function runLoop({
  productPrompt,
  policy,
  cwd = process.cwd(),
  dryRun = false,
  continueOnly = false,
}) {
  // A dry run must not enter the live loop: runSinglePhase would return
  // without touching any files, so getNextDecision would yield the same
  // action forever. Delegate to the simulation instead.
  if (dryRun) {
    const steps = await dryRunSequence({ productPrompt });
    console.log(JSON.stringify(steps, null, 2));
    return { action: "dry-run", steps, phasesRun: 0 };
  }

  if (!continueOnly && productPrompt) {
    // Full replace, not a merge: a fresh run-loop must not inherit stale
    // qaRounds/phaseHistory from a previous run.
    await writeOrchestratorState(createInitialState({ productPrompt }));
  }

  let phasesRun = 0;

  while (true) {
    const decision = await getNextDecision();

    if (decision.action === "done") {
      console.log("");
      console.log("✅ All sprints complete!");
      await logEvent({ event: "loop.complete", reason: decision.reason });
      return { action: "done", phasesRun };
    }

    if (decision.action === "manual-review") {
      throw new Error(decision.reason);
    }

    if (decision.action === "await-design-selection") {
      console.log("");
      console.log("▶ DESIGN SCOUT COMPLETE");
      console.log("  Three design directions written to docs/design-options.md");
      console.log("");
      console.log("  Next steps:");
      console.log("    1. Review docs/design-options.md");
      console.log("    2. Create design/selected-direction.md with your pick");
      console.log("    3. Re-run with the same --prompt (or --continue)");
      await logEvent({ event: "loop.await-design-selection", reason: decision.reason });
      return { action: "await-design-selection", phasesRun };
    }

    if (policy.budgets.maxPhasesPerRun && phasesRun >= policy.budgets.maxPhasesPerRun) {
      throw new Error(`Reached maxPhasesPerRun budget (${policy.budgets.maxPhasesPerRun}).`);
    }

    const handoff = await readWorkflowHandoff(HANDOFF_FILE);
    const state = await readOrchestratorState();
    const sprint = decision.sprint ?? 1;
    const qaRound = await resolveQaRoundFromDocs({
      state,
      handoff,
      sprint,
      action: decision.action,
    });

    if (decision.action === "run-planner" && !productPrompt) {
      // Fall back to the prompt persisted when the run originally started.
      productPrompt = state?.productPrompt ?? undefined;
      if (!productPrompt) {
        throw new Error("productPrompt is required to start a new run-loop.");
      }
    }

    const rows = await readSprintRows(SPRINT_STATUS_FILE).catch(() => []);
    const totalSprints = rows.length;

    if (decision.action !== "run-planner") {
      console.log("");
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`  Sprint ${sprint}${totalSprints ? ` / ${totalSprints}` : ""}, QA round ${qaRound}`);
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    }

    const result = await runSinglePhase({
      action: decision.action,
      sprint,
      qaRound,
      productPrompt,
      policy,
      cwd,
      dryRun,
    });

    phasesRun += 1;

    if (result.postQa) {
      const policyResult =
        result.postQa.roundsPolicy ??
        (await evaluateMaxRoundsPolicy({
          sprint,
          qaRound,
          passed: result.postQa.passed,
          policy,
        }));

      if (result.postQa.passed) {
        console.log(`✅ Sprint ${sprint} PASSED on round ${qaRound}`);
      } else {
        console.log(`❌ Sprint ${sprint} FAILED on round ${qaRound}`);
      }

      if (!policyResult.continue) {
        console.error(policyResult.reason);
        await logEvent({
          event: "loop.halt",
          sprint,
          qaRound,
          reason: policyResult.reason,
        });
        throw new Error(policyResult.reason);
      }

      if (policyResult.warning) {
        console.warn(policyResult.reason);
        await markSprintSkipped({
          sprint,
          notes: `Max QA rounds (${policy.maxQaRounds}) reached; advanced with known issues`,
        });
        await logEvent({
          event: "loop.advance-warning",
          sprint,
          qaRound,
          reason: policyResult.reason,
        });
      } else if (!result.postQa.passed) {
        console.log("  → Sending back to Generator for fixes...");
      }
    }
  }
}

export async function runPlan({ productPrompt, policy, cwd, dryRun }) {
  return runSinglePhase({
    action: "run-planner",
    sprint: 1,
    qaRound: 1,
    productPrompt,
    policy,
    cwd,
    dryRun,
  });
}

export async function runBuild({ sprint, policy, cwd, dryRun }) {
  const decision = await getNextDecision();
  const targetSprint = sprint ?? decision.sprint ?? 1;
  const handoff = await readWorkflowHandoff(HANDOFF_FILE);
  const state = await readOrchestratorState();
  const qaRound = await resolveQaRoundFromDocs({
    state,
    handoff,
    sprint: targetSprint,
    action: "run-generator",
  });

  return runSinglePhase({
    action: "run-generator",
    sprint: targetSprint,
    qaRound,
    policy,
    cwd,
    dryRun,
  });
}

export async function runQa({ sprint, policy, cwd, dryRun }) {
  const decision = await getNextDecision();
  const targetSprint = sprint ?? decision.sprint ?? 1;
  const handoff = await readWorkflowHandoff(HANDOFF_FILE);
  const state = await readOrchestratorState();
  const qaRound = await resolveQaRoundFromDocs({
    state,
    handoff,
    sprint: targetSprint,
    action: "run-evaluator",
  });

  return runSinglePhase({
    action: "run-evaluator",
    sprint: targetSprint,
    qaRound,
    policy,
    cwd,
    dryRun,
  });
}
