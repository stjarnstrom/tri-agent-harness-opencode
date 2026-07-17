#!/usr/bin/env node
/**
 * Thin CLI for OpenCode harness helpers: validate, handoff, sprint status.
 * Used by opencode-harness.sh / harness-common.sh / pre-qa-gate.sh.
 */

import { access } from "node:fs/promises";
import {
  computeNextActionFromRows,
  readSprintRows,
  SPRINT_STATUS_FILE,
  markSprintSkipped,
} from "./sprint-status.mjs";
import { assertPhaseOutputs } from "./validate.mjs";
import {
  HANDOFF_FILE,
  writeWorkflowHandoff,
} from "./workflow-handoff.mjs";

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
  node scripts/harness-lib/cli.mjs validate --phase <planner|generator|evaluator> --sprint <N>
  node scripts/harness-lib/cli.mjs sprint-mark-skipped --sprint <N> [--notes "..."]
  node scripts/harness-lib/cli.mjs handoff-write --phase <planner|generator|evaluator> --sprint <N> --qa-round <N> --next <run-planner|run-generator|run-evaluator|done|manual-review> --source <workflow> [--artifacts <comma,separated,paths>] [--runtime-mode <local|cloud>] [--agent-id <id>] [--run-id <id>] [--notes <text>]
  node scripts/harness-lib/cli.mjs post-qa-write [--sprint <N>] [--qa-round <N>] [--source <workflow>]
`);
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

  const artifacts =
    typeof flags.artifacts === "string" && flags.artifacts.length > 0
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
    sourceWorkflow: flags.source ?? "opencode-harness.sh",
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

  if (!command) {
    usage();
    throw new Error("Missing command.");
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
