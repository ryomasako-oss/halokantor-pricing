-- D1 schema migration, mirrors server/db.ts (Node/sqlite version).
-- PRAGMA journal_mode / busy_timeout are meaningless on D1 and are omitted;
-- D1 enforces foreign keys by default.

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'rep',
  active        INTEGER NOT NULL DEFAULT 1,
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
