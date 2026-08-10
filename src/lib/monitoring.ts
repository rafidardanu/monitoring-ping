import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getDb } from "@/lib/db";
import type { ApLogRecord, ApRecord, ApStatusSummary } from "@/types";
import type { ParsedApCsvRow } from "@/lib/csv";

const execFileAsync = promisify(execFile);

type PingResult = {
  success: boolean;
  latencyMs: number | null;
  message: string | null;
};

type MonitoringState = {
  paused: boolean;
};

const monitoringIntervalSeconds = 5;
const logIntervalMs = 5 * 60 * 1000;
const offlineLogIntervalMs = 5 * 1000;
const dashboardRefreshSeconds = 5;
const PING_RETRY_ATTEMPTS = 4;
const PING_RETRY_DELAY_MS = 400;

function parseSqliteTimestamp(value: string) {
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  return new Date(normalized.endsWith("Z") ? normalized : `${normalized}Z`);
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatSqliteTimestamp(date = new Date()) {
  return date.toISOString().replace("T", " ").slice(0, 19);
}

function shouldWriteLog(
  status: "online" | "offline",
  lastLoggedAt: string | null | undefined,
  now = Date.now()
) {
  if (!lastLoggedAt) {
    return true;
  }

  const minInterval = status === "offline" ? offlineLogIntervalMs : logIntervalMs;
  return now - parseSqliteTimestamp(lastLoggedAt).getTime() >= minInterval;
}

function updateApRuntimeState(
  apId: number,
  status: "online" | "offline",
  latencyMs: number | null,
  message: string | null,
  checkedAt: string
) {
  const db = getDb();
  return db
    .prepare(
      `UPDATE aps
       SET current_status = ?, current_latency_ms = ?, current_checked_at = ?, current_message = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    )
    .run(status, latencyMs, checkedAt, message, apId);
}

function buildPingArgs(host: string) {
  if (process.platform === "win32") {
    return ["-n", "1", "-w", "3000", host];
  }

  return ["-c", "1", "-W", "3", host];
}

export async function pingHost(host: string): Promise<PingResult> {
  try {
    const startedAt = Date.now();
    const { stdout } = await execFileAsync("ping", buildPingArgs(host), {
      windowsHide: true
    });
    const duration = Date.now() - startedAt;
    const timeMatch = stdout.match(/time[=<]\s*(\d+(?:\.\d+)?)/i);

    if (!timeMatch) {
      return {
        success: false,
        latencyMs: null,
        message: stdout.trim().split("\n").pop()?.trim() ?? "No reply"
      };
    }

    const latency = Math.round(Number(timeMatch[1]));

    return {
      success: true,
      latencyMs: Number.isFinite(latency) ? latency : duration,
      message: null
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ping failed";
    return {
      success: false,
      latencyMs: null,
      message
    };
  }
}

async function pingHostWithRetry(host: string): Promise<PingResult> {
  let lastResult: PingResult | null = null;

  for (let attempt = 1; attempt <= PING_RETRY_ATTEMPTS; attempt += 1) {
    const result = await pingHost(host);

    if (result.success) {
      return result;
    }

    lastResult = result;

    if (attempt < PING_RETRY_ATTEMPTS) {
      await delay(PING_RETRY_DELAY_MS);
    }
  }

  return lastResult!;
}

export function listApRecords(): ApRecord[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM aps ORDER BY controller COLLATE NOCASE, name COLLATE NOCASE")
    .all() as ApRecord[];
}

function normalizeApInput(input: ParsedApCsvRow) {
  return {
    controller: input.controller.trim() || "Uncategorized",
    name: input.name.trim(),
    model: input.model.trim() || "-",
    mac: input.mac.trim(),
    host: input.host.trim()
  };
}

export function upsertAp(input: ParsedApCsvRow) {
  const db = getDb();
  const ap = normalizeApInput(input);

  const existing = db
    .prepare("SELECT id FROM aps WHERE mac = ? OR host = ? LIMIT 1")
    .get(ap.mac, ap.host) as { id: number } | undefined;

  if (existing) {
    return db
      .prepare(
        `UPDATE aps
         SET controller = ?, name = ?, model = ?, mac = ?, host = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .run(ap.controller, ap.name, ap.model, ap.mac, ap.host, existing.id);
  }

  return db
    .prepare(
      `INSERT INTO aps (controller, name, model, mac, host)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(ap.controller, ap.name, ap.model, ap.mac, ap.host);
}

export function updateAp(id: number, input: ParsedApCsvRow) {
  const ap = normalizeApInput(input);
  const db = getDb();
  return db
    .prepare(
      `UPDATE aps
       SET controller = ?, name = ?, model = ?, mac = ?, host = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    )
    .run(ap.controller, ap.name, ap.model, ap.mac, ap.host, id);
}

export function setApEnabled(id: number, enabled: boolean) {
  const db = getDb();
  return db
    .prepare("UPDATE aps SET enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .run(enabled ? 1 : 0, id);
}

export function deleteAp(id: number) {
  const db = getDb();
  db.prepare("DELETE FROM ap_logs WHERE ap_id = ?").run(id);
  return db.prepare("DELETE FROM aps WHERE id = ?").run(id);
}

export function insertLog(
  apId: number,
  status: "online" | "offline",
  latencyMs: number | null,
  message: string | null,
  checkedAt = formatSqliteTimestamp()
) {
  const db = getDb();
  return db
    .prepare("INSERT INTO ap_logs (ap_id, status, latency_ms, message, checked_at) VALUES (?, ?, ?, ?, ?)")
    .run(apId, status, latencyMs, message, checkedAt);
}

export function getMonitoringState(): MonitoringState {
  const db = getDb();
  const row = db
    .prepare("SELECT value FROM monitoring_settings WHERE name = ?")
    .get("paused") as { value?: string } | undefined;

  return {
    paused: row?.value === "true"
  };
}

export function setMonitoringPaused(paused: boolean) {
  const db = getDb();
  return db
    .prepare("INSERT INTO monitoring_settings (name, value) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value")
    .run("paused", paused ? "true" : "false");
}

export function resetMonitoringData() {
  const db = getDb();
  db.prepare("DELETE FROM ap_logs").run();
  db.prepare("DELETE FROM aps").run();
  db.prepare("DELETE FROM sqlite_sequence WHERE name IN ('ap_logs', 'aps')").run();
  return db.prepare("UPDATE monitoring_settings SET value = ? WHERE name = ?").run("false", "paused");
}

export function getStatusSummary(): ApStatusSummary[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT
      a.id,
      a.controller,
      a.name,
      a.model,
      a.mac,
      a.host,
      a.enabled,
      COALESCE(a.current_status, l.status, 'unknown') AS status,
      COALESCE(a.current_latency_ms, l.latency_ms) AS latencyMs,
      COALESCE(a.current_checked_at, l.checked_at) AS checkedAt,
      COALESCE(a.current_message, l.message) AS message
    FROM aps a
    LEFT JOIN ap_logs l ON l.id = (
      SELECT id FROM ap_logs
      WHERE ap_id = a.id
      ORDER BY checked_at DESC, id DESC
      LIMIT 1
    )
    ORDER BY a.id DESC
  `).all();

  return rows as ApStatusSummary[];
}

export function getRecentLogs(limit = 50): ApLogRecord[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT
      l.id,
      l.ap_id,
      a.controller,
      a.name,
      a.model,
      a.mac,
      a.host,
      l.status,
      l.latency_ms,
      l.message,
      l.checked_at
    FROM ap_logs l
    INNER JOIN aps a ON a.id = l.ap_id
    ORDER BY l.checked_at DESC, l.id DESC
    LIMIT ?
  `).all(limit);

  return rows as ApLogRecord[];
}

type LogSearchOptions = {
  from?: string;
  to?: string;
  controller?: string;
  name?: string;
  host?: string;
};

function toSqliteTimestamp(value: string) {
  return new Date(value).toISOString().replace("T", " ").slice(0, 19);
}

export function getAllLogs(options: LogSearchOptions = {}): ApLogRecord[] {
  const db = getDb();
  const conditions: string[] = [];
  const params: Array<string> = [];

  if (options.from?.trim()) {
    conditions.push("l.checked_at >= ?");
    params.push(toSqliteTimestamp(options.from.trim()));
  }

  if (options.to?.trim()) {
    conditions.push("l.checked_at <= ?");
    params.push(toSqliteTimestamp(options.to.trim()));
  }

  if (options.controller?.trim()) {
    conditions.push("a.controller LIKE ? COLLATE NOCASE");
    params.push(`%${options.controller.trim()}%`);
  }

  if (options.name?.trim()) {
    conditions.push("a.name LIKE ? COLLATE NOCASE");
    params.push(`%${options.name.trim()}%`);
  }

  if (options.host?.trim()) {
    conditions.push("a.host LIKE ? COLLATE NOCASE");
    params.push(`%${options.host.trim()}%`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = db.prepare(`
    SELECT
      l.id,
      l.ap_id,
      a.controller,
      a.name,
      a.model,
      a.mac,
      a.host,
      l.status,
      l.latency_ms,
      l.message,
      l.checked_at
    FROM ap_logs l
    INNER JOIN aps a ON a.id = l.ap_id
    ${whereClause}
    ORDER BY l.checked_at DESC, l.id DESC
  `).all(...params);

  return rows as ApLogRecord[];
}

export function importApCsv(rows: ParsedApCsvRow[]) {
  let inserted = 0;
  let updated = 0;

  for (const row of rows) {
    const db = getDb();
    const normalized = normalizeApInput(row);
    const existing = db
      .prepare("SELECT id FROM aps WHERE mac = ? OR host = ? LIMIT 1")
      .get(normalized.mac, normalized.host) as { id: number } | undefined;

    if (existing) {
      db.prepare(
        `UPDATE aps
         SET controller = ?, name = ?, model = ?, mac = ?, host = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      ).run(
        normalized.controller,
        normalized.name,
        normalized.model,
        normalized.mac,
        normalized.host,
        existing.id
      );
      updated += 1;
    } else {
      db.prepare(
        `INSERT INTO aps (controller, name, model, mac, host)
         VALUES (?, ?, ?, ?, ?)`
      ).run(
        normalized.controller,
        normalized.name,
        normalized.model,
        normalized.mac,
        normalized.host
      );
      inserted += 1;
    }
  }

  return { inserted, updated };
}

export async function runMonitoringCycle(options: { force?: boolean } = {}) {
  const state = getMonitoringState();
  if (state.paused && !options.force) {
    return 0;
  }

  const aps = listApRecords().filter((ap) => ap.enabled === 1);
  const now = Date.now();

  for (const ap of aps) {
    const result = await pingHostWithRetry(ap.host);
    const status = result.success ? "online" : "offline";
    const checkedAt = formatSqliteTimestamp(new Date(now));

    updateApRuntimeState(ap.id, status, result.latencyMs, result.message, checkedAt);

    const runtimeRow = getDb()
      .prepare("SELECT last_logged_at FROM aps WHERE id = ?")
      .get(ap.id) as { last_logged_at?: string | null } | undefined;

    if (shouldWriteLog(status, runtimeRow?.last_logged_at ?? null, now)) {
      insertLog(ap.id, status, result.latencyMs, result.message, checkedAt);
      getDb()
        .prepare("UPDATE aps SET last_logged_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .run(checkedAt, ap.id);
    }
  }

  return aps.length;
}

export function getMonitoringConfig() {
  return {
    ...getMonitoringState(),
    monitoringIntervalSeconds,
    dashboardRefreshSeconds
  };
}