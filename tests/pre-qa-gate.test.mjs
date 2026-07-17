import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { chmod, copyFile, mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

const CONTRACT_WITH_CHECKLIST = [
  "# Sprint 1 Contract",
  "",
  "## Scope",
  "Build the thing.",
  "",
  "## Generator self-evaluation",
  "- [x] All acceptance criteria implemented",
  "- [x] Lints pass",
  "",
].join("\n");

const CONTRACT_WITHOUT_CHECKLIST = [
  "# Sprint 1 Contract",
  "",
  "## Generator self-evaluation",
  "Looks good to me.",
  "",
  "## Next section",
  "",
].join("\n");

async function makeGateProject({ contract, gitleaksExit, sprint = 1 } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), "pre-qa-gate-"));
  await mkdir(path.join(dir, "scripts"), { recursive: true });
  await mkdir(path.join(dir, "docs"), { recursive: true });
  await copyFile(
    path.join(ROOT, "scripts", "pre-qa-gate.sh"),
    path.join(dir, "scripts", "pre-qa-gate.sh"),
  );
  const rows = [];
  for (let i = 1; i <= sprint; i += 1) {
    rows.push(`| ${i} | Sprint ${i} | ${i === sprint ? "Ready for QA" : "Pass"} | |`);
  }
  await writeFile(
    path.join(dir, "docs", "sprint-status.md"),
    [
      "# Sprint Status",
      "",
      "| Sprint | Title | Status | Notes |",
      "| --- | --- | --- | --- |",
      ...rows,
      "",
    ].join("\n"),
  );
  if (contract !== undefined) {
    await writeFile(path.join(dir, "docs", `sprint-${sprint}-contract.md`), contract);
  }

  let env = process.env;
  if (gitleaksExit !== undefined) {
    // The gitleaks block only runs inside a git repo with gitleaks on PATH.
    await execFileAsync("git", ["init", "-q"], { cwd: dir });
    const stubDir = path.join(dir, "stub-bin");
    await mkdir(stubDir);
    const stubPath = path.join(stubDir, "gitleaks");
    await writeFile(stubPath, `#!/bin/sh\nexit ${gitleaksExit}\n`);
    await chmod(stubPath, 0o755);
    env = { ...process.env, PATH: `${stubDir}:${process.env.PATH}` };
  }
  return { dir, env };
}

async function runGate({ dir, env }, sprint = 1) {
  try {
    const { stdout } = await execFileAsync(
      "bash",
      [path.join(dir, "scripts", "pre-qa-gate.sh"), String(sprint)],
      { cwd: dir, env },
    );
    return { code: 0, stdout };
  } catch (error) {
    if (typeof error.code === "number") {
      return { code: error.code, stdout: error.stdout ?? "" };
    }
    throw error;
  }
}

test("gate passes when self-evaluation checklist is present", async () => {
  const project = await makeGateProject({ contract: CONTRACT_WITH_CHECKLIST });
  const result = await runGate(project);
  assert.equal(result.code, 0, `gate failed:\n${result.stdout}`);
});

test("gate fails when self-evaluation has no checklist items", async () => {
  const project = await makeGateProject({ contract: CONTRACT_WITHOUT_CHECKLIST });
  const result = await runGate(project);
  assert.equal(result.code, 1);
  assert.match(result.stdout, /missing checklist items/);
});

test("gate fails when gitleaks reports a leak in staged changes", async () => {
  const project = await makeGateProject({
    contract: CONTRACT_WITH_CHECKLIST,
    gitleaksExit: 1,
  });
  const result = await runGate(project);
  assert.equal(result.code, 1, `expected secret failure:\n${result.stdout}`);
  assert.match(result.stdout, /[Ss]ecret/);
});

test("gate passes when gitleaks finds nothing", async () => {
  const project = await makeGateProject({
    contract: CONTRACT_WITH_CHECKLIST,
    gitleaksExit: 0,
  });
  const result = await runGate(project);
  assert.equal(result.code, 0, `gate failed:\n${result.stdout}`);
});

test("gate warns but passes when no app source is found on sprint 1", async () => {
  const project = await makeGateProject({ contract: CONTRACT_WITH_CHECKLIST });
  const result = await runGate(project);
  assert.equal(result.code, 0, `gate failed:\n${result.stdout}`);
  assert.match(result.stdout, /No application product detected/);
  assert.match(result.stdout, /sprint 2/i);
});

test("gate fails from sprint 2 on when no app product is found under app/", async () => {
  const project = await makeGateProject({
    contract: CONTRACT_WITH_CHECKLIST,
    sprint: 2,
  });
  const result = await runGate(project, 2);
  assert.equal(result.code, 1, `expected app-source failure:\n${result.stdout}`);
  assert.match(result.stdout, /No application product/);
  assert.match(result.stdout, /app\/package\.json/);
});

test("gate passes from sprint 2 when app/package.json and app/src exist", async () => {
  const project = await makeGateProject({
    contract: CONTRACT_WITH_CHECKLIST,
    sprint: 2,
  });
  const appDir = path.join(project.dir, "app");
  await mkdir(path.join(appDir, "src"), { recursive: true });
  await writeFile(
    path.join(appDir, "package.json"),
    JSON.stringify(
      {
        name: "product",
        scripts: {
          "test:e2e": "node -e \"process.exit(0)\"",
        },
      },
      null,
      2,
    ),
  );
  await writeFile(path.join(appDir, "src", "main.ts"), "export {};\n");
  const result = await runGate(project, 2);
  assert.equal(result.code, 0, `gate failed:\n${result.stdout}`);
});
