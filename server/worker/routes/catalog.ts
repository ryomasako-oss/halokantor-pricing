import { Hono } from "hono";
import { z } from "zod";
import { all, get, run, stmt, batch } from "../../db.d1";
import { audit } from "../audit";
import { requireAuth, requirePermission } from "../auth";
import { catalogRowSchema, unitsSchema, zodMessage } from "../../validate";
import { cleanUnits, type ItemUnits } from "../../../shared/uom";
import type { CatalogItem, UnitFactor } from "../../../shared/types";
import type { Env } from "../env";

export const catalogRouter = new Hono<Env>();
catalogRouter.use(requireAuth);

const CHUNK = 90;
function chunks<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Extra units per code, for the given codes. */
async function unitsByCode(db: D1Database, codes: string[]): Promise<Map<string, UnitFactor[]>> {
  const map = new Map<string, UnitFactor[]>();
  for (const chunk of chunks(codes, CHUNK)) {
    const rows = await all<{ code: string; uom: string; factor: number }>(
      db,
      `SELECT code, uom, factor FROM catalog_item_uoms
        WHERE code IN (${chunk.map(() => "?").join(",")}) ORDER BY factor`,
      ...chunk,
    );
    for (const r of rows) {
      if (!map.has(r.code)) map.set(r.code, []);
      map.get(r.code)!.push({ uom: r.uom, factor: r.factor });
    }
  }
  return map;
}

/** Statements that replace one item's extra units, for inclusion in a batch. */
function replaceUnitsStmts(db: D1Database, code: string, baseUom: string | undefined, units: UnitFactor[]) {
  return [
    stmt(db, "DELETE FROM catalog_item_uoms WHERE code = ?", code),
    ...cleanUnits(baseUom, units).map((u) =>
      stmt(db, "INSERT INTO catalog_item_uoms(code, uom, factor) VALUES(?, ?, ?)", code, u.uom, u.factor),
    ),
  ];
}

catalogRouter.get("/", async (c) => {
  const q = c.req.query("q")?.trim() ?? "";
  const limit = Math.min(500, Math.max(1, Number(c.req.query("limit")) || 100));
  const offset = Math.max(0, Number(c.req.query("offset")) || 0);
  const withCogs = c.req.query("withCogs") === "1";

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
  const sortField = sortColumns[c.req.query("sortBy") ?? ""] ?? "name";
  const sortDir = (c.req.query("sortDir") ?? "").toLowerCase() === "desc" ? "DESC" : "ASC";
  const orderBy = sortField === "name" ? "name" : `${sortField} ${sortDir}, name`;

  const total = await get<{ n: number }>(c.env.DB, `SELECT COUNT(*) AS n FROM catalog_items ${clause}`, ...params);
  const items = await all<CatalogItem>(
    c.env.DB,
    `SELECT * FROM catalog_items ${clause} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
    ...params,
    limit,
    offset,
  );
  const units = await unitsByCode(c.env.DB, items.map((i) => i.code));
  return c.json({ items: items.map((i) => ({ ...i, units: units.get(i.code) ?? [] })), total: total?.n ?? 0 });
});

/**
 * Base unit + extra units for the codes on a quote, so the editor can convert
 * COGS/RRP when a line's unit changes. Codes not in the catalog are omitted.
 */
catalogRouter.post("/units", async (c) => {
  const parsed = z
    .object({ codes: z.array(z.string().trim().min(1).max(64)).max(2000) })
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: zodMessage(parsed.error) }, 400);
  const codes = [...new Set(parsed.data.codes)];
  const out: Record<string, ItemUnits> = {};
  for (const chunk of chunks(codes, CHUNK)) {
    const bases = await all<{ code: string; uom: string }>(
      c.env.DB,
      `SELECT code, uom FROM catalog_items WHERE code IN (${chunk.map(() => "?").join(",")})`,
      ...chunk,
    );
    const units = await unitsByCode(c.env.DB, bases.map((b) => b.code));
    for (const b of bases) out[b.code] = { baseUom: b.uom, units: units.get(b.code) ?? [] };
  }
  return c.json({ units: out });
});

/** Managed UOM list — any manager/admin can extend it. Per-item ratios live in catalog_item_uoms. */
catalogRouter.get("/uom", async (c) => {
  const options = await all<{ id: number; name: string }>(c.env.DB, "SELECT id, name FROM uom_options ORDER BY name");
  return c.json({ options });
});

catalogRouter.post("/uom", requirePermission("edit_catalog"), async (c) => {
  const user = c.get("user")!;
  const parsed = z
    .object({ name: z.string().trim().min(1).max(32) })
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: zodMessage(parsed.error) }, 400);

  const existing = await get<{ id: number }>(c.env.DB, "SELECT id FROM uom_options WHERE name = ?", parsed.data.name);
  if (existing) return c.json({ error: "Satuan ini sudah ada." }, 409);

  const info = await run(c.env.DB, "INSERT INTO uom_options(name) VALUES(?)", parsed.data.name);
  await audit(c.env.DB, user.id, "catalog", 0, "uom_added", { name: parsed.data.name });
  return c.json({ option: { id: Number(info.meta.last_row_id), name: parsed.data.name } }, 201);
});

catalogRouter.get("/stats", async (c) => {
  const stats = await get<{ total: number; priced: number; withList: number; updated: string | null }>(
    c.env.DB,
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN cogs > 0 THEN 1 ELSE 0 END) AS priced,
            SUM(CASE WHEN list_price > 0 THEN 1 ELSE 0 END) AS withList,
            MAX(updated_at) AS updated
       FROM catalog_items`,
  );
  return c.json({ stats });
});

