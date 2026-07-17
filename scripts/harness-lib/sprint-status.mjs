import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const SPRINT_STATUS_FILE = path.join("docs", "sprint-status.md");

export const TERMINAL_PASS = "Pass";
export const TERMINAL_SKIPPED = "Skipped";
const TERMINAL_STATUSES = new Set([TERMINAL_PASS, TERMINAL_SKIPPED]);
const GENERATOR_STATUSES = new Set(["Not started", "In progress", "Fail"]);
const EVALUATOR_STATUS = "Ready for QA";

export function isTerminalStatus(status) {
  return TERMINAL_STATUSES.has(status);
}

function parseStatusFromRow(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|")) {
    return null;
  }

  const cells = trimmed
    .split("|")
    .map((cell) => cell.trim())
    .filter((cell, idx, arr) => !(idx === 0 || idx === arr.length - 1));

  if (cells.length < 4) {
    return null;
  }

  const sprintNum = Number.parseInt(cells[0], 10);
  if (!Number.isInteger(sprintNum)) {
    return null;
  }

  const status = cells[2];
  if (!status) {
    return null;
  }

  return { sprint: sprintNum, status };
}

export async function readSprintRows(filePath = SPRINT_STATUS_FILE) {
  const raw = await readFile(filePath, "utf8");
  const rows = [];

  for (const line of raw.split("\n")) {
    const parsed = parseStatusFromRow(line);
    if (parsed) {
      rows.push(parsed);
    }
  }

  return rows.sort((a, b) => a.sprint - b.sprint);
}

export function computeNextActionFromRows(rows) {
  if (!rows.length) {
    return {
      action: "run-planner",
      reason: "No sprint rows found in sprint-status.",
    };
  }

  for (const row of rows) {
    if (isTerminalStatus(row.status)) {
      continue;
    }

    if (GENERATOR_STATUSES.has(row.status)) {
      return {
        action: "run-generator",
        sprint: row.sprint,
        reason: `Sprint ${row.sprint} is '${row.status}'.`,
      };
    }

    if (row.status === EVALUATOR_STATUS) {
      return {
        action: "run-evaluator",
        sprint: row.sprint,
        reason: `Sprint ${row.sprint} is ready for QA.`,
      };
    }

    return {
      action: "manual-review",
      sprint: row.sprint,
      reason: `Sprint ${row.sprint} has unknown status '${row.status}'.`,
    };
  }

  return {
    action: "done",
    reason: "All sprints are complete (Pass or Skipped).",
  };
}

export async function updateSprintStatus({
  sprint,
  status,
  notes,
  filePath = SPRINT_STATUS_FILE,
}) {
  if (!Number.isInteger(sprint) || sprint < 1) {
    throw new Error("sprint must be a positive integer.");
  }

  const raw = await readFile(filePath, "utf8");
  let updated = false;

  const newLines = raw.split("\n").map((line) => {
    const parsed = parseStatusFromRow(line);
    if (!parsed || parsed.sprint !== sprint) {
      return line;
    }

    updated = true;
    const cells = line
      .trim()
      .split("|")
      .map((cell) => cell.trim())
      .filter((cell, idx, arr) => !(idx === 0 || idx === arr.length - 1));

    cells[2] = status;
    if (notes !== undefined && cells.length >= 4) {
      cells[cells.length - 1] = notes;
    }

    return `| ${cells.join(" | ")} |`;
  });

  if (!updated) {
    throw new Error(`Sprint ${sprint} not found in ${filePath}.`);
  }

  const trailingNewline = raw.endsWith("\n") ? "\n" : "";
  await writeFile(filePath, `${newLines.join("\n")}${trailingNewline}`, "utf8");
}

export async function markSprintSkipped({
  sprint,
  notes = "Max QA rounds reached; advanced with known issues",
  filePath = SPRINT_STATUS_FILE,
}) {
  await updateSprintStatus({
    sprint,
    status: TERMINAL_SKIPPED,
    notes,
    filePath,
  });
}
