import { Router } from "express";
import { all, get, run } from "../db.js";
import { audit } from "../audit.js";
import { type AuthedRequest, requireAuth, requirePermission } from "../auth.js";
import { clientSchema, zodMessage } from "../validate.js";
import type { Client } from "../../shared/types.js";

export const clientsRouter = Router();
clientsRouter.use(requireAuth);

clientsRouter.get("/", (_req, res) => {
  res.json({
    clients: all<Client>(
      `SELECT c.*, (SELECT COUNT(*) FROM quotes q WHERE q.client_id = c.id) AS quote_count
         FROM clients c ORDER BY c.name`,
    ),
  });
});

clientsRouter.post("/", (req: AuthedRequest, res) => {
  const parsed = clientSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: zodMessage(parsed.error) });
    return;
  }
  const d = parsed.data;
  const info = run(
    `INSERT INTO clients(name, code, address, contact_name, contact_email, contact_phone,
                         payment_terms, delivery_terms)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
    d.name, d.code, d.address, d.contact_name, d.contact_email, d.contact_phone,
    d.payment_terms, d.delivery_terms,
  );
  const id = Number(info.lastInsertRowid);
  audit(req.user!.id, "client", id, "created", { name: d.name });
  res.status(201).json({ client: get<Client>("SELECT * FROM clients WHERE id = ?", id) });
});

clientsRouter.put("/:id", (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const parsed = clientSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: zodMessage(parsed.error) });
    return;
  }
  if (!get("SELECT id FROM clients WHERE id = ?", id)) {
    res.status(404).json({ error: "Klien tidak ditemukan." });
    return;
  }
  const d = parsed.data;
  run(
    `UPDATE clients SET name = ?, code = ?, address = ?, contact_name = ?, contact_email = ?,
            contact_phone = ?, payment_terms = ?, delivery_terms = ? WHERE id = ?`,
    d.name, d.code, d.address, d.contact_name, d.contact_email, d.contact_phone,
    d.payment_terms, d.delivery_terms, id,
  );
  audit(req.user!.id, "client", id, "updated", { name: d.name });
  res.json({ client: get<Client>("SELECT * FROM clients WHERE id = ?", id) });
});

clientsRouter.delete("/:id", requirePermission("delete_clients"), (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const used = get<{ n: number }>(
    "SELECT COUNT(*) AS n FROM quotes WHERE client_id = ?",
    id,
  );
  if (used && used.n > 0) {
    res.status(409).json({
      error: `Klien ini masih dipakai ${used.n} quotation. Hapus atau pindahkan quotation itu dulu.`,
    });
    return;
  }
  run("DELETE FROM clients WHERE id = ?", id);
  audit(req.user!.id, "client", id, "deleted");
  res.json({ ok: true });
});