/**
 * Bulk upsert from a parsed spreadsheet. The client does the XLSX parsing and
 * posts plain rows, so the server never handles uploaded binaries.
 * Zero-valued fields never overwrite an existing non-zero value.
 *
 * D1 has no interactive transactions (only atomic batch() of pre-bound
 * writes), so this can't do the Node version's per-row
 * read-then-decide-then-write. Instead every row becomes a single
 * INSERT ... ON CONFLICT DO UPDATE statement that encodes the same
 * "zero/empty never overwrites" fallback logic in SQL, and to still
 * report accurate inserted/updated counts, existing codes are read
 * once up front (not interleaved with the writes).
 */
catalogRouter.post("/import", requirePermission("import_catalog"), async (c) => {
  const user = c.get("user")!;
  const parsed = z
    .object({
      rows: z.array(catalogRowSchema).min(1).max(20000),
      source: z.string().max(200).default("import"),
      mode: z.enum(["merge", "replace"]).default("merge"),
    })
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: zodMessage(parsed.error) }, 400);
  const { rows, source, mode } = parsed.data;

  if (mode === "replace") {
    await batch(c.env.DB, [
      stmt(c.env.DB, "DELETE FROM catalog_item_uoms"),
      stmt(c.env.DB, "DELETE FROM catalog_items"),
    ]);
  }

  const codes = [...new Set(rows.map((r) => r.code.trim()).filter(Boolean))];
  // code -> current base unit, so units can be cleaned against it when a
  // row doesn't send its own uom (same as the Express twin).
  const existing = new Map<string, string>();
  if (mode === "merge") {
    for (const chunk of chunks(codes, CHUNK)) {
      const placeholders = chunk.map(() => "?").join(",");
      const found = await all<{ code: string; uom: string }>(
        c.env.DB,
        `SELECT code, uom FROM catalog_items WHERE code IN (${placeholders})`,
        ...chunk,
      );
      for (const f of found) existing.set(f.code, f.uom);
    }
  }

  const UPSERT = `
    INSERT INTO catalog_items(code, name, uom, cogs, list_price, stock, category, source)
    VALUES (
      ?1, ?2, COALESCE(NULLIF(?3, ''), 'Pcs'), ?4, ?5, COALESCE(?6, 0), ?7, ?8
    )
    ON CONFLICT(code) DO UPDATE SET
      name = ?2,
      uom = CASE WHEN ?3 != '' THEN ?3 ELSE catalog_items.uom END,
      cogs = CASE WHEN ?4 > 0 THEN ?4 ELSE catalog_items.cogs END,
      list_price = CASE WHEN ?5 > 0 THEN ?5 ELSE catalog_items.list_price END,
      stock = COALESCE(?6, catalog_items.stock),
      category = CASE WHEN ?7 != '' THEN ?7 ELSE catalog_items.category END,
      source = ?8,
      updated_at = datetime('now')`;

  let inserted = 0;
  let updated = 0;
  const validRows = rows.filter((r) => r.code.trim());
  for (const chunk of chunks(validRows, CHUNK)) {
    const statements = chunk.flatMap((r) => {
      const code = r.code.trim();
      if (mode === "replace" || !existing.has(code)) inserted++;
      else updated++;
      return [
        stmt(
          c.env.DB,
          UPSERT,
          code,
          r.name,
          r.uom ?? "",
          r.cogs ?? 0,
          r.list_price ?? 0,
          r.stock ?? null,
          r.category ?? "",
          source,
        ),
        ...(r.units
          ? replaceUnitsStmts(c.env.DB, code, r.uom || existing.get(code) || "Pcs", r.units)
          : []),
      ];
    });
    await batch(c.env.DB, statements);
  }

  const result = { inserted, updated };
  await audit(c.env.DB, user.id, "catalog", 0, "imported", { ...result, source, mode, rows: rows.length });
  return c.json({ ...result, total: rows.length });
});

catalogRouter.put("/:id", requirePermission("edit_catalog"), async (c) => {
  const user = c.get("user")!;
  const id = Number(c.req.param("id"));
  const parsed = z
    .object({
      name: z.string().min(1).max(300),
      uom: z.string().max(32),
      cogs: z.number().min(0),
      list_price: z.number().min(0),
      category: z.string().max(120).default(""),
      units: unitsSchema.optional(),
    })
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: zodMessage(parsed.error) }, 400);
  const d = parsed.data;
  const code = (await get<{ code: string }>(c.env.DB, "SELECT code FROM catalog_items WHERE id = ?", id))?.code;
  await batch(c.env.DB, [
    stmt(
      c.env.DB,
      `UPDATE catalog_items SET name = ?, uom = ?, cogs = ?, list_price = ?, category = ?,
              updated_at = datetime('now') WHERE id = ?`,
      d.name, d.uom, d.cogs, d.list_price, d.category, id,
    ),
    ...(code && d.units ? replaceUnitsStmts(c.env.DB, code, d.uom, d.units) : []),
  ]);
  await audit(c.env.DB, user.id, "catalog", id, "updated", d);
  const item = await get<CatalogItem>(c.env.DB, "SELECT * FROM catalog_items WHERE id = ?", id);
  const units = item ? (await unitsByCode(c.env.DB, [item.code])).get(item.code) ?? [] : [];
  return c.json({ item: item && { ...item, units } });
});

catalogRouter.delete("/", requirePermission("delete_catalog"), async (c) => {
  const user = c.get("user")!;
  const [, info] = await batch(c.env.DB, [
    stmt(c.env.DB, "DELETE FROM catalog_item_uoms"),
    stmt(c.env.DB, "DELETE FROM catalog_items"),
  ]);
  await audit(c.env.DB, user.id, "catalog", 0, "cleared", { removed: info.meta.changes });
  return c.json({ ok: true, removed: info.meta.changes });
});
