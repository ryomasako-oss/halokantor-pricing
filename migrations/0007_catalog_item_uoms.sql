-- 2026-09-26 (Ryoma): COGS/RRP must follow the unit chosen on a quote line
-- (1 Box = 24 Pcs -> COGS x24). This reverses 0006's "labels only" scope.
-- Ratios are per item, because a Box of pens and a Box of clips hold
-- different amounts. They mirror Accurate's Satuan #2-#5 / Rasio columns.
-- `factor` = how many base units (catalog_items.uom) are in one `uom`.
-- Keyed by code, not id, so imports can upsert without an id lookup. There
-- is no FK, so catalog replace/clear deletes from here explicitly.

CREATE TABLE IF NOT EXISTS catalog_item_uoms (
  code   TEXT NOT NULL,
  uom    TEXT NOT NULL COLLATE NOCASE,
  factor REAL NOT NULL CHECK (factor > 0),
  PRIMARY KEY (code, uom)
);
