/* Append-only record of who changed what. Never updated or deleted. */

import { all, run } from "./db.js";
import type { AuditEntry } from "../shared/types.js";

export function audit(
  actorId: number | null,
  entity: string,
  entityId: number,
  action: string,
  detail: unknown = "",
): void {
  run(
    "INSERT INTO audit_log(actor_id, entity, entity_id, action, detail) VALUES(?, ?, ?, ?, ?)",
    actorId,
    entity,
    entityId,
    action,
    typeof detail === "string" ? detail : JSON.stringify(detail),
  );
}

export function auditFor(entity: string, entityId: number, limit = 100): AuditEntry[] {
  return all<AuditEntry>(
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

export function auditRecent(limit = 200): AuditEntry[] {
  return all<AuditEntry>(
    `SELECT a.id, COALESCE(u.name, 'Sistem') AS actor_name, a.entity, a.entity_id,
            a.action, a.detail, a.created_at
       FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
      ORDER BY a.id DESC LIMIT ?`,
    limit,
  );
}
