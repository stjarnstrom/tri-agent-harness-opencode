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

export async function isPlanningComplete(cwd = process.cwd()) {
  const hasSpec = await fileExists(path.join(cwd, "docs", "spec.md"));
  const hasSprintStatus = await fileExists(path.join(cwd, "docs", "sprint-status.md"));
  return hasSpec && hasSprintStatus;
}

export async function needsPlanning(cwd = process.cwd()) {
  return !(await isPlanningComplete(cwd));
}

export function buildPlannerModeInstructions() {
  return `
FULL PLAN MODE: Write docs/spec.md, docs/sprint-plan.md, docs/sprint-status.md, and update AGENTS.md.
If a user design brief or reference assets were provided, follow them exactly — expand only where the user was silent.`;
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
