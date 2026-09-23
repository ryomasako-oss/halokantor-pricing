/* ============================================================
   Sync module — pull data dari halokantor API (read-only) ke
   knowledge store lokal.

   Dijalankan sebagai CLI (npx tsx src/cli.ts sync) atau via HTTP
   endpoint di agent service.

   API yang diakses (mirrors server/routes di app utama):
   - GET  /api/clients?limit=&offset=       → daftar klien
   - GET  /api/catalog?limit=&offset=&q=&withCogs=1  → katalog dengan COGS
   - GET  /api/quotes?status=&limit=&offset= → daftar kutipan
   - GET  /api/quotes/:id                    → detail kutipan

   Auth: API key dikirim sebagai header X-API-Key (konvensi yang
   sama dengan konfigurasi app utama berjaga-jaga; jika app utama
   pakai bearer/JWT, sesuaikan header di sini).
   ============================================================ */

import { KnowledgeStore } from "./knowledge-store.js";
import { CapturedQuote, CapturedClient, CapturedCatalogItem } from "./types.js";

export interface SyncConfig {
  /** Base URL halokantor API, mis. https://pricing.salvator.co.id */
  apiBase: string;
  /** API key untuk header otorisasi. */
  apiKey: string;
  /** Jumlah item per halaman saat fetch. Menyesuaikan rate limit. */
  pageSize: number;
}

const HEADERS = (apiKey: string): Record<string, string> => ({
  "X-API-Key": apiKey,
  Accept: "application/json",
});

async function paginatedFetch<T>(url: string, headers: Record<string, string>, pageSize: number): Promise<T[]> {
  const results: T[] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const res = await fetch(`${url}&limit=${pageSize}&offset=${offset}`, { headers });
    if (!res.ok) {
      throw new Error(`Gagal fetch ${url.slice(0, 80)}: HTTP ${res.status}`);
    }
    const json = (await res.json()) as { items?: T[]; total?: number; stats?: { total: number } };
    const items: T[] = Array.isArray(json.items) ? json.items : [];
    results.push(...items);
    const total = json.total ?? json.stats?.total ?? items.length;
    hasMore = offset + items.length < total;
    offset += items.length;
    if (items.length === 0) hasMore = false;
  }

  return results;
}

function quoteFromRow(row: Record<string, unknown>): CapturedQuote {
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
    synced_at: new Date().toISOString(),
  };
}

function clientFromRow(row: Record<string, unknown>): CapturedClient {
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
    synced_at: new Date().toISOString(),
  };
}

function catalogFromRow(row: Record<string, unknown>): CapturedCatalogItem {
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
    synced_at: new Date().toISOString(),
  };
}

/**
 * Full sync: klien, katalog (dengan COGS), dan kutipan.
 * Kutipan yang sudah di-approve/ditolak lebih penting untuk
 * rekomendasi daripada draft.
 */
export async function fullSync(store: KnowledgeStore, cfg: SyncConfig): Promise<SyncReport> {
  const headers = HEADERS(cfg.apiKey);
  const base = cfg.apiBase.replace(/\/$/, "");

  let clientsSynced = 0;
  let catalogSynced = 0;
  let quotesSynced = 0;
  let errors = 0;

  // 1. Klien
  try {
    const rows = await paginatedFetch<Record<string, unknown>>(
      `${base}/api/clients`,
      headers,
      cfg.pageSize,
    );
    for (const r of rows) {
      store.upsertClient(clientFromRow(r));
      clientsSynced++;
    }
    console.log(`[sync] Klien: ${clientsSynced} baris di-sync`);
  } catch (err) {
    errors++;
    console.error("[sync] Gagal sync klien:", err);
  }

  // 2. Katalog dengan COGS (penting untuk industry detection)
  try {
    const rows = await paginatedFetch<Record<string, unknown>>(
      `${base}/api/catalog?withCogs=1`,
      headers,
      cfg.pageSize,
    );
    for (const r of rows) {
      store.upsertCatalogItem(catalogFromRow(r));
      catalogSynced++;
    }
    console.log(`[sync] Katalog (dengan COGS): ${catalogSynced} baris di-sync`);
  } catch (err) {
    errors++;
    console.error("[sync] Gagal sync katalog:", err);
  }

  // 3. Kutipan — prioritaskan status non-draft
  const statuses = ["won", "lost", "sent", "approved", "rejected", "submitted", "draft"];
  for (const status of statuses) {
    try {
      const rows = await paginatedFetch<Record<string, unknown>>(
        `${base}/api/quotes?status=${status}`,
        headers,
        cfg.pageSize,
      );
      for (const r of rows) {
        store.upsertQuote(quoteFromRow(r));
        quotesSynced++;
      }
      console.log(`[sync] Kutipan status=${status}: ${rows.length} baris di-sync`);
    } catch (err) {
      errors++;
      console.error(`[sync] Gagal sync kutipan status=${status}:`, err);
    }
  }

  // 4. Kutipan detail untuk yang belum punya items di-store
  // (sync daftar tidak selalu turunkan items lengkap; fallback ke detail)
  const existing = store.allQuotes();
  const needDetail = existing.filter((q) => {
    try {
      const items = JSON.parse(q.items);
      return !Array.isArray(items) || items.length === 0;
    } catch {
      return true;
    }
  });

  for (const q of needDetail.slice(0, 50)) {
    try {
      const res = await fetch(`${base}/api/quotes/${q.id}`, { headers });
      if (res.ok) {
        const row = (await res.json()) as Record<string, unknown>;
        store.upsertQuote(quoteFromRow(row));
        quotesSynced++;
      }
    } catch (err) {
      errors++;
      console.error(`[sync] Gagal ambil detail kutipan ${q.id}:`, err);
    }
  }

  return {
    clientsSynced,
    catalogSynced,
    quotesSynced,
    errors,
    totalQuotesInStore: store.allQuotes().length,
    totalClientsInStore: store.allClients().length,
    totalCatalogInStore: store.allCatalog().length,
  };
}

export interface SyncReport {
  clientsSynced: number;
  catalogSynced: number;
  quotesSynced: number;
  errors: number;
  totalQuotesInStore: number;
  totalClientsInStore: number;
  totalCatalogInStore: number;
}
