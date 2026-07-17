import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

export const EVENT_LOG_FILE = path.join("docs", "orchestrator-events.jsonl");

export async function logEvent(event, filePath = EVENT_LOG_FILE) {
  const entry = {
    ts: new Date().toISOString(),
    ...event,
  };

  await mkdir(path.dirname(filePath), { recursive: true });
  await appendFile(filePath, `${JSON.stringify(entry)}\n`, "utf8");
  return entry;
}
