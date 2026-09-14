/* ============================================================
   Named permissions — the single source of truth for what each role
   may do, imported by both auth implementations (server/auth.ts for
   Express, server/worker/auth.ts for the Cloudflare Worker) and by
   the web client's AuthContext, so all three agree on access.
   ============================================================ */

import type { Role } from "./types.js";

export type Permission =
  | "manage_users"
  | "manage_policy"
  | "manage_company"
  | "import_catalog"
  | "edit_catalog"
  | "delete_catalog"
  | "delete_clients"
  | "decide_quotes"
  | "edit_all_quotes"
  | "delete_quotes"
  | "view_audit";

/** Reproduces today's rank-based access exactly: admin inherits manager. */
const MANAGER_PERMISSIONS: Permission[] = [
  "import_catalog",
  "edit_catalog",
  "delete_clients",
  "decide_quotes",
  "edit_all_quotes",
  "view_audit",
];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  rep: [],
  manager: MANAGER_PERMISSIONS,
  admin: [
    ...MANAGER_PERMISSIONS,
    "manage_users",
    "manage_policy",
    "manage_company",
    "delete_catalog",
    "delete_quotes",
  ],
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

/** Every role that carries the given permission, e.g. for "who else could take over". */
export function rolesWith(permission: Permission): Role[] {
  return (Object.keys(ROLE_PERMISSIONS) as Role[]).filter((role) => hasPermission(role, permission));
}
