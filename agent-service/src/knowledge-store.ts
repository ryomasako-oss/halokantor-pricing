/* ============================================================
   Knowledge store SQLite lokal — menggunakan node:sqlite (built-in
   Node 22+). Pola: prepare → bind(params) → run()/all()/get().
   ============================================================ */

import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";
import { CapturedQuote, CapturedClient, CapturedCatalogItem, IndustryProfile, Recommendation, IndustryTag } from "./types.js";

const AGENT_DB_MIGRATIONS = `
CREATE TABLE IF NOT EXISTS captured_quotes (
  id              INTEGER PRIMARY KEY,
  number          TEXT NOT NULL UNIQUE,
  title           TEXT NOT NULL DEFAULT '',
  client_id       INTEGER,
  client_name     TEXT,
  status          TEXT NOT NULL DEFAULT 'draft',
  scenario        INTEGER NOT NULL DEFAULT 1,
  rev_no          INTEGER NOT NULL DEFAULT 1,
  assumptions     TEXT NOT NULL DEFAULT '{}',
  items           TEXT NOT NULL DEFAULT '[]',
  regions         TEXT NOT NULL DEFAULT '[]',
  meta            TEXT NOT NULL DEFAULT '{}',
  created_by      INTEGER,
  created_by_name TEXT,
  approved_by     INTEGER,
  approved_by_name TEXT,
  approved_at     TEXT,
  decision_note   TEXT,
  created_at      TEXT,
  updated_at      TEXT,
  synced_at       TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (client_id) REFERENCES captured_clients(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_cq_status    ON captured_quotes(status);
CREATE INDEX IF NOT EXISTS idx_cq_client    ON captured_quotes(client_id);
CREATE INDEX IF NOT EXISTS idx_cq_synced    ON captured_quotes(synced_at);

CREATE TABLE IF NOT EXISTS captured_clients (
  id              INTEGER PRIMARY KEY,
  name            TEXT NOT NULL,
  code            TEXT NOT NULL DEFAULT '',
  address         TEXT NOT NULL DEFAULT '',
  contact_name    TEXT NOT NULL DEFAULT '',
  contact_email   TEXT NOT NULL DEFAULT '',
  contact_phone   TEXT NOT NULL DEFAULT '',
  payment_terms   TEXT NOT NULL DEFAULT '',
  delivery_terms  TEXT NOT NULL DEFAULT '',
  created_at      TEXT NOT NULL DEFAULT '',
  synced_at       TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (id)
);

CREATE TABLE IF NOT EXISTS captured_catalog (
  id          INTEGER PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  uom         TEXT NOT NULL DEFAULT 'Pcs',
  cogs        REAL NOT NULL DEFAULT 0,
  list_price  REAL NOT NULL DEFAULT 0,
  stock       REAL NOT NULL DEFAULT 0,
  category    TEXT NOT NULL DEFAULT '',
  source      TEXT NOT NULL DEFAULT '',
  updated_at  TEXT NOT NULL DEFAULT '',
  synced_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cc_category ON captured_catalog(category);
CREATE INDEX IF NOT EXISTS idx_cc_name     ON captured_catalog(name);

CREATE TABLE IF NOT EXISTS industry_profiles (
  quote_id       INTEGER PRIMARY KEY,
  tags           TEXT NOT NULL DEFAULT '[]',
  tag_shares     TEXT NOT NULL DEFAULT '{}',
  preferred_scenario INTEGER,
  avg_margin     REAL,
  avg_monthly_value REAL,
  computed_at    TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (quote_id) REFERENCES captured_quotes(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS recommendations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  target_client TEXT NOT NULL,
  similar_quote_id INTEGER NOT NULL,
  reasons       TEXT NOT NULL DEFAULT '[]',
  similar_scenario INTEGER,
  similar_margin REAL,
  suggested_value REAL,
  confidence    REAL NOT NULL DEFAULT 0,
  generated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (similar_quote_id) REFERENCES captured_quotes(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_rec_target  ON recommendations(target_client);
`;

function parseJSON<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

