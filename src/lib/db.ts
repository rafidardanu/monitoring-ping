import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const dataDir = path.join(process.cwd(), "data");
const dbPath = path.join(dataDir, "monitoring.db");

let database: Database.Database | null = null;

function ensureDatabase() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  if (!database) {
    database = new Database(dbPath);
    database.pragma("journal_mode = WAL");
    database.exec(`
      CREATE TABLE IF NOT EXISTS aps (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        controller TEXT NOT NULL DEFAULT 'Uncategorized',
        name TEXT NOT NULL,
        model TEXT NOT NULL DEFAULT '-',
        mac TEXT NOT NULL DEFAULT '',
        host TEXT NOT NULL UNIQUE,
        enabled INTEGER NOT NULL DEFAULT 1,
        current_status TEXT,
        current_latency_ms INTEGER,
        current_checked_at TEXT,
        current_message TEXT,
        last_logged_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS monitoring_settings (
        name TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS ap_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ap_id INTEGER NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('online', 'offline')),
        latency_ms INTEGER,
        message TEXT,
        checked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (ap_id) REFERENCES aps(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_ap_logs_ap_id_checked_at ON ap_logs (ap_id, checked_at DESC);
      CREATE INDEX IF NOT EXISTS idx_aps_enabled ON aps (enabled);
    `);

    const columns = database
      .prepare("PRAGMA table_info(aps)")
      .all() as Array<{ name: string }>;
    const existingColumns = new Set(columns.map((column) => column.name));

    if (!existingColumns.has("controller")) {
      database.exec("ALTER TABLE aps ADD COLUMN controller TEXT NOT NULL DEFAULT 'Uncategorized'");
    }

    if (!existingColumns.has("model")) {
      database.exec("ALTER TABLE aps ADD COLUMN model TEXT NOT NULL DEFAULT '-'");
    }

    if (!existingColumns.has("mac")) {
      database.exec("ALTER TABLE aps ADD COLUMN mac TEXT NOT NULL DEFAULT ''");
    }

    if (!existingColumns.has("current_status")) {
      database.exec("ALTER TABLE aps ADD COLUMN current_status TEXT");
    }

    if (!existingColumns.has("current_latency_ms")) {
      database.exec("ALTER TABLE aps ADD COLUMN current_latency_ms INTEGER");
    }

    if (!existingColumns.has("current_checked_at")) {
      database.exec("ALTER TABLE aps ADD COLUMN current_checked_at TEXT");
    }

    if (!existingColumns.has("current_message")) {
      database.exec("ALTER TABLE aps ADD COLUMN current_message TEXT");
    }

    if (!existingColumns.has("last_logged_at")) {
      database.exec("ALTER TABLE aps ADD COLUMN last_logged_at TEXT");
    }

    database
      .prepare("INSERT OR IGNORE INTO monitoring_settings (name, value) VALUES (?, ?)")
      .run("paused", "false");

    database.exec(`
      UPDATE aps
      SET
        controller = COALESCE(NULLIF(controller, ''), 'Uncategorized'),
        model = COALESCE(NULLIF(model, ''), '-'),
        mac = COALESCE(NULLIF(mac, ''), '')
    `);
  }

  return database;
}

export function getDb() {
  return ensureDatabase();
}