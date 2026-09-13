/* Append-only record of who changed what. Never updated or deleted. */

import { all, run } from "../db.d1";
import type { AuditEntry } from "../../shared/types";

export async function audit(
  d1: D1Database,
  actorId: number | null,
  entity: string,
  entityId: number,
  action: string,
  detail: unknown = "",
): Promise<void> {
  await run(
    d1,
    "INSERT INTO audit_log(actor_id, entity, entity_id, action, detail) VALUES(?, ?, ?, ?, ?)",
    actorId,
    entity,
    entityId,
    action,
    typeof detail === "string" ? detail : JSON.stringify(detail),
  );
}

export async function auditFor(
  d1: D1Database,
  entity: string,
  entityId: number,
  limit = 100,
): Promise<AuditEntry[]> {
  return all<AuditEntry>(
    d1,
    `SELECT a.id, COALESCE(u.name, 'Sistem') AS actor_name, a.entity, a.entity_id,
            a.action, a.detail, a.created_at
       FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
      WHERE a.entity = ? AND a.entity_id = ?
      ORDER BY a.id DESC LIMIT ?`,
    entity,
    entityId,
    limit,
  );
}

export async function auditRecent(d1: D1Database, limit = 200): Promise<AuditEntry[]> {
  return all<AuditEntry>(
    d1,
    `SELECT a.id, COALESCE(u.name, 'Sistem') AS actor_name, a.entity, a.entity_id,
            a.action, a.detail, a.created_at
       FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
      ORDER BY a.id DESC LIMIT ?`,
    limit,
  );
}
