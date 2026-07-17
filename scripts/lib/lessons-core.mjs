// Pure logic for the harness lessons ledger (harness/lessons.jsonl) and the
// rendered harness/LESSONS.md. No filesystem access — CLIs wrap this module.

export const CATEGORIES = ["a11y", "correctness", "design", "performance", "process", "lint"];
export const PHASES = ["planner", "generator", "evaluator"];
export const STATUSES = ["active", "graduated", "retired"];
export const MAX_ACTIVE_LESSONS = 25;

const ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RULE_LENGTH = 240;

function isValidSource(source) {
  return (
    source !== null &&
    typeof source === "object" &&
    typeof source.project === "string" &&
    source.project.length > 0 &&
    Number.isInteger(source.sprint) &&
    typeof source.date === "string" &&
    DATE_PATTERN.test(source.date)
  );
}

export function validateEntry(entry) {
  const problems = [];
  if (typeof entry.id !== "string" || !ID_PATTERN.test(entry.id)) {
    problems.push("id must be a kebab-case slug");
  }
  if (!CATEGORIES.includes(entry.category)) {
    problems.push(`category must be one of ${CATEGORIES.join("|")}`);
  }
  if (!PHASES.includes(entry.phase)) {
    problems.push(`phase must be one of ${PHASES.join("|")}`);
  }
  if (typeof entry.rule !== "string" || entry.rule.trim().length === 0 || entry.rule.length > MAX_RULE_LENGTH) {
    problems.push(`rule must be a non-empty string of at most ${MAX_RULE_LENGTH} chars`);
  }
  if (!Number.isInteger(entry.strikes) || entry.strikes < 1) {
    problems.push("strikes must be a positive integer");
  }
  if (!STATUSES.includes(entry.status)) {
    problems.push(`status must be one of ${STATUSES.join("|")}`);
  }
  if (!Array.isArray(entry.sources) || entry.sources.length === 0 || !entry.sources.every(isValidSource)) {
    problems.push("sources must be a non-empty array of {project, sprint, date}");
  }
  return problems;
}

export function parseLedger(text) {
  const entries = [];
  const errors = [];
  text.split("\n").forEach((line, index) => {
    if (line.trim().length === 0) return;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      errors.push(`line ${index + 1}: invalid JSON`);
      return;
    }
    const problems = validateEntry(parsed);
    if (problems.length > 0) {
      errors.push(`line ${index + 1} (${parsed.id ?? "?"}): ${problems.join("; ")}`);
      return;
    }
    entries.push(parsed);
  });
  return { entries, errors };
}

export function latestSourceDate(entry) {
  return entry.sources.map((s) => s.date).sort().at(-1) ?? "";
}

export function selectActive(entries, cap = MAX_ACTIVE_LESSONS) {
  return entries
    .filter((e) => e.status === "active")
    .sort(
      (a, b) =>
        b.strikes - a.strikes ||
        latestSourceDate(b).localeCompare(latestSourceDate(a)) ||
        a.id.localeCompare(b.id),
    )
    .slice(0, cap);
}

export function renderLessonsMd(entries) {
  const active = selectActive(entries);
  const lines = [
    "# Harness Lessons",
    "",
    "> Machine-maintained. Distilled from QA failures across runs by the",
    "> Retrospector. Source of truth: `harness/lessons.jsonl` — regenerate this",
    "> file with `node scripts/render-lessons.mjs`. Do not edit by hand.",
    "",
  ];
  if (active.length === 0) {
    lines.push("_No lessons yet. Run the harness; the Retrospector fills this in._");
    return lines.join("\n") + "\n";
  }
  for (const phase of PHASES) {
    const phaseEntries = active.filter((e) => e.phase === phase);
    if (phaseEntries.length === 0) continue;
    lines.push(`## ${phase[0].toUpperCase()}${phase.slice(1)}`, "");
    for (const e of phaseEntries) {
      const strikeLabel = e.strikes === 1 ? "1 strike" : `${e.strikes} strikes`;
      lines.push(`- **[${e.category}]** ${e.rule} *(${strikeLabel})*`);
    }
    lines.push("");
  }
  while (lines.at(-1) === "") lines.pop();
  return lines.join("\n") + "\n";
}

const STATUS_RANK = { graduated: 2, active: 1, retired: 0 };

function sourceKey(source) {
  return `${source.project}#${source.sprint}#${source.date}`;
}

// Merge a clone's ledger (incoming) into the template's (base).
// Union sources by (project, sprint, date); strikes is the max of both sides
// and the distinct source count; graduated > active > retired; the base
// (template) rule wording wins.
export function mergeLedgers(baseEntries, incomingEntries) {
  const byId = new Map(baseEntries.map((e) => [e.id, { ...e, sources: [...e.sources] }]));
  for (const incoming of incomingEntries) {
    const base = byId.get(incoming.id);
    if (!base) {
      byId.set(incoming.id, { ...incoming, sources: [...incoming.sources] });
      continue;
    }
    const seen = new Set(base.sources.map(sourceKey));
    for (const source of incoming.sources) {
      if (!seen.has(sourceKey(source))) {
        base.sources.push(source);
        seen.add(sourceKey(source));
      }
    }
    base.strikes = Math.max(base.strikes, incoming.strikes, base.sources.length);
    if (STATUS_RANK[incoming.status] > STATUS_RANK[base.status]) {
      base.status = incoming.status;
    }
  }
  return [...byId.values()];
}

export function serializeLedger(entries) {
  if (entries.length === 0) return "";
  return entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
}
