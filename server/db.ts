/* ============================================================
   SQLite persistence, on Node's built-in driver (no native build).
   Schema is created and migrated on boot; every statement is
   prepared through the small helpers at the bottom of the file.
   ============================================================ */

import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

const dbPath = process.env.DATABASE_PATH || "./data/halokantor.db";
fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });

export const db = new DatabaseSync(path.resolve(dbPath));

db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");
db.exec("PRAGMA busy_timeout = 5000");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'rep',
  active        INTEGER NOT NULL DEFAULT 1,
  phone         TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS clients (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL,
  code            TEXT NOT NULL DEFAULT '',
  address         TEXT NOT NULL DEFAULT '',
  contact_name    TEXT NOT NULL DEFAULT '',
  contact_email   TEXT NOT NULL DEFAULT '',
  contact_phone   TEXT NOT NULL DEFAULT '',
  payment_terms   TEXT NOT NULL DEFAULT '30 hari setelah invoice',
  delivery_terms  TEXT NOT NULL DEFAULT 'Franco Jakarta, jadwal mingguan',
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS catalog_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  uom         TEXT NOT NULL DEFAULT 'Pcs',
  cogs        REAL NOT NULL DEFAULT 0,
  list_price  REAL NOT NULL DEFAULT 0,
  stock       REAL NOT NULL DEFAULT 0,
  category    TEXT NOT NULL DEFAULT '',
  source      TEXT NOT NULL DEFAULT '',
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_catalog_name ON catalog_items(name);

CREATE TABLE IF NOT EXISTS quotes (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  number         TEXT NOT NULL UNIQUE,
  title          TEXT NOT NULL DEFAULT '',
  client_id      INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  status         TEXT NOT NULL DEFAULT 'draft',
  scenario       INTEGER NOT NULL DEFAULT 1,
  rev_no         INTEGER NOT NULL DEFAULT 1,
  version        INTEGER NOT NULL DEFAULT 1,
  assigned_to    INTEGER REFERENCES users(id),
  restore_count  INTEGER NOT NULL DEFAULT 0,
  assumptions    TEXT NOT NULL,
  items          TEXT NOT NULL,
  regions        TEXT NOT NULL,
  meta           TEXT NOT NULL,
  created_by     INTEGER NOT NULL REFERENCES users(id),
  approved_by    INTEGER REFERENCES users(id),
  approved_at    TEXT,
  decision_note  TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_quotes_status ON quotes(status);
CREATE INDEX IF NOT EXISTS idx_quotes_client ON quotes(client_id);
CREATE INDEX IF NOT EXISTS idx_quotes_created_by ON quotes(created_by);

CREATE TABLE IF NOT EXISTS quote_revisions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  quote_id    INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  rev_no      INTEGER NOT NULL,
  snapshot    TEXT NOT NULL,
  note        TEXT NOT NULL DEFAULT '',
  created_by  INTEGER NOT NULL REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_rev_quote ON quote_revisions(quote_id);

CREATE TABLE IF NOT EXISTS approvals (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  quote_id       INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  requested_by   INTEGER NOT NULL REFERENCES users(id),
  requested_at   TEXT NOT NULL DEFAULT (datetime('now')),
  decided_by     INTEGER REFERENCES users(id),
  decided_at     TEXT,
  decision       TEXT NOT NULL DEFAULT 'pending',
  note           TEXT,
  breaches       TEXT NOT NULL DEFAULT '[]',
  monthly_value  REAL NOT NULL DEFAULT 0,
  net_margin     REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_appr_decision ON approvals(decision);
CREATE INDEX IF NOT EXISTS idx_appr_quote_decision ON approvals(quote_id, decision);

CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id    INTEGER REFERENCES users(id),
  entity      TEXT NOT NULL,
  entity_id   INTEGER NOT NULL DEFAULT 0,
  action      TEXT NOT NULL,
  detail      TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity, entity_id);

CREATE TABLE IF NOT EXISTS settings (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS password_reset_requests (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  email       TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pwreset_email ON password_reset_requests(email);

CREATE TABLE IF NOT EXISTS uom_options (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO uom_options(name)
  VALUES ('Pcs'), ('Lusin'), ('Box'), ('Rim'), ('Pak'), ('Set'), ('Unit'), ('Roll');

-- Mirrors migrations/0007_catalog_item_uoms.sql.
CREATE TABLE IF NOT EXISTS catalog_item_uoms (
  code   TEXT NOT NULL,
  uom    TEXT NOT NULL COLLATE NOCASE,
  factor REAL NOT NULL CHECK (factor > 0),
  PRIMARY KEY (code, uom)
);
`);

// The CREATE TABLE above only adds `version` for a fresh database; migrate
// an existing dev database in place (mirrors migrations/0002_consistency.sql).
try {
  db.exec("ALTER TABLE quotes ADD COLUMN version INTEGER NOT NULL DEFAULT 1");
} catch (err) {
  if (!(err instanceof Error) || !err.message.includes("duplicate column name")) throw err;
}
try {
  db.exec("ALTER TABLE users ADD COLUMN phone TEXT NOT NULL DEFAULT ''");
} catch (err) {
  if (!(err instanceof Error) || !err.message.includes("duplicate column name")) throw err;
}
try {
  db.exec("ALTER TABLE quotes ADD COLUMN assigned_to INTEGER REFERENCES users(id)");
} catch (err) {
  if (!(err instanceof Error) || !err.message.includes("duplicate column name")) throw err;
}
try {
  db.exec("ALTER TABLE quotes ADD COLUMN restore_count INTEGER NOT NULL DEFAULT 0");
} catch (err) {
  if (!(err instanceof Error) || !err.message.includes("duplicate column name")) throw err;
}
db.exec("CREATE INDEX IF NOT EXISTS idx_quotes_assigned_to ON quotes(assigned_to)");

/* ---------------- typed query helpers ---------------- */

type Param = string | number | null | bigint | Uint8Array;

export function all<T = Record<string, unknown>>(sql: string, ...params: Param[]): T[] {
  return db.prepare(sql).all(...params) as T[];
}

export function get<T = Record<string, unknown>>(sql: string, ...params: Param[]): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined;
}

export function run(sql: string, ...params: Param[]) {
  return db.prepare(sql).run(...params);
}

/** Runs fn inside a transaction, rolling back on any throw. */
export function tx<T>(fn: () => T): T {
  db.exec("BEGIN");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export function getSetting<T>(key: string, fallback: T): T {
  const row = get<{ value: string }>("SELECT value FROM settings WHERE key = ?", key);
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}

export function setSetting(key: string, value: unknown): void {
  run(
    "INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    key,
    JSON.stringify(value),
  );
}
