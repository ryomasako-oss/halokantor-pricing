import { Router } from "express";
import { z } from "zod";
import { all, get, run, tx } from "../db.js";
import { audit } from "../audit.js";
import { type AuthedRequest, requireAuth, requirePermission } from "../auth.js";
import { catalogRowSchema, unitsSchema, zodMessage } from "../validate.js";
import { cleanUnits, type ItemUnits } from "../../shared/uom.js";
import type { CatalogItem, UnitFactor } from "../../shared/types.js";

export const catalogRouter = Router();
catalogRouter.use(requireAuth);

/** Extra units per code, for the given codes. */
function unitsByCode(codes: string[]): Map<string, UnitFactor[]> {
  const map = new Map<string, UnitFactor[]>();
  if (!codes.length) return map;
  const rows = all<{ code: string; uom: string; factor: number }>(
    `SELECT code, uom, factor FROM catalog_item_uoms
      WHERE code IN (${codes.map(() => "?").join(",")}) ORDER BY factor`,
    ...codes,
  );
  for (const r of rows) {
    if (!map.has(r.code)) map.set(r.code, []);
    map.get(r.code)!.push({ uom: r.uom, factor: r.factor });
  }
  return map;
}

/** Replaces one item's extra units. Call inside a transaction. */
function replaceUnits(code: string, baseUom: string | undefined, units: UnitFactor[]) {
  run("DELETE FROM catalog_item_uoms WHERE code = ?", code);
  for (const u of cleanUnits(baseUom, units)) {
    run("INSERT INTO catalog_item_uoms(code, uom, factor) VALUES(?, ?, ?)", code, u.uom, u.factor);
  }
}

catalogRouter.get("/", (req, res) => {
  const q = String(req.query.q ?? "").trim();
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
  const offset = Math.max(0, Number(req.query.offset) || 0);
  const withCogs = String(req.query.withCogs ?? "") === "1";

  const where: string[] = [];
  const params: (string | number)[] = [];
  if (q) {
    where.push("(name LIKE ? OR code LIKE ?)");
    params.push(`%${q}%`, `%${q}%`);
  }
  if (withCogs) where.push("cogs > 0");
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const sortColumns: Record<string, string> = {
    name: "name",
    code: "code",
    stock: "stock",
    cogs: "cogs",
    list_price: "list_price",
  };
  const sortField = sortColumns[String(req.query.sortBy ?? "")] ?? "name";
  const sortDir = String(req.query.sortDir ?? "").toLowerCase() === "desc" ? "DESC" : "ASC";
  const orderBy = sortField === "name" ? "name" : `${sortField} ${sortDir}, name`;

  const total = get<{ n: number }>(`SELECT COUNT(*) AS n FROM catalog_items ${clause}`, ...params);
  const items = all<CatalogItem>(
    `SELECT * FROM catalog_items ${clause} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
    ...params,
    limit,
    offset,
  );
  const units = unitsByCode(items.map((i) => i.code));
  res.json({ items: items.map((i) => ({ ...i, units: units.get(i.code) ?? [] })), total: total?.n ?? 0 });
});

/**
 * Base unit + extra units for the codes on a quote, so the editor can convert
 * COGS/RRP when a line's unit changes. Codes not in the catalog are omitted.
 */
catalogRouter.post("/units", (req, res) => {
  const parsed = z.object({ codes: z.array(z.string().trim().min(1).max(64)).max(2000) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: zodMessage(parsed.error) });
    return;
  }
  const codes = [...new Set(parsed.data.codes)];
  const out: Record<string, ItemUnits> = {};
  // SQLite caps bound parameters per statement; chunk like the Worker does.
  for (let i = 0; i < codes.length; i += 500) {
    const chunk = codes.slice(i, i + 500);
    const bases = all<{ code: string; uom: string }>(
      `SELECT code, uom FROM catalog_items WHERE code IN (${chunk.map(() => "?").join(",")})`,
      ...chunk,
    );
    const units = unitsByCode(bases.map((b) => b.code));
    for (const b of bases) out[b.code] = { baseUom: b.uom, units: units.get(b.code) ?? [] };
  }
  res.json({ units: out });
});

/** Managed UOM list — any manager/admin can extend it. Per-item ratios live in catalog_item_uoms. */
catalogRouter.get("/uom", (_req, res) => {
  res.json({ options: all<{ id: number; name: string }>("SELECT id, name FROM uom_options ORDER BY name") });
});

catalogRouter.post("/uom", requirePermission("edit_catalog"), (req: AuthedRequest, res) => {
  const parsed = z.object({ name: z.string().trim().min(1).max(32) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: zodMessage(parsed.error) });
    return;
  }
  const existing = get<{ id: number }>("SELECT id FROM uom_options WHERE name = ?", parsed.data.name);
  if (existing) {
    res.status(409).json({ error: "Satuan ini sudah ada." });
    return;
  }
  const info = run("INSERT INTO uom_options(name) VALUES(?)", parsed.data.name);
  audit(req.user!.id, "catalog", 0, "uom_added", { name: parsed.data.name });
  res.status(201).json({ option: { id: Number(info.lastInsertRowid), name: parsed.data.name } });
});

catalogRouter.get("/stats", (_req, res) => {
  const stats = get<{ total: number; priced: number; withList: number; updated: string | null }>(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN cogs > 0 THEN 1 ELSE 0 END) AS priced,
            SUM(CASE WHEN list_price > 0 THEN 1 ELSE 0 END) AS withList,
            MAX(updated_at) AS updated
       FROM catalog_items`,
  );
  res.json({ stats });
});

