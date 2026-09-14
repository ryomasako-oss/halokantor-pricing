import { Router } from "express";
import { z } from "zod";
import { all, get, run, tx } from "../db.js";
import { audit } from "../audit.js";
import { type AuthedRequest, requireAuth, requirePermission } from "../auth.js";
import { catalogRowSchema, zodMessage } from "../validate.js";
import type { CatalogItem } from "../../shared/types.js";

export const catalogRouter = Router();
catalogRouter.use(requireAuth);

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
  res.json({ items, total: total?.n ?? 0 });
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
    if (mode === "replace") run("DELETE FROM catalog_items");
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
    })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: zodMessage(parsed.error) });
    return;
  }
  const d = parsed.data;
  run(
    `UPDATE catalog_items SET name = ?, uom = ?, cogs = ?, list_price = ?, category = ?,
            updated_at = datetime('now') WHERE id = ?`,
    d.name, d.uom, d.cogs, d.list_price, d.category, id,
  );
  audit(req.user!.id, "catalog", id, "updated", d);
  res.json({ item: get<CatalogItem>("SELECT * FROM catalog_items WHERE id = ?", id) });
});

catalogRouter.delete("/", requirePermission("delete_catalog"), (req: AuthedRequest, res) => {
  const info = run("DELETE FROM catalog_items");
  audit(req.user!.id, "catalog", 0, "cleared", { removed: info.changes });
  res.json({ ok: true, removed: info.changes });
});
