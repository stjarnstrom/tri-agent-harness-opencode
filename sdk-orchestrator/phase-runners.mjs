import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { getModelForPhase } from "./policy.mjs";

async function loadMcpConfig(cwd) {
  try {
    const raw = await readFile(path.join(cwd, ".mcp.json"), "utf8");
    const parsed = JSON.parse(raw);
    return parsed.mcpServers ?? null;
  } catch {
    return null;
  }
}

function runCliAgent({ prompt, model, cwd, approveMcps }) {
  return new Promise((resolve, reject) => {
    const args = [
      "agent",
      "-p",
      "--force",
      "--workspace",
      cwd,
      "--model",
      model,
    ];

    if (approveMcps) {
      args.push("--approve-mcps");
    }

    args.push(prompt);

    const child = spawn("cursor", args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      process.stdout.write(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      process.stderr.write(chunk);
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve({
          status: "finished",
          runner: "cli",
          result: stdout,
        });
        return;
      }

      reject(
        new Error(
          `cursor agent exited with code ${code}${stderr ? `: ${stderr.trim()}` : ""}`,
        ),
      );
    });
  });
}

async function runSdkAgent({ prompt, model, cwd, mcpServers }) {
  const { Agent, CursorAgentError } = await import("@cursor/sdk");

  const apiKey = process.env.CURSOR_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "CURSOR_API_KEY is required for SDK runner. Set it or use HARNESS_RUNNER=cli.",
    );
  }

  const options = {
    apiKey,
    model: { id: model },
    local: { cwd, settingSources: [] },
  };

  if (mcpServers) {
    options.mcpServers = mcpServers;
  }

  try {
    const result = await Agent.prompt(prompt, options);
    return {
      status: result.status,
      runner: "sdk",
      agentId: result.agentId ?? null,
      runId: result.id ?? null,
      result: result.result ?? null,
    };
  } catch (error) {
    if (error instanceof CursorAgentError) {
      throw new Error(`SDK startup failed: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Try each runner in order until one succeeds. A runner "fails" both when it
 * throws AND when it soft-fails by resolving with status "error" — either way
 * the next runner gets a chance. When every runner fails, the thrown error
 * aggregates each runner's message so the primary failure isn't lost.
 */
export async function runWithFallback({ runners, attempt, phase, warn = console.warn }) {
  const failures = [];

  for (const runner of runners) {
    try {
      const outcome = await attempt(runner);
      if (outcome?.status === "error") {
        throw new Error(`runner returned status 'error'`);
      }
      return outcome;
    } catch (error) {
      failures.push(`${runner}: ${error.message}`);
      if (runner !== runners[runners.length - 1]) {
        warn(`Runner '${runner}' failed, trying fallback: ${error.message}`);
      }
    }
  }

  throw new Error(`All runners failed for ${phase} — ${failures.join("; ")}`);
}

export async function runPhase({ phase, prompt, policy, cwd = process.cwd() }) {
  const model = getModelForPhase(policy, phase);
  const mcpServers = await loadMcpConfig(cwd);
  const startedAt = Date.now();

  console.log(`▶ Running ${phase} (model: ${model}, runner: ${policy.runtime.runner})`);

  const runners = policy.runtime.runner === "cli" ? ["cli", "sdk"] : ["sdk", "cli"];

  const outcome = await runWithFallback({
    runners,
    phase,
    attempt: (runner) =>
      runner === "sdk"
        ? runSdkAgent({ prompt, model, cwd, mcpServers })
        : runCliAgent({
            prompt,
            model,
            cwd,
            approveMcps: policy.runtime.approveMcps,
          }),
  });

  return {
    ...outcome,
    phase,
    model,
    durationMs: Date.now() - startedAt,
    startedAt: new Date(startedAt).toISOString(),
    endedAt: new Date().toISOString(),
  };
}
