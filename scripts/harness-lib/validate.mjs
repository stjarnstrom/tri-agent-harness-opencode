import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileExists } from "./fs-utils.mjs";
import { readSprintRows, SPRINT_STATUS_FILE } from "./sprint-status.mjs";

const PHASES = new Set(["planner", "generator", "evaluator"]);

const PHASE_REQUIRED_FILES = {
  planner: [
    "docs/spec.md",
    "docs/sprint-plan.md",
    "docs/sprint-status.md",
  ],
  generator: (sprint) => [
    `docs/sprint-${sprint}-contract.md`,
    "docs/sprint-status.md",
  ],
  evaluator: (sprint) => [
    `docs/qa-report-sprint-${sprint}.md`,
    "docs/sprint-status.md",
  ],
};

// The sprint-status row is the source of truth (a loose grep on the QA
// report matches failing phrasings like "Result: FAIL — 12 of 15 criteria
// passed"). The report is only consulted as a FAIL cross-check.
export async function sprintPassed(sprintNum) {
  const status = await getSprintStatus(sprintNum);
  if (status !== "Pass") {
    return false;
  }
  const reportPath = path.join("docs", `qa-report-sprint-${sprintNum}.md`);
  try {
    const raw = await readFile(reportPath, "utf8");
    if (/Result[^a-z0-9]*FAIL/i.test(raw)) {
      console.warn(
        `WARNING: sprint-status row says Pass but ${reportPath} records Result: FAIL — not counting sprint ${sprintNum} as passed.`,
      );
      return false;
    }
  } catch {
    // No readable report — the status row is canonical.
  }
  return true;
}

export async function getSprintStatus(sprintNum, filePath = SPRINT_STATUS_FILE) {
  const rows = await readSprintRows(filePath);
  const row = rows.find((entry) => entry.sprint === sprintNum);
  return row?.status ?? null;
}

function requiredFilesForPhase(phase, sprint) {
  const spec = PHASE_REQUIRED_FILES[phase];
  if (typeof spec === "function") {
    return spec(sprint);
  }
  return spec;
}

export async function assertPhaseOutputs(phase, sprint = 1) {
  if (!PHASES.has(phase)) {
    throw new Error(`Invalid phase '${phase}'. Expected planner, generator, or evaluator.`);
  }

  if (!Number.isInteger(sprint) || sprint < 1) {
    throw new Error("sprint must be a positive integer.");
  }

  const required = requiredFilesForPhase(phase, sprint);
  const missing = [];

  for (const filePath of required) {
    if (!(await fileExists(filePath))) {
      missing.push(filePath);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `${phase} phase validation failed for sprint ${sprint}. Missing: ${missing.join(", ")}`,
    );
  }

  if (phase === "generator") {
    const status = await getSprintStatus(sprint);
    if (status !== "Ready for QA") {
      throw new Error(
        `generator phase validation failed for sprint ${sprint}. Expected sprint status 'Ready for QA', got '${status ?? "unknown"}'.`,
      );
    }
  }

  if (phase === "evaluator") {
    const status = await getSprintStatus(sprint);
    if (status !== "Pass" && status !== "Fail") {
      throw new Error(
        `evaluator phase validation failed for sprint ${sprint}. Expected sprint status 'Pass' or 'Fail', got '${status ?? "unknown"}'.`,
      );
    }
  }

  return { phase, sprint, ok: true };
}
