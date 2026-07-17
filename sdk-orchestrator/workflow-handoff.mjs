import { readFile } from "node:fs/promises";
import path from "node:path";
import { writeFileAtomic } from "./fs-utils.mjs";

export const HANDOFF_FILE = path.join("docs", "workflow-handoff.json");

const PHASES = new Set(["planner", "generator", "evaluator"]);
const NEXT_ACTIONS = new Set([
  "run-planner",
  "run-generator",
  "run-evaluator",
  "await-design-selection",
  "done",
  "manual-review",
]);
const RUNTIMES = new Set(["local", "cloud"]);

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

export function validateHandoff(data) {
  assert(typeof data === "object" && data !== null, "Handoff must be an object.");
  assert(data.version === 1, "Handoff version must be 1.");
  assert(
    typeof data.updatedAt === "string" && data.updatedAt.length > 0,
    "Handoff updatedAt must be a non-empty string.",
  );
  assert(
    typeof data.sourceWorkflow === "string" && data.sourceWorkflow.length > 0,
    "Handoff sourceWorkflow must be a non-empty string.",
  );
  assert(PHASES.has(data.lastCompletedPhase), "Invalid lastCompletedPhase.");
  assert(
    isPositiveInteger(data.targetSprint),
    "Handoff targetSprint must be a positive integer.",
  );
  assert(
    isPositiveInteger(data.qaRound),
    "Handoff qaRound must be a positive integer.",
  );
  assert(
    NEXT_ACTIONS.has(data.expectedNextAction),
    "Invalid expectedNextAction in handoff.",
  );
  assert(Array.isArray(data.artifactsWritten), "artifactsWritten must be an array.");
  data.artifactsWritten.forEach((artifact, idx) => {
    assert(typeof artifact === "string" && artifact.length > 0, `artifactsWritten[${idx}] must be a non-empty string.`);
  });

  if (data.runtime !== undefined) {
    assert(typeof data.runtime === "object" && data.runtime !== null, "runtime must be an object when present.");
    if (data.runtime.mode !== undefined) {
      assert(RUNTIMES.has(data.runtime.mode), "runtime.mode must be local or cloud.");
    }
    if (data.runtime.agentId !== undefined) {
      assert(typeof data.runtime.agentId === "string", "runtime.agentId must be a string.");
    }
    if (data.runtime.runId !== undefined) {
      assert(typeof data.runtime.runId === "string", "runtime.runId must be a string.");
    }
  }

  if (data.notes !== undefined) {
    assert(typeof data.notes === "string", "notes must be a string when present.");
  }
}

export async function readWorkflowHandoff(filePath = HANDOFF_FILE) {
  let raw;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }

  // The handoff manifest is advisory — docs/sprint-status.md is canonical.
  // Corrupt or schema-invalid content is treated as "no handoff".
  try {
    const parsed = JSON.parse(raw);
    validateHandoff(parsed);
    return parsed;
  } catch (error) {
    console.warn(
      `WARNING: ignoring invalid ${filePath} (${error.message}); treating as no handoff. docs/sprint-status.md remains canonical.`,
    );
    return null;
  }
}

export async function writeWorkflowHandoff(data, filePath = HANDOFF_FILE) {
  validateHandoff(data);
  await writeFileAtomic(filePath, `${JSON.stringify(data, null, 2)}\n`);
}
