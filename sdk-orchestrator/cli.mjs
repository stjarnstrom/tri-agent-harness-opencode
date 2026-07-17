#!/usr/bin/env node

import { access } from "node:fs/promises";
import { computeNextActionFromRows, readSprintRows, SPRINT_STATUS_FILE, markSprintSkipped } from "./sprint-status.mjs";
import { assertPhaseOutputs, sprintPassed } from "./validate.mjs";
import { HANDOFF_FILE, readWorkflowHandoff, writeWorkflowHandoff } from "./workflow-handoff.mjs";
import { loadPolicy } from "./policy.mjs";
import {
  dryRunSequence,
  getNextDecision,
  resume,
  runBuild,
  runLoop,
  runPlan,
  runQa,
} from "./orchestrator.mjs";
import { readOrchestratorState } from "./state-store.mjs";
import { EVENT_LOG_FILE } from "./event-log.mjs";

function parseArgs(argv) {
  const positional = [];
  const flags = {};

  for (let idx = 0; idx < argv.length; idx += 1) {
    const token = argv[idx];
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }

    const key = token.slice(2);
    const next = argv[idx + 1];
    if (next && !next.startsWith("--")) {
      flags[key] = next;
      idx += 1;
    } else {
      flags[key] = true;
    }
  }

  return { positional, flags };
}

function nowIso() {
  return new Date().toISOString();
}

async function hasSprintStatus() {
  try {
    await access(SPRINT_STATUS_FILE);
    return true;
  } catch {
    return false;
  }
}

function usage() {
  console.log(`Usage:
  node sdk-orchestrator/cli.mjs run-loop --prompt "..." [--continue] [--dry-run]
  node sdk-orchestrator/cli.mjs resume [--continue] [--dry-run] [--json] [--prompt "..."]
                                       (--json without --continue prints status JSON only, never runs a phase)
  node sdk-orchestrator/cli.mjs plan --prompt "..." [--dry-run]
  node sdk-orchestrator/cli.mjs build [--sprint N] [--dry-run]
  node sdk-orchestrator/cli.mjs qa [--sprint N] [--dry-run]
  node sdk-orchestrator/cli.mjs dry-run [--prompt "..."] [--max-steps N]
  node sdk-orchestrator/cli.mjs status [--json]
  node sdk-orchestrator/cli.mjs validate --phase <planner|generator|evaluator> --sprint <N>
  node sdk-orchestrator/cli.mjs sprint-mark-skipped --sprint <N> [--notes "..."]
  node sdk-orchestrator/cli.mjs handoff-write --phase <planner|generator|evaluator> --sprint <N> --qa-round <N> --next <run-planner|run-generator|run-evaluator|done|manual-review> --source <workflow> [--artifacts <comma,separated,paths>] [--runtime-mode <local|cloud>] [--agent-id <id>] [--run-id <id>] [--notes <text>]
  node sdk-orchestrator/cli.mjs post-qa-write [--sprint <N>] [--qa-round <N>] [--source <workflow>]

Environment overrides:
  HARNESS_MODEL            Override all phase models
  HARNESS_MAX_QA_ROUNDS    Override max QA rounds
  HARNESS_RUNNER=cli       Prefer cursor CLI over SDK
  HARNESS_ON_MAX_ROUNDS=advance  Advance instead of halt on max rounds
  CURSOR_API_KEY           Required for SDK runner (cli fallback if unset)
`);
}

function printDecision(decision, handoff, asJson) {
  const summary = {
    decision,
    handoff: handoff
      ? {
          sourceWorkflow: handoff.sourceWorkflow,
          lastCompletedPhase: handoff.lastCompletedPhase,
          targetSprint: handoff.targetSprint,
          qaRound: handoff.qaRound,
          expectedNextAction: handoff.expectedNextAction,
          updatedAt: handoff.updatedAt,
        }
      : null,
  };

  if (asJson) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  console.log(`Next action: ${decision.action}`);
  if (decision.sprint) {
    console.log(`Target sprint: ${decision.sprint}`);
  }
  console.log(`Reason: ${decision.reason}`);
  if (handoff) {
    console.log(
      `Last handoff: ${handoff.lastCompletedPhase} (sprint ${handoff.targetSprint}, qa round ${handoff.qaRound}) from ${handoff.sourceWorkflow}`,
    );
    if (handoff.expectedNextAction !== decision.action) {
      console.log(
        `Notice: manifest expected '${handoff.expectedNextAction}' but canonical docs resolve to '${decision.action}'.`,
      );
    }
  } else {
    console.log("Last handoff: none");
  }
}

async function runResumeCommand(flags) {
  const policy = await loadPolicy();
  const dryRun = Boolean(flags["dry-run"]);
  const continueLoop = Boolean(flags.continue);
  const asJson = Boolean(flags.json);

  if (dryRun || asJson) {
    const decision = await getNextDecision();
    const handoff = await readWorkflowHandoff(HANDOFF_FILE);
    printDecision(decision, handoff, asJson);
  }

  // --json is an inspection flag: without --continue it prints status only
  // and never executes a phase.
  if (asJson && !continueLoop) {
    return;
  }

  if (continueLoop) {
    await runLoop({
      productPrompt: flags.prompt,
      policy,
      dryRun,
      continueOnly: true,
    });
    return;
  }

  if (dryRun) {
    return;
  }

  await resume({ policy, continueLoop: false, productPrompt: flags.prompt });
}

