import { describe, expect, it } from "vitest";
import { ROLE_PERMISSIONS, hasPermission, rolesWith, type Permission } from "./permissions.js";
import type { Role } from "./types.js";

describe("permissions", () => {
  it("rep has no named permissions", () => {
    expect(ROLE_PERMISSIONS.rep).toEqual([]);
  });

  it("manager has exactly the catalog/client/quote/audit permissions", () => {
    expect(new Set(ROLE_PERMISSIONS.manager)).toEqual(
      new Set([
        "import_catalog",
        "edit_catalog",
        "delete_clients",
        "decide_quotes",
        "edit_all_quotes",
        "view_audit",
      ]),
    );
  });

  it("admin inherits every manager permission, plus admin-only ones", () => {
    for (const permission of ROLE_PERMISSIONS.manager) {
      expect(hasPermission("admin", permission)).toBe(true);
    }
    expect(new Set(ROLE_PERMISSIONS.admin)).toEqual(
      new Set([
        ...ROLE_PERMISSIONS.manager,
        "manage_users",
        "manage_policy",
        "manage_company",
        "delete_catalog",
        "delete_quotes",
      ]),
    );
  });

  it("rolesWith returns only roles carrying that permission", () => {
    expect(rolesWith("manage_users")).toEqual(["admin"]);
    expect(rolesWith("decide_quotes").sort()).toEqual(["admin", "manager"]);
    expect(rolesWith("view_audit").sort()).toEqual(["admin", "manager"]);
  });

  it("every role/permission pair matches ROLE_PERMISSIONS", () => {
    const roles: Role[] = ["rep", "manager", "admin"];
    for (const role of roles) {
      for (const permission of ["manage_users", "manage_policy", "manage_company", "import_catalog",
        "edit_catalog", "delete_catalog", "delete_clients", "decide_quotes", "edit_all_quotes",
        "delete_quotes", "view_audit"] as Permission[]) {
        expect(hasPermission(role, permission)).toBe(ROLE_PERMISSIONS[role].includes(permission));
      }
    }
  });
});
