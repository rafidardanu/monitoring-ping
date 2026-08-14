import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getDb } from "@/lib/db";
import type { ApLogRecord, ApRecord, ApStatusSummary, SwitchRecord, SwitchStatusSummary } from "@/types";
import type { ParsedApCsvRow, ParsedSwitchCsvRow } from "@/lib/csv";


const execFileAsync = promisify(execFile);

type PingResult = {
  success: boolean;
  latencyMs: number | null;
  message: string | null;
};

export type SwitchInput = {
  building: string;
  name: string;
  host: string;
};

type MonitoringState = {
  paused: boolean;
};

const monitoringIntervalSeconds = 5;
const logIntervalMs = 5 * 60 * 1000;
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

function shouldWriteLog(lastLoggedAt: string | null | undefined, now = Date.now()) {
  if (!lastLoggedAt) {
    return true;
  }

  return now - parseSqliteTimestamp(lastLoggedAt).getTime() >= logIntervalMs;
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

export function upsertAp(input: ParsedApCsvRow, switchId: number | null = null) {
  const db = getDb();
  const ap = normalizeApInput(input);

  const existing = db
    .prepare("SELECT id FROM aps WHERE mac = ? OR host = ? LIMIT 1")
    .get(ap.mac, ap.host) as { id: number } | undefined;

  if (existing) {
    return db
      .prepare(
        `UPDATE aps
         SET controller = ?, name = ?, model = ?, mac = ?, host = ?, switch_id = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .run(ap.controller, ap.name, ap.model, ap.mac, ap.host, switchId, existing.id);
  }

  return db
    .prepare(
      `INSERT INTO aps (controller, name, model, mac, host, switch_id)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(ap.controller, ap.name, ap.model, ap.mac, ap.host, switchId);
}

export function updateAp(id: number, input: ParsedApCsvRow, switchId: number | null = null) {
  const ap = normalizeApInput(input);
  const db = getDb();
  return db
    .prepare(
      `UPDATE aps
       SET controller = ?, name = ?, model = ?, mac = ?, host = ?, switch_id = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    )
    .run(ap.controller, ap.name, ap.model, ap.mac, ap.host, switchId, id);
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

function normalizeSwitchInput(input: SwitchInput) {
  return {
    building: input.building.trim() || "Uncategorized",
    name: input.name.trim(),
    host: input.host.trim()
  };
}

export function listSwitchRecords(): SwitchRecord[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM switches ORDER BY building COLLATE NOCASE, name COLLATE NOCASE")
    .all() as SwitchRecord[];
}

export function createSwitch(input: SwitchInput) {
  const sw = normalizeSwitchInput(input);
  const db = getDb();
  return db
    .prepare(`INSERT INTO switches (building, name, host) VALUES (?, ?, ?)`)
    .run(sw.building, sw.name, sw.host);
}

export function updateSwitch(id: number, input: SwitchInput) {
  const sw = normalizeSwitchInput(input);
  const db = getDb();
  return db
    .prepare(
      `UPDATE switches SET building = ?, name = ?, host = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
    )
    .run(sw.building, sw.name, sw.host, id);
}

export function setSwitchEnabled(id: number, enabled: boolean) {
  const db = getDb();
  return db
    .prepare("UPDATE switches SET enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .run(enabled ? 1 : 0, id);
}

export function deleteSwitch(id: number) {
  const db = getDb();
  db.prepare("DELETE FROM switch_logs WHERE switch_id = ?").run(id);
  db.prepare("UPDATE aps SET switch_id = NULL WHERE switch_id = ?").run(id);
  return db.prepare("DELETE FROM switches WHERE id = ?").run(id);
}

function updateSwitchRuntimeState(
  switchId: number,
  status: "online" | "offline",
  latencyMs: number | null,
  message: string | null,
  checkedAt: string
) {
  const db = getDb();
  return db
    .prepare(
      `UPDATE switches
       SET current_status = ?, current_latency_ms = ?, current_checked_at = ?, current_message = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    )
    .run(status, latencyMs, checkedAt, message, switchId);
}

export function insertSwitchLog(
  switchId: number,
  status: "online" | "offline",
  latencyMs: number | null,
  message: string | null,
  checkedAt = formatSqliteTimestamp()
) {
  const db = getDb();
  return db
    .prepare("INSERT INTO switch_logs (switch_id, status, latency_ms, message, checked_at) VALUES (?, ?, ?, ?, ?)")
    .run(switchId, status, latencyMs, message, checkedAt);
}

export function getSwitchStatusSummary(): SwitchStatusSummary[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT
        id, building, name, host, enabled,
        COALESCE(current_status, 'unknown') AS status,
        current_latency_ms AS latencyMs,
        current_checked_at AS checkedAt,
        current_message AS message
      FROM switches
      ORDER BY building COLLATE NOCASE, name COLLATE NOCASE`
    )
    .all();

  return rows as SwitchStatusSummary[];
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

function findOngoingApIncident(apId: number) {
  const db = getDb();
  return db
    .prepare(
      `SELECT id, started_at FROM ap_logs WHERE ap_id = ? AND incident_status = 'ongoing' ORDER BY id DESC LIMIT 1`
    )
    .get(apId) as { id: number; started_at: string } | undefined;
}

function openApIncident(apId: number, latencyMs: number | null, message: string | null, checkedAt: string) {
  const db = getDb();
  db.prepare(
    `INSERT INTO ap_logs (ap_id, status, latency_ms, message, checked_at, started_at, ended_at, duration_seconds, incident_status)
     SELECT ?, 'offline', ?, ?, ?, ?, NULL, NULL, 'ongoing'
     WHERE NOT EXISTS (SELECT 1 FROM ap_logs WHERE ap_id = ? AND incident_status = 'ongoing')`
  ).run(apId, latencyMs, message, checkedAt, checkedAt, apId);
}

function touchApIncident(incidentId: number, latencyMs: number | null, message: string | null, checkedAt: string) {
  const db = getDb();
  db.prepare(`UPDATE ap_logs SET latency_ms = ?, message = ?, checked_at = ? WHERE id = ?`).run(
    latencyMs,
    message,
    checkedAt,
    incidentId
  );
}

function closeApIncident(incidentId: number, startedAt: string, endedAt: string) {
  const db = getDb();
  const durationSeconds = Math.max(
    0,
    Math.round((parseSqliteTimestamp(endedAt).getTime() - parseSqliteTimestamp(startedAt).getTime()) / 1000)
  );
  db.prepare(
    `UPDATE ap_logs SET checked_at = ?, ended_at = ?, duration_seconds = ?, incident_status = 'resolved' WHERE id = ?`
  ).run(endedAt, endedAt, durationSeconds, incidentId);
}

function findOngoingSwitchIncident(switchId: number) {
  const db = getDb();
  return db
    .prepare(
      `SELECT id, started_at FROM switch_logs WHERE switch_id = ? AND incident_status = 'ongoing' ORDER BY id DESC LIMIT 1`
    )
    .get(switchId) as { id: number; started_at: string } | undefined;
}

function openSwitchIncident(switchId: number, latencyMs: number | null, message: string | null, checkedAt: string) {
  const db = getDb();
  db.prepare(
    `INSERT INTO switch_logs (switch_id, status, latency_ms, message, checked_at, started_at, ended_at, duration_seconds, incident_status)
     SELECT ?, 'offline', ?, ?, ?, ?, NULL, NULL, 'ongoing'
     WHERE NOT EXISTS (SELECT 1 FROM switch_logs WHERE switch_id = ? AND incident_status = 'ongoing')`
  ).run(switchId, latencyMs, message, checkedAt, checkedAt, switchId);
}

function touchSwitchIncident(
  incidentId: number,
  latencyMs: number | null,
  message: string | null,
  checkedAt: string
) {
  const db = getDb();
  db.prepare(`UPDATE switch_logs SET latency_ms = ?, message = ?, checked_at = ? WHERE id = ?`).run(
    latencyMs,
    message,
    checkedAt,
    incidentId
  );
}

function closeSwitchIncident(incidentId: number, startedAt: string, endedAt: string) {
  const db = getDb();
  const durationSeconds = Math.max(
    0,
    Math.round((parseSqliteTimestamp(endedAt).getTime() - parseSqliteTimestamp(startedAt).getTime()) / 1000)
  );
  db.prepare(
    `UPDATE switch_logs SET checked_at = ?, ended_at = ?, duration_seconds = ?, incident_status = 'resolved' WHERE id = ?`
  ).run(endedAt, endedAt, durationSeconds, incidentId);
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
  db.prepare("DELETE FROM switch_logs").run();
  db.prepare("DELETE FROM aps").run();
  db.prepare("DELETE FROM switches").run();
  db.prepare("DELETE FROM sqlite_sequence WHERE name IN ('ap_logs', 'aps', 'switch_logs', 'switches')").run();
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
      a.switch_id AS switchId,
      sw.name AS switchName,
      CASE
        WHEN a.switch_id IS NULL THEN NULL
        WHEN sw.enabled != 1 THEN NULL
        ELSE COALESCE(sw.current_status, 'unknown')
      END AS switchStatus,
      COALESCE(a.current_status, l.status, 'unknown') AS status,
      COALESCE(a.current_latency_ms, l.latency_ms) AS latencyMs,
      COALESCE(a.current_checked_at, l.checked_at) AS checkedAt,
      COALESCE(a.current_message, l.message) AS message
    FROM aps a
    LEFT JOIN switches sw ON sw.id = a.switch_id
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
      l.checked_at,
      l.started_at,
      l.ended_at,
      l.duration_seconds,
      l.incident_status
    FROM ap_logs l
    INNER JOIN aps a ON a.id = l.ap_id
    ${whereClause}
    ORDER BY l.checked_at DESC, l.id DESC
  `).all(...params);

  return rows as ApLogRecord[];
}

export function getRecentSwitchLogsAsAp(limit = 50): ApLogRecord[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT
      l.id,
      l.switch_id AS ap_id,
      sw.building AS controller,
      sw.name,
      '-' AS model,
      '' AS mac,
      sw.host,
      l.status,
      l.latency_ms,
      l.message,
      l.checked_at,
      l.started_at,
      l.ended_at,
      l.duration_seconds,
      l.incident_status
    FROM switch_logs l
    INNER JOIN switches sw ON sw.id = l.switch_id
    ORDER BY l.checked_at DESC, l.id DESC
    LIMIT ?
  `).all(limit);

  return rows as ApLogRecord[];
}

export function getAllSwitchLogsAsAp(options: LogSearchOptions = {}): ApLogRecord[] {
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
    conditions.push("sw.building LIKE ? COLLATE NOCASE");
    params.push(`%${options.controller.trim()}%`);
  }

  if (options.name?.trim()) {
    conditions.push("sw.name LIKE ? COLLATE NOCASE");
    params.push(`%${options.name.trim()}%`);
  }

  if (options.host?.trim()) {
    conditions.push("sw.host LIKE ? COLLATE NOCASE");
    params.push(`%${options.host.trim()}%`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = db.prepare(`
    SELECT
      l.id,
      l.switch_id AS ap_id,
      sw.building AS controller,
      sw.name,
      '-' AS model,
      '' AS mac,
      sw.host,
      l.status,
      l.latency_ms,
      l.message,
      l.checked_at,
      l.started_at,
      l.ended_at,
      l.duration_seconds,
      l.incident_status
    FROM switch_logs l
    INNER JOIN switches sw ON sw.id = l.switch_id
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
    const switchId = resolveSwitchIdByName(row.switchName ?? "");
    const existing = db
      .prepare("SELECT id FROM aps WHERE mac = ? OR host = ? LIMIT 1")
      .get(normalized.mac, normalized.host) as { id: number } | undefined;

    if (existing) {
      db.prepare(
        `UPDATE aps
         SET controller = ?, name = ?, model = ?, mac = ?, host = ?, switch_id = COALESCE(?, switch_id), updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      ).run(
        normalized.controller,
        normalized.name,
        normalized.model,
        normalized.mac,
        normalized.host,
        switchId,
        existing.id
      );
      updated += 1;
    } else {
      db.prepare(
        `INSERT INTO aps (controller, name, model, mac, host, switch_id)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(
        normalized.controller,
        normalized.name,
        normalized.model,
        normalized.mac,
        normalized.host,
        switchId
      );
      inserted += 1;
    }
  }

  return { inserted, updated };
}

function resolveSwitchIdByName(name: string): number | null {
  const trimmed = name.trim();
  if (!trimmed) {
    return null;
  }

  const db = getDb();
  const row = db
    .prepare("SELECT id FROM switches WHERE name = ? COLLATE NOCASE LIMIT 1")
    .get(trimmed) as { id: number } | undefined;

  return row?.id ?? null;
}

export function importSwitchCsv(rows: ParsedSwitchCsvRow[]) {
  let inserted = 0;
  let updated = 0;

  for (const row of rows) {
    const db = getDb();
    const normalized = normalizeSwitchInput(row);
    const existing = db
      .prepare("SELECT id FROM switches WHERE host = ? LIMIT 1")
      .get(normalized.host) as { id: number } | undefined;

    if (existing) {
      db.prepare(
        `UPDATE switches SET building = ?, name = ?, host = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
      ).run(normalized.building, normalized.name, normalized.host, existing.id);
      updated += 1;
    } else {
      db.prepare(`INSERT INTO switches (building, name, host) VALUES (?, ?, ?)`).run(
        normalized.building,
        normalized.name,
        normalized.host
      );
      inserted += 1;
    }
  }

  return { inserted, updated };
}

async function pingAndRecordAp(ap: ApRecord, now: number) {
  const result = await pingHostWithRetry(ap.host);
  const status = result.success ? "online" : "offline";
  const checkedAt = formatSqliteTimestamp(new Date(now));
  const previousStatus = ap.current_status;

  updateApRuntimeState(ap.id, status, result.latencyMs, result.message, checkedAt);

  if (status === "offline") {
    if (previousStatus === "offline") {
      const ongoing = findOngoingApIncident(ap.id);
      if (ongoing) {
        touchApIncident(ongoing.id, result.latencyMs, result.message, checkedAt);
      } else {
        openApIncident(ap.id, result.latencyMs, result.message, checkedAt);
      }
    } else {
      openApIncident(ap.id, result.latencyMs, result.message, checkedAt);
    }
    return;
  }

  if (previousStatus === "offline") {
    const ongoing = findOngoingApIncident(ap.id);
    if (ongoing) {
      closeApIncident(ongoing.id, ongoing.started_at, checkedAt);
    }
  }

  const runtimeRow = getDb()
    .prepare("SELECT last_logged_at FROM aps WHERE id = ?")
    .get(ap.id) as { last_logged_at?: string | null } | undefined;

  if (shouldWriteLog(runtimeRow?.last_logged_at ?? null, now)) {
    insertLog(ap.id, status, result.latencyMs, result.message, checkedAt);
    getDb()
      .prepare("UPDATE aps SET last_logged_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(checkedAt, ap.id);
  }
}

async function pingAndRecordSwitch(sw: SwitchRecord, now: number) {
  const result = await pingHostWithRetry(sw.host);
  const status = result.success ? "online" : "offline";
  const checkedAt = formatSqliteTimestamp(new Date(now));
  const previousStatus = sw.current_status;

  updateSwitchRuntimeState(sw.id, status, result.latencyMs, result.message, checkedAt);

  if (status === "offline") {
    if (previousStatus === "offline") {
      const ongoing = findOngoingSwitchIncident(sw.id);
      if (ongoing) {
        touchSwitchIncident(ongoing.id, result.latencyMs, result.message, checkedAt);
      } else {
        openSwitchIncident(sw.id, result.latencyMs, result.message, checkedAt);
      }
    } else {
      openSwitchIncident(sw.id, result.latencyMs, result.message, checkedAt);
    }
    return;
  }

  if (previousStatus === "offline") {
    const ongoing = findOngoingSwitchIncident(sw.id);
    if (ongoing) {
      closeSwitchIncident(ongoing.id, ongoing.started_at, checkedAt);
    }
  }

  const runtimeRow = getDb()
    .prepare("SELECT last_logged_at FROM switches WHERE id = ?")
    .get(sw.id) as { last_logged_at?: string | null } | undefined;

  if (shouldWriteLog(runtimeRow?.last_logged_at ?? null, now)) {
    insertSwitchLog(sw.id, status, result.latencyMs, result.message, checkedAt);
    getDb()
      .prepare("UPDATE switches SET last_logged_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(checkedAt, sw.id);
  }
}

export async function runMonitoringCycle(options: { force?: boolean } = {}) {
  const state = getMonitoringState();
  if (state.paused && !options.force) {
    return 0;
  }

  const switches = listSwitchRecords().filter((sw) => sw.enabled === 1);
  const aps = listApRecords().filter((ap) => ap.enabled === 1);
  const now = Date.now();

  for (const sw of switches) {
    await pingAndRecordSwitch(sw, now);
  }

  for (const ap of aps) {
    await pingAndRecordAp(ap, now);
  }

  return aps.length + switches.length;
}

export function getMonitoringConfig() {
  return {
    ...getMonitoringState(),
    monitoringIntervalSeconds,
    dashboardRefreshSeconds
  };
}