async function runHandoffWrite(flags) {
  const phase = flags.phase;
  const sprint = Number.parseInt(flags.sprint, 10);
  const qaRound = Number.parseInt(flags["qa-round"], 10);
  const next = flags.next;
  const source = flags.source ?? "manual";

  if (!phase || !Number.isInteger(sprint) || !Number.isInteger(qaRound) || !next) {
    throw new Error("Missing required flags for handoff-write. See usage.");
  }

  const artifacts = typeof flags.artifacts === "string" && flags.artifacts.length > 0
    ? flags.artifacts.split(",").map((part) => part.trim()).filter(Boolean)
    : [];

  const runtime = {};
  if (flags["runtime-mode"]) {
    runtime.mode = flags["runtime-mode"];
  }
  if (flags["agent-id"]) {
    runtime.agentId = flags["agent-id"];
  }
  if (flags["run-id"]) {
    runtime.runId = flags["run-id"];
  }

  const payload = {
    version: 1,
    updatedAt: nowIso(),
    sourceWorkflow: source,
    lastCompletedPhase: phase,
    targetSprint: sprint,
    qaRound,
    expectedNextAction: next,
    artifactsWritten: artifacts,
    ...(Object.keys(runtime).length ? { runtime } : {}),
    ...(flags.notes ? { notes: `${flags.notes}` } : {}),
  };

  await writeWorkflowHandoff(payload, HANDOFF_FILE);
  console.log(`Wrote ${HANDOFF_FILE}`);
}

function findLatestEvaluatedSprint(rows) {
  const evaluated = rows
    .filter((row) => row.status === "Pass" || row.status === "Fail")
    .sort((a, b) => b.sprint - a.sprint);
  return evaluated.length ? evaluated[0].sprint : null;
}

async function runValidate(flags) {
  const phase = flags.phase;
  const sprint = Number.parseInt(flags.sprint, 10);

  if (!phase || !Number.isInteger(sprint)) {
    throw new Error("Missing required flags for validate. Use --phase and --sprint.");
  }

  await assertPhaseOutputs(phase, sprint);
  console.log(`Validation passed: ${phase} (sprint ${sprint})`);
}

async function runStatus(flags) {
  const asJson = Boolean(flags.json);
  const hasStatus = await hasSprintStatus();
  const handoff = await readWorkflowHandoff(HANDOFF_FILE);
  const orchestratorState = await readOrchestratorState();

  let decision;
  let rows = [];
  let totalSprints = 0;

  if (!hasStatus) {
    decision = {
      action: "run-planner",
      reason: "docs/sprint-status.md is missing.",
    };
  } else {
    rows = await readSprintRows(SPRINT_STATUS_FILE);
    totalSprints = rows.length;
    decision = computeNextActionFromRows(rows);
  }

  const currentSprint = decision.sprint ?? handoff?.targetSprint ?? orchestratorState?.currentSprint ?? null;
  let sprintPassedResult = null;
  if (currentSprint) {
    sprintPassedResult = await sprintPassed(currentSprint);
  }

  const summary = {
    nextAction: decision.action,
    reason: decision.reason,
    currentSprint,
    totalSprints,
    qaRound: handoff?.qaRound ?? orchestratorState?.qaRounds?.[String(currentSprint)] ?? null,
    lastCompletedPhase: handoff?.lastCompletedPhase ?? orchestratorState?.lastCompletedPhase ?? null,
    sourceWorkflow: handoff?.sourceWorkflow ?? null,
    sprintPassed: sprintPassedResult,
    handoffUpdatedAt: handoff?.updatedAt ?? null,
    orchestratorUpdatedAt: orchestratorState?.updatedAt ?? null,
    eventLog: EVENT_LOG_FILE,
    runtime: handoff?.runtime ?? orchestratorState?.lastRun ?? null,
  };

  if (asJson) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  console.log(`Next action: ${summary.nextAction}`);
  if (summary.currentSprint) {
    console.log(`Current sprint: ${summary.currentSprint}${summary.totalSprints ? ` / ${summary.totalSprints}` : ""}`);
  }
  if (summary.qaRound) {
    console.log(`QA round: ${summary.qaRound}`);
  }
  if (summary.lastCompletedPhase) {
    console.log(`Last completed phase: ${summary.lastCompletedPhase}`);
  }
  if (summary.sourceWorkflow) {
    console.log(`Source workflow: ${summary.sourceWorkflow}`);
  }
  if (summary.sprintPassed !== null) {
    console.log(`Sprint passed (status row): ${summary.sprintPassed ? "yes" : "no"}`);
  }
  if (summary.runtime?.agentId) {
    console.log(`Agent ID: ${summary.runtime.agentId}`);
  }
  if (summary.runtime?.runId) {
    console.log(`Run ID: ${summary.runtime.runId}`);
  }
  console.log(`Event log: ${summary.eventLog}`);
  console.log(`Reason: ${summary.reason}`);
}

