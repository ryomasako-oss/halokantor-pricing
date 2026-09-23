import { describe, expect, it } from "vitest";
import { hasPermission } from "./permissions.js";
import { EDITABLE_STATUSES } from "../server/quoteService.js";
import type { User } from "./types.js";

// Replicate canEdit logic from server/routes/quotes.ts and server/worker/routes/quotes.ts
function canEdit(user: User, createdBy: number, assignedTo: number | null): boolean {
  return user.id === createdBy || user.id === assignedTo || hasPermission(user.role, "edit_all_quotes");
}

function makeUser(over: Partial<User> & { id: number; role: User["role"] }): User {
  return {
    email: `u${over.id}@test.local`,
    name: `User ${over.id}`,
    password_hash: "",
    active: 1,
    phone: "",
    created_at: new Date().toISOString(),
    ...over,
  } as User;
}

describe("revision authorization (security fix) – canEdit + editable status", () => {
  it("creator may save a revision", () => {
    const rep = makeUser({ id: 1, role: "rep" });
    expect(canEdit(rep, 1, null)).toBe(true);
  });

  it("assignee may save a revision after reassignment", () => {
    const rep2 = makeUser({ id: 2, role: "rep" });
    expect(canEdit(rep2, 1, 2)).toBe(true);
  });

  it("unrelated rep cannot save a revision (403)", () => {
    const other = makeUser({ id: 99, role: "rep" });
    expect(canEdit(other, 1, 2)).toBe(false);
  });

  it("manager with edit_all_quotes may save any revision", () => {
    const mgr = makeUser({ id: 10, role: "manager" });
    expect(canEdit(mgr, 1, 2)).toBe(true);
    expect(canEdit(mgr, 999, null)).toBe(true);
  });

  it("admin inherits edit_all_quotes", () => {
    const admin = makeUser({ id: 11, role: "admin" });
    expect(canEdit(admin, 1, null)).toBe(true);
  });

  it("EDITABLE_STATUSES allows only draft and rejected", () => {
    expect(EDITABLE_STATUSES).toEqual(["draft", "rejected"]);
    expect(EDITABLE_STATUSES.includes("draft" as any)).toBe(true);
    expect(EDITABLE_STATUSES.includes("rejected" as any)).toBe(true);
    expect(EDITABLE_STATUSES.includes("submitted" as any)).toBe(false);
    expect(EDITABLE_STATUSES.includes("approved" as any)).toBe(false);
    expect(EDITABLE_STATUSES.includes("sent" as any)).toBe(false);
  });

  it("locked statuses are rejected (409)", () => {
    const rep = makeUser({ id: 1, role: "rep" });
    const locked: string[] = ["submitted", "approved", "sent", "won", "lost", "completed"];
    for (const status of locked) {
      expect(EDITABLE_STATUSES.includes(status as any)).toBe(false);
      // canEdit may be true but status check blocks
      expect(canEdit(rep, 1, null) && EDITABLE_STATUSES.includes(status as any)).toBe(false);
    }
  });
});
