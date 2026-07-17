import { access, mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Write a file atomically: write to a temp sibling, then rename over the
 * target. A crash mid-write leaves the previous file intact instead of a
 * truncated/corrupt one.
 */
export async function writeFileAtomic(filePath, contents) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(tmpPath, contents, "utf8");
    await rename(tmpPath, filePath);
  } catch (error) {
    await rm(tmpPath, { force: true }).catch(() => {});
    throw error;
  }
}
