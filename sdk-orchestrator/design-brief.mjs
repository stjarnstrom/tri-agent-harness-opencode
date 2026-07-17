import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileExists } from "./fs-utils.mjs";

const REFERENCE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".svg"]);
const BRIEF_MARKDOWN_FILES = ["brief.md", "constraints.md"];
const LEGACY_BRAND_PATHS = ["brand-guidelines.md", path.join("agents", "brand-guidelines.md")];

async function readTextIfExists(filePath) {
  if (!(await fileExists(filePath))) {
    return null;
  }
  return readFile(filePath, "utf8");
}

async function listReferenceAssets(designDir) {
  const referencesDir = path.join(designDir, "references");
  if (!(await fileExists(referencesDir))) {
    return [];
  }

  const entries = await readdir(referencesDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => REFERENCE_EXTENSIONS.has(path.extname(name).toLowerCase()))
    .sort()
    .map((name) => path.join("design", "references", name));
}

async function hasMarkdownBriefContent(designDir) {
  for (const name of BRIEF_MARKDOWN_FILES) {
    const filePath = path.join(designDir, name);
    const content = await readTextIfExists(filePath);
    if (content?.trim()) {
      return true;
    }
  }
  return false;
}

export async function hasDesignBriefInput(cwd = process.cwd()) {
  const designDir = path.join(cwd, "design");

  if (await hasMarkdownBriefContent(designDir)) {
    return true;
  }

  for (const legacyPath of LEGACY_BRAND_PATHS) {
    const content = await readTextIfExists(path.join(cwd, legacyPath));
    if (content?.trim()) {
      return true;
    }
  }

  const references = await listReferenceAssets(designDir);
  return references.length > 0;
}

export async function hasSelectedDirection(cwd = process.cwd()) {
  const content = await readTextIfExists(path.join(cwd, "design", "selected-direction.md"));
  return Boolean(content?.trim());
}

export async function isDesignScoutComplete(cwd = process.cwd()) {
  const hasOptions = await fileExists(path.join(cwd, "docs", "design-options.md"));
  const hasSprintStatus = await fileExists(path.join(cwd, "docs", "sprint-status.md"));
  return hasOptions && !hasSprintStatus;
}

export async function isPlanningComplete(cwd = process.cwd()) {
  const hasSpec = await fileExists(path.join(cwd, "docs", "spec.md"));
  const hasSprintStatus = await fileExists(path.join(cwd, "docs", "sprint-status.md"));
  return hasSpec && hasSprintStatus;
}

export async function getPlanningState(cwd = process.cwd(), { harnessYes = false } = {}) {
  if (await isPlanningComplete(cwd)) {
    return "complete";
  }

  if (await isDesignScoutComplete(cwd)) {
    if (await hasSelectedDirection(cwd)) {
      return "finalize";
    }
    return "await-selection";
  }

  if (await hasDesignBriefInput(cwd) || harnessYes) {
    return "full";
  }

  return "scout";
}

/**
 * Planner phase mode:
 * - full: user brief present, or HARNESS_YES with no brief (autonomous pick)
 * - finalize: user selected a direction from design-options
 * - scout: no brief, propose three directions
 * - complete: planning artifacts already exist
 */
export async function getPlannerMode(cwd = process.cwd(), { harnessYes = false } = {}) {
  const state = await getPlanningState(cwd, { harnessYes });
  if (state === "complete") {
    return "complete";
  }
  if (state === "await-selection") {
    return "scout";
  }
  if (state === "finalize") {
    return "finalize";
  }
  if (state === "full") {
    return "full";
  }
  return "scout";
}

export async function needsPlanning(cwd = process.cwd(), options = {}) {
  return (await getPlanningState(cwd, options)) !== "complete";
}

export function buildPlannerModeInstructions(mode) {
  switch (mode) {
    case "scout":
      return `
DESIGN SCOUT MODE: No user design brief was provided.

Write ONLY docs/design-options.md using the shape in docs/templates/design-options.md.
Include exactly 3 materially different design directions (Option A, B, C). Each must have
aesthetic, palette, typography, motion, signature element, and rationale.

Do NOT write docs/sprint-plan.md or docs/sprint-status.md.
Do NOT write a full docs/spec.md — at most a one-paragraph product stub if needed for context.

Stop after docs/design-options.md is complete. The harness will pause for the user to pick a direction.`;

    case "finalize":
      return `
DESIGN FINALIZE MODE: The user selected a design direction.

Read design/selected-direction.md and docs/design-options.md.
Merge the chosen direction (plus any user tweaks) into the final product spec.
Treat the selection as binding — do not substitute a different aesthetic.

Write docs/spec.md, docs/sprint-plan.md, docs/sprint-status.md, and update CLAUDE.md.`;

    case "full":
    default:
      return `
FULL PLAN MODE: Write docs/spec.md, docs/sprint-plan.md, docs/sprint-status.md, and update CLAUDE.md.
If a user design brief or reference assets were provided, follow them exactly — expand only where the user was silent.`;
  }
}

export async function collectDesignBriefContext(cwd = process.cwd()) {
  const sections = [];
  const designDir = path.join(cwd, "design");

  for (const name of BRIEF_MARKDOWN_FILES) {
    const filePath = path.join(designDir, name);
    const content = await readTextIfExists(filePath);
    if (content?.trim()) {
      sections.push(`### ${path.join("design", name)}\n\n${content.trim()}`);
    }
  }

  for (const legacyPath of LEGACY_BRAND_PATHS) {
    const content = await readTextIfExists(path.join(cwd, legacyPath));
    if (content?.trim()) {
      sections.push(`### ${legacyPath} (legacy brand guidelines)\n\n${content.trim()}`);
    }
  }

  const selected = await readTextIfExists(path.join(designDir, "selected-direction.md"));
  if (selected?.trim()) {
    sections.push(`### design/selected-direction.md\n\n${selected.trim()}`);
  }

  const references = await listReferenceAssets(designDir);
  if (references.length > 0) {
    sections.push(
      `### Reference assets (read/view these files)\n\n${references.map((ref) => `- ${ref}`).join("\n")}`,
    );
  }

  if (sections.length === 0) {
    return "";
  }

  return `
## User design input (authoritative — do not override)

${sections.join("\n\n")}`;
}
