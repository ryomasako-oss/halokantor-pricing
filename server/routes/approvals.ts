import { Router } from "express";
import { all } from "../db.js";
import { auditRecent } from "../audit.js";
import { requireAuth, requirePermission } from "../auth.js";

export const approvalsRouter = Router();
approvalsRouter.use(requireAuth);

approvalsRouter.get("/", requirePermission("decide_quotes"), (req, res) => {
  const decision = String(req.query.decision ?? "pending");
  const rows = all(
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
  ).map((a: any) => ({ ...a, breaches: JSON.parse(a.breaches || "[]") }));
  res.json({ approvals: rows });
});

approvalsRouter.get("/audit", requirePermission("view_audit"), (_req, res) => {
  res.json({ audit: auditRecent(200) });
});