async function runPostQaWrite(flags) {
  if (!(await hasSprintStatus())) {
    throw new Error("docs/sprint-status.md is missing. Cannot write post-QA handoff.");
  }

  const rows = await readSprintRows(SPRINT_STATUS_FILE);
  const decision = computeNextActionFromRows(rows);

  const sprintFromFlag = flags.sprint ? Number.parseInt(flags.sprint, 10) : null;
  const targetSprint = Number.isInteger(sprintFromFlag)
    ? sprintFromFlag
    : findLatestEvaluatedSprint(rows);

  if (!targetSprint) {
    throw new Error(
      "Could not infer evaluated sprint from docs/sprint-status.md. Pass --sprint <N>.",
    );
  }

  const qaRound = flags["qa-round"] ? Number.parseInt(flags["qa-round"], 10) : 1;
  if (!Number.isInteger(qaRound) || qaRound < 1) {
    throw new Error("qa-round must be a positive integer.");
  }

  const payload = {
    version: 1,
    updatedAt: nowIso(),
    sourceWorkflow: flags.source ?? "cursor-post-qa.sh",
    lastCompletedPhase: "evaluator",
    targetSprint,
    qaRound,
    expectedNextAction: decision.action,
    artifactsWritten: [
      "docs/sprint-status.md",
      `docs/qa-report-sprint-${targetSprint}.md`,
    ],
    notes: `Post-QA handoff after evaluator result for sprint ${targetSprint}.`,
  };

  await writeWorkflowHandoff(payload, HANDOFF_FILE);
  console.log(`Wrote ${HANDOFF_FILE}`);
  console.log(`Next action recorded: ${decision.action}`);
}

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const command = positional[0];
  const policy = await loadPolicy();
  const dryRun = Boolean(flags["dry-run"]);

  if (!command || command === "help" || command === "--help") {
    usage();
    process.exit(0);
  }

  if (command === "run-loop") {
    const productPrompt = flags.prompt;
    const continueOnly = Boolean(flags.continue);

    console.log("============================================");
    console.log("  SDK ORCHESTRATOR: Three-Agent Build");
    if (productPrompt) {
      console.log(`  Prompt: ${productPrompt}`);
    }
    console.log(`  Max QA rounds per sprint: ${policy.maxQaRounds}`);
    console.log(`  On max rounds: ${policy.onMaxRoundsReached}`);
    console.log(`  Models: planner=${policy.models.planner}, generator=${policy.models.generator}, evaluator=${policy.models.evaluator}`);
    console.log(`  Runner: ${policy.runtime.runner}`);
    console.log("============================================");

    if (dryRun) {
      const steps = await dryRunSequence({ productPrompt });
      console.log(JSON.stringify(steps, null, 2));
      return;
    }

    await runLoop({
      productPrompt,
      policy,
      continueOnly,
    });
    return;
  }

  if (command === "resume") {
    await runResumeCommand(flags);
    return;
  }

  if (command === "plan") {
    if (!flags.prompt) {
      throw new Error("plan requires --prompt.");
    }
    await runPlan({ productPrompt: flags.prompt, policy, dryRun });
    return;
  }

  if (command === "build") {
    const sprint = flags.sprint ? Number.parseInt(flags.sprint, 10) : undefined;
    await runBuild({ sprint, policy, dryRun });
    return;
  }

  if (command === "qa") {
    const sprint = flags.sprint ? Number.parseInt(flags.sprint, 10) : undefined;
    await runQa({ sprint, policy, dryRun });
    return;
  }

  if (command === "dry-run") {
    const steps = await dryRunSequence({
      productPrompt: flags.prompt,
      maxSteps: flags["max-steps"] ? Number.parseInt(flags["max-steps"], 10) : 20,
    });
    console.log(JSON.stringify(steps, null, 2));
    return;
  }

  if (command === "status") {
    await runStatus(flags);
    return;
  }

  if (command === "validate") {
    await runValidate(flags);
    return;
  }

  if (command === "sprint-mark-skipped") {
    const sprint = Number.parseInt(flags.sprint, 10);
    if (!Number.isInteger(sprint) || sprint < 1) {
      throw new Error("sprint-mark-skipped requires --sprint <N>.");
    }
    await markSprintSkipped({
      sprint,
      notes:
        flags.notes ??
        "Max QA rounds reached; advanced with known issues",
    });
    console.log(`Marked sprint ${sprint} as Skipped in ${SPRINT_STATUS_FILE}.`);
    return;
  }

  if (command === "handoff-write") {
    await runHandoffWrite(flags);
    return;
  }

  if (command === "post-qa-write") {
    await runPostQaWrite(flags);
    return;
  }

  usage();
  throw new Error(`Unknown command '${command}'.`);
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exit(1);
});
