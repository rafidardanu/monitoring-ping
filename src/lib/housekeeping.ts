import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { getDb } from "@/lib/db";

const execFileAsync = promisify(execFile);
const HOUSEKEEPING_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
const generatedFileMaxAgeMs = HOUSEKEEPING_INTERVAL_MS;
let lastRunAt = 0;

async function removeOldGeneratedLogs() {
  const logsDir = path.join(process.cwd(), ".next", "dev", "logs");

  if (!fs.existsSync(logsDir)) {
    return 0;
  }

  let removed = 0;
  for (const entry of fs.readdirSync(logsDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".log")) {
      continue;
    }

    const filePath = path.join(logsDir, entry.name);
    const file = fs.statSync(filePath);
    if (Date.now() - file.mtimeMs < generatedFileMaxAgeMs) {
      continue;
    }

    fs.rmSync(filePath);
    removed += 1;
  }

  return removed;
}

export async function cleanupStorageArtifacts(options: { force?: boolean } = {}) {
  if (!options.force && Date.now() - lastRunAt < HOUSEKEEPING_INTERVAL_MS) {
    return { removedLogs: 0, gitGc: false, skipped: true };
  }

  const db = getDb();
  db.pragma("wal_checkpoint(TRUNCATE)");
  const removedLogs = await removeOldGeneratedLogs();
  let gitGc = false;

  if (fs.existsSync(path.join(process.cwd(), ".git"))) {
    await execFileAsync("git", ["gc", "--prune=now"], {
      cwd: process.cwd(),
      windowsHide: true
    });
    gitGc = true;
  }

  lastRunAt = Date.now();
  return { removedLogs, gitGc, skipped: false };
}
