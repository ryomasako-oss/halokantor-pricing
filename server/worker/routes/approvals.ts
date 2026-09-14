import { Hono } from "hono";
import { all } from "../../db.d1";
import { auditRecent } from "../audit";
import { requireAuth, requirePermission } from "../auth";
import type { Env } from "../env";

export const approvalsRouter = new Hono<Env>();
approvalsRouter.use(requireAuth);

approvalsRouter.get("/", async (c) => {
  const decision = c.req.query("decision") ?? "pending";
  const rows = await all<any>(
    c.env.DB,
    `SELECT a.id, a.quote_id, a.decision, a.note, a.requested_at, a.decided_at,
            a.breaches, a.monthly_value, a.net_margin,
            q.number AS quote_number, q.title AS quote_title, q.status AS quote_status,
            c.name AS client_name,
            ru.name AS requested_by_name, du.name AS decided_by_name
       FROM approvals a
       JOIN quotes q ON q.id = a.quote_id
       LEFT JOIN clients c ON c.id = q.client_id
       LEFT JOIN users ru ON ru.id = a.requested_by
       LEFT JOIN users du ON du.id = a.decided_by
      ${decision === "all" ? "" : "WHERE a.decision = ?"}
      ORDER BY a.id DESC LIMIT 200`,
    ...(decision === "all" ? [] : [decision]),
  );
  const approvals = rows.map((a) => ({ ...a, breaches: JSON.parse(a.breaches || "[]") }));
  return c.json({ approvals });
});

approvalsRouter.get("/audit", requirePermission("view_audit"), async (c) => {
  return c.json({ audit: await auditRecent(c.env.DB, 200) });
});
