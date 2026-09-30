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

      CREATE TABLE IF NOT EXISTS switches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        building TEXT NOT NULL DEFAULT 'Uncategorized',
        name TEXT NOT NULL,
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

      CREATE TABLE IF NOT EXISTS switch_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        switch_id INTEGER NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('online', 'offline')),
        latency_ms INTEGER,
        message TEXT,
        checked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (switch_id) REFERENCES switches(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_ap_logs_ap_id_checked_at ON ap_logs (ap_id, checked_at DESC);
      CREATE INDEX IF NOT EXISTS idx_aps_enabled ON aps (enabled);
      CREATE INDEX IF NOT EXISTS idx_switch_logs_switch_id_checked_at ON switch_logs (switch_id, checked_at DESC);
      CREATE INDEX IF NOT EXISTS idx_switches_enabled ON switches (enabled);
      CREATE INDEX IF NOT EXISTS idx_ap_logs_checked_at ON ap_logs (checked_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS idx_switch_logs_checked_at ON switch_logs (checked_at DESC, id DESC);
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

    if (!existingColumns.has("switch_id")) {
      database.exec("ALTER TABLE aps ADD COLUMN switch_id INTEGER REFERENCES switches(id)");
      database.exec("CREATE INDEX IF NOT EXISTS idx_aps_switch_id ON aps (switch_id)");
    }

    const apLogColumns = database
      .prepare("PRAGMA table_info(ap_logs)")
      .all() as Array<{ name: string }>;
    const existingApLogColumns = new Set(apLogColumns.map((column) => column.name));

    if (!existingApLogColumns.has("started_at")) {
      database.exec("ALTER TABLE ap_logs ADD COLUMN started_at TEXT");
    }
    if (!existingApLogColumns.has("ended_at")) {
      database.exec("ALTER TABLE ap_logs ADD COLUMN ended_at TEXT");
    }
    if (!existingApLogColumns.has("duration_seconds")) {
      database.exec("ALTER TABLE ap_logs ADD COLUMN duration_seconds INTEGER");
    }
    if (!existingApLogColumns.has("incident_status")) {
      database.exec("ALTER TABLE ap_logs ADD COLUMN incident_status TEXT");
    }
    database.exec(
      "CREATE INDEX IF NOT EXISTS idx_ap_logs_ap_id_incident_status ON ap_logs (ap_id, incident_status)"
    );

    const switchLogColumns = database
      .prepare("PRAGMA table_info(switch_logs)")
      .all() as Array<{ name: string }>;
    const existingSwitchLogColumns = new Set(switchLogColumns.map((column) => column.name));

    if (!existingSwitchLogColumns.has("started_at")) {
      database.exec("ALTER TABLE switch_logs ADD COLUMN started_at TEXT");
    }
    if (!existingSwitchLogColumns.has("ended_at")) {
      database.exec("ALTER TABLE switch_logs ADD COLUMN ended_at TEXT");
    }
    if (!existingSwitchLogColumns.has("duration_seconds")) {
      database.exec("ALTER TABLE switch_logs ADD COLUMN duration_seconds INTEGER");
    }
    if (!existingSwitchLogColumns.has("incident_status")) {
      database.exec("ALTER TABLE switch_logs ADD COLUMN incident_status TEXT");
    }
    database.exec(
      "CREATE INDEX IF NOT EXISTS idx_switch_logs_switch_id_incident_status ON switch_logs (switch_id, incident_status)"
    );

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