import { readFile } from "node:fs/promises";
import path from "node:path";
import { writeFileAtomic } from "./fs-utils.mjs";

export const STATE_FILE = path.join("docs", "orchestrator-state.json");

export async function readOrchestratorState(filePath = STATE_FILE) {
  let raw;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }

  // This file is advisory bookkeeping — docs/sprint-status.md is canonical.
  // Corrupt or schema-invalid content must never brick the orchestrator.
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("state must be a JSON object");
    }
    return parsed;
  } catch (error) {
    console.warn(
      `WARNING: ignoring unreadable ${filePath} (${error.message}); treating as no state. docs/sprint-status.md remains canonical.`,
    );
    return null;
  }
}

export async function writeOrchestratorState(state, filePath = STATE_FILE) {
  await writeFileAtomic(filePath, `${JSON.stringify(state, null, 2)}\n`);
}

export function createInitialState({ productPrompt }) {
  return {
    version: 1,
    startedAt: new Date().toISOString(),
    productPrompt: productPrompt ?? null,
    currentSprint: null,
    qaRounds: {},
    lastCompletedPhase: null,
    lastRun: null,
    phaseHistory: [],
  };
}

export async function updateOrchestratorState(patch, filePath = STATE_FILE) {
  const existing = (await readOrchestratorState(filePath)) ?? createInitialState({});
  const phaseHistory = patch.phaseHistory
    ? [...(existing.phaseHistory ?? []), ...patch.phaseHistory]
    : existing.phaseHistory;

  const next = {
    ...existing,
    ...patch,
    qaRounds: { ...existing.qaRounds, ...patch.qaRounds },
    phaseHistory,
    updatedAt: new Date().toISOString(),
  };
  await writeOrchestratorState(next, filePath);
  return next;
}

export function resolveQaRound({
  state,
  handoff,
  sprint,
  action,
  sprintStatus,
  qaReportExists = false,
}) {
  const fromState = state?.qaRounds?.[String(sprint)];
  const fromHandoff = handoff?.targetSprint === sprint ? handoff.qaRound : null;

  if (action === "run-evaluator") {
    return fromHandoff ?? fromState ?? 1;
  }

  if (action === "run-generator") {
    if (handoff?.targetSprint === sprint && handoff.lastCompletedPhase === "evaluator") {
      return (handoff.qaRound ?? 0) + 1;
    }

    // The evaluator's handoff write was lost but the state file recorded the
    // run: the next generator pass is a new round.
    if (state?.lastCompletedPhase === "evaluator" && state?.lastRun?.sprint === sprint) {
      return (state.lastRun.qaRound ?? fromState ?? 0) + 1;
    }

    // Both bookkeeping writes were lost, but the canonical docs prove an
    // evaluator ran (the sprint row is Fail and a QA report exists) while the
    // recorded bookkeeping never got past the generator. Count that
    // unrecorded round so the budget isn't silently extended.
    if (sprintStatus === "Fail" && qaReportExists) {
      return (fromHandoff ?? fromState ?? 1) + 1;
    }

    return fromHandoff ?? fromState ?? 1;
  }

  return fromHandoff ?? fromState ?? 1;
}