/**
 * Bulk upsert from a parsed spreadsheet. The client does the XLSX parsing and
 * posts plain rows, so the server never handles uploaded binaries.
 * Zero-valued fields never overwrite an existing non-zero value.
 */
catalogRouter.post("/import", requirePermission("import_catalog"), (req: AuthedRequest, res) => {
  const parsed = z
    .object({
      rows: z.array(catalogRowSchema).min(1).max(20000),
      source: z.string().max(200).default("import"),
      mode: z.enum(["merge", "replace"]).default("merge"),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: zodMessage(parsed.error) });
    return;
  }
  const { rows, source, mode } = parsed.data;

  const result = tx(() => {
    if (mode === "replace") {
      run("DELETE FROM catalog_items");
      run("DELETE FROM catalog_item_uoms");
    }
    let inserted = 0;
    let updated = 0;
    for (const r of rows) {
      const code = r.code.trim();
      if (!code) continue;
      const existing = get<CatalogItem>("SELECT * FROM catalog_items WHERE code = ?", code);
      if (existing) {
        run(
          `UPDATE catalog_items
              SET name = ?, uom = ?, cogs = ?, list_price = ?, stock = ?, category = ?,
                  source = ?, updated_at = datetime('now')
            WHERE code = ?`,
          r.name || existing.name,
          r.uom || existing.uom,
          r.cogs && r.cogs > 0 ? r.cogs : existing.cogs,
          r.list_price && r.list_price > 0 ? r.list_price : existing.list_price,
          r.stock ?? existing.stock,
          r.category || existing.category,
          source,
          code,
        );
        if (r.units) replaceUnits(code, r.uom || existing.uom, r.units);
        updated++;
      } else {
        run(
          `INSERT INTO catalog_items(code, name, uom, cogs, list_price, stock, category, source)
           VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
          code,
          r.name,
          r.uom || "Pcs",
          r.cogs ?? 0,
          r.list_price ?? 0,
          r.stock ?? 0,
          r.category ?? "",
          source,
        );
        if (r.units) replaceUnits(code, r.uom || "Pcs", r.units);
        inserted++;
      }
    }
    return { inserted, updated };
  });

  audit(req.user!.id, "catalog", 0, "imported", { ...result, source, mode, rows: rows.length });
  res.json({ ...result, total: rows.length });
});

catalogRouter.put("/:id", requirePermission("edit_catalog"), (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const parsed = z
    .object({
      name: z.string().min(1).max(300),
      uom: z.string().max(32),
      cogs: z.number().min(0),
      list_price: z.number().min(0),
      category: z.string().max(120).default(""),
      units: unitsSchema.optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: zodMessage(parsed.error) });
    return;
  }
  const d = parsed.data;
  tx(() => {
    run(
      `UPDATE catalog_items SET name = ?, uom = ?, cogs = ?, list_price = ?, category = ?,
              updated_at = datetime('now') WHERE id = ?`,
      d.name, d.uom, d.cogs, d.list_price, d.category, id,
    );
    const code = get<{ code: string }>("SELECT code FROM catalog_items WHERE id = ?", id)?.code;
    if (code && d.units) replaceUnits(code, d.uom, d.units);
  });
  audit(req.user!.id, "catalog", id, "updated", d);
  const item = get<CatalogItem>("SELECT * FROM catalog_items WHERE id = ?", id);
  res.json({ item: item && { ...item, units: unitsByCode([item.code]).get(item.code) ?? [] } });
});

catalogRouter.delete("/", requirePermission("delete_catalog"), (req: AuthedRequest, res) => {
  const info = tx(() => {
    run("DELETE FROM catalog_item_uoms");
    return run("DELETE FROM catalog_items");
  });
  audit(req.user!.id, "catalog", 0, "cleared", { removed: info.changes });
  res.json({ ok: true, removed: info.changes });
});
