import { Hono } from "hono";
import { all, get, run } from "../../db.d1";
import { audit } from "../audit";
import { requireAuth, requireRole } from "../auth";
import { clientSchema, zodMessage } from "../../validate";
import type { Client } from "../../../shared/types";
import type { Env } from "../env";

export const clientsRouter = new Hono<Env>();
clientsRouter.use(requireAuth);

clientsRouter.get("/", async (c) => {
  const clients = await all<Client>(
    c.env.DB,
    `SELECT c.*, (SELECT COUNT(*) FROM quotes q WHERE q.client_id = c.id) AS quote_count
       FROM clients c ORDER BY c.name`,
  );
  return c.json({ clients });
});

clientsRouter.post("/", async (c) => {
  const user = c.get("user")!;
  const parsed = clientSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: zodMessage(parsed.error) }, 400);
  const d = parsed.data;
  const info = await run(
    c.env.DB,
    `INSERT INTO clients(name, code, address, contact_name, contact_email, contact_phone,
                         payment_terms, delivery_terms)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
    d.name, d.code, d.address, d.contact_name, d.contact_email, d.contact_phone,
    d.payment_terms, d.delivery_terms,
  );
  const id = Number(info.meta.last_row_id);
  await audit(c.env.DB, user.id, "client", id, "created", { name: d.name });
  const client = await get<Client>(c.env.DB, "SELECT * FROM clients WHERE id = ?", id);
  return c.json({ client }, 201);
});

clientsRouter.put("/:id", async (c) => {
  const user = c.get("user")!;
  const id = Number(c.req.param("id"));
  const parsed = clientSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: zodMessage(parsed.error) }, 400);
  if (!(await get(c.env.DB, "SELECT id FROM clients WHERE id = ?", id))) {
    return c.json({ error: "Klien tidak ditemukan." }, 404);
  }
  const d = parsed.data;
  await run(
    c.env.DB,
    `UPDATE clients SET name = ?, code = ?, address = ?, contact_name = ?, contact_email = ?,
            contact_phone = ?, payment_terms = ?, delivery_terms = ? WHERE id = ?`,
    d.name, d.code, d.address, d.contact_name, d.contact_email, d.contact_phone,
    d.payment_terms, d.delivery_terms, id,
  );
  await audit(c.env.DB, user.id, "client", id, "updated", { name: d.name });
  const client = await get<Client>(c.env.DB, "SELECT * FROM clients WHERE id = ?", id);
  return c.json({ client });
});

clientsRouter.delete("/:id", requireRole("manager"), async (c) => {
  const user = c.get("user")!;
  const id = Number(c.req.param("id"));
  const used = await get<{ n: number }>(c.env.DB, "SELECT COUNT(*) AS n FROM quotes WHERE client_id = ?", id);
  if (used && used.n > 0) {
    return c.json(
      { error: `Klien ini masih dipakai ${used.n} quotation. Hapus atau pindahkan quotation itu dulu.` },
      409,
    );
  }
  await run(c.env.DB, "DELETE FROM clients WHERE id = ?", id);
  await audit(c.env.DB, user.id, "client", id, "deleted");
  return c.json({ ok: true });
});