export class KnowledgeStore {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
    this.db = new DatabaseSync(path.resolve(dbPath));
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec(AGENT_DB_MIGRATIONS);
  }

  // ---- captured_quotes ----

  upsertQuote(q: CapturedQuote): void {
    this.db.prepare(`
      INSERT INTO captured_quotes(id, number, title, client_id, client_name, status, scenario, rev_no,
        assumptions, items, regions, meta, created_by, created_by_name, approved_by, approved_by_name,
        approved_at, decision_note, created_at, updated_at, synced_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        title=excluded.title, client_name=excluded.client_name, status=excluded.status,
        scenario=excluded.scenario, rev_no=excluded.rev_no, assumptions=excluded.assumptions,
        items=excluded.items, regions=excluded.regions, meta=excluded.meta,
        approved_by=excluded.approved_by, approved_by_name=excluded.approved_by_name,
        approved_at=excluded.approved_at, decision_note=excluded.decision_note,
        updated_at=excluded.updated_at, synced_at=datetime('now')
    `).run(q.id, q.number, q.title, q.client_id, q.client_name, q.status, q.scenario, q.rev_no,
      q.assumptions, q.items, q.regions, q.meta, q.created_by, q.created_by_name,
      q.approved_by, q.approved_by_name, q.approved_at, q.decision_note,
      q.created_at, q.updated_at);
  }

  allQuotes(): CapturedQuote[] {
    const rows = this.db.prepare("SELECT * FROM captured_quotes ORDER BY updated_at DESC").all() as Array<Record<string, unknown>>;
    return rows.map(this.rowToQuote);
  }

  quotesByStatus(status: string): CapturedQuote[] {
    const rows = this.db.prepare("SELECT * FROM captured_quotes WHERE status = ? ORDER BY updated_at DESC").all(status) as Array<Record<string, unknown>>;
    return rows.map(this.rowToQuote);
  }

  quotesByClient(clientId: number): CapturedQuote[] {
    const rows = this.db.prepare("SELECT * FROM captured_quotes WHERE client_id = ? ORDER BY updated_at DESC").all(clientId) as Array<Record<string, unknown>>;
    return rows.map(this.rowToQuote);
  }

  quoteById(id: number): CapturedQuote | undefined {
    const row = this.db.prepare("SELECT * FROM captured_quotes WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? this.rowToQuote(row) : undefined;
  }

  private rowToQuote(row: Record<string, unknown>): CapturedQuote {
    return {
      id: row.id as number,
      number: row.number as string,
      title: row.title as string,
      client_id: row.client_id as number | null,
      client_name: row.client_name as string | null,
      status: row.status as string,
      scenario: row.scenario as number,
      rev_no: row.rev_no as number,
      assumptions: row.assumptions as string,
      items: row.items as string,
      regions: row.regions as string,
      meta: row.meta as string,
      created_by: row.created_by as number,
      created_by_name: row.created_by_name as string,
      approved_by: row.approved_by as number | null,
      approved_by_name: row.approved_by_name as string | null,
      approved_at: row.approved_at as string | null,
      decision_note: row.decision_note as string | null,
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
      synced_at: row.synced_at as string,
    };
  }

  // ---- captured_clients ----

  upsertClient(c: CapturedClient): void {
    this.db.prepare(`
      INSERT INTO captured_clients(id, name, code, address, contact_name, contact_email, contact_phone,
        payment_terms, delivery_terms, created_at, synced_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        name=excluded.name, contact_email=excluded.contact_email, contact_phone=excluded.contact_phone,
        synced_at=datetime('now')
    `).run(c.id, c.name, c.code, c.address, c.contact_name, c.contact_email, c.contact_phone,
      c.payment_terms, c.delivery_terms, c.created_at);
  }

  allClients(): CapturedClient[] {
    const rows = this.db.prepare("SELECT * FROM captured_clients ORDER BY name").all() as Array<Record<string, unknown>>;
    return rows.map(this.rowToClient);
  }

  clientById(id: number): CapturedClient | undefined {
    const row = this.db.prepare("SELECT * FROM captured_clients WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? this.rowToClient(row) : undefined;
  }

  private rowToClient(row: Record<string, unknown>): CapturedClient {
    return {
      id: row.id as number,
      name: row.name as string,
      code: row.code as string,
      address: row.address as string,
      contact_name: row.contact_name as string,
      contact_email: row.contact_email as string,
      contact_phone: row.contact_phone as string,
      payment_terms: row.payment_terms as string,
      delivery_terms: row.delivery_terms as string,
      created_at: row.created_at as string,
      synced_at: row.synced_at as string,
    };
  }

  // ---- captured_catalog ----

  upsertCatalogItem(c: CapturedCatalogItem): void {
    this.db.prepare(`
      INSERT INTO captured_catalog(id, code, name, uom, cogs, list_price, stock, category, source, updated_at, synced_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        name=excluded.name, cogs=excluded.cogs, list_price=excluded.list_price, stock=excluded.stock,
        category=excluded.category, synced_at=datetime('now')
    `).run(c.id, c.code, c.name, c.uom, c.cogs, c.list_price, c.stock, c.category, c.source, c.updated_at);
  }

  allCatalog(): CapturedCatalogItem[] {
    const rows = this.db.prepare("SELECT * FROM captured_catalog ORDER BY name").all() as Array<Record<string, unknown>>;
    return rows.map(this.rowToCatalog);
  }

  catalogByCategory(category: string): CapturedCatalogItem[] {
    const rows = this.db.prepare("SELECT * FROM captured_catalog WHERE category = ? ORDER BY name").all(category) as Array<Record<string, unknown>>;
    return rows.map(this.rowToCatalog);
  }

  private rowToCatalog(row: Record<string, unknown>): CapturedCatalogItem {
    return {
      id: row.id as number,
      code: row.code as string,
      name: row.name as string,
      uom: row.uom as string,
      cogs: row.cogs as number,
      list_price: row.list_price as number,
      stock: row.stock as number,
      category: row.category as string,
      source: row.source as string,
      updated_at: row.updated_at as string,
      synced_at: row.synced_at as string,
    };
  }

  // ---- industry_profiles ----

  setIndustryProfile(quoteId: number, profile: IndustryProfile): void {
    this.db.prepare(`
      INSERT INTO industry_profiles(quote_id, tags, tag_shares, preferred_scenario, avg_margin, avg_monthly_value, computed_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(quote_id) DO UPDATE SET
        tags=excluded.tags, tag_shares=excluded.tag_shares, preferred_scenario=excluded.preferred_scenario,
        avg_margin=excluded.avg_margin, avg_monthly_value=excluded.avg_monthly_value, computed_at=datetime('now')
    `).run(quoteId,
      JSON.stringify(profile.tags),
      JSON.stringify(profile.tagShares),
      profile.preferredScenario,
      profile.avgMargin,
      profile.avgMonthlyValue);
  }

  profileForQuote(quoteId: number): IndustryProfile | undefined {
    const row = this.db.prepare("SELECT * FROM industry_profiles WHERE quote_id = ?").get(quoteId) as
      | { tags: string; tag_shares: string; preferred_scenario: number | null; avg_margin: number | null; avg_monthly_value: number | null; computed_at: string }
      | undefined;
    if (!row) return undefined;
    return {
      tags: parseJSON<IndustryTag[]>(row.tags, []),
      tagShares: parseJSON<Record<string, number>>(row.tag_shares, {}),
      preferredScenario: row.preferred_scenario,
      avgMargin: row.avg_margin,
      avgMonthlyValue: row.avg_monthly_value,
    };
  }

  // ---- recommendations ----

  saveRecommendation(r: Recommendation): number {
    const stmt = this.db.prepare(`
      INSERT INTO recommendations(target_client, similar_quote_id, reasons, similar_scenario, similar_margin, suggested_value, confidence, generated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `);
    const result = stmt.run(r.clientName, r.similarQuote.id, JSON.stringify(r.reasons),
      r.similarScenario, r.similarMargin, r.suggestedMonthlyValue, r.confidence);
    return result.lastInsertRowid as number;
  }

  recommendationsForClient(clientName: string): Recommendation[] {
    const rows = this.db.prepare(
      `SELECT r.*, q.number, q.title, q.client_name
       FROM recommendations r
       JOIN captured_quotes q ON q.id = r.similar_quote_id
       WHERE r.target_client = ?
       ORDER BY r.generated_at DESC`,
    ).all(clientName) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      clientName: r.target_client as string,
      similarQuote: { id: r.similar_quote_id as number, number: r.number as string, client_name: r.client_name as string },
      reasons: parseJSON<string[]>(r.reasons as string, []),
      similarScenario: r.similar_scenario as number | null,
      similarMargin: r.similar_margin as number | null,
      suggestedMonthlyValue: r.suggested_value as number | null,
      confidence: r.confidence as number,
    }));
  }

  clearRecommendations(clientName: string): void {
    this.db.prepare("DELETE FROM recommendations WHERE target_client = ?").run(clientName);
  }

  close(): void {
    this.db.close();
  }
}
