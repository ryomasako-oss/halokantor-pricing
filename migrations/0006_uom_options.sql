-- Trial feedback 2026-09-21 (Dinda): UOM was free-text, causing inconsistent
-- entries. A managed list any manager/admin can extend, kept as labels only
-- (no unit-conversion math) — pricing stays exactly as it is today.

CREATE TABLE IF NOT EXISTS uom_options (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO uom_options(name)
  VALUES ('Pcs'), ('Lusin'), ('Box'), ('Rim'), ('Pak'), ('Set'), ('Unit'), ('Roll');
