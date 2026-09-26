/* ============================================================
   Parity test: Express/node:sqlite backend vs. Worker/D1 backend.

   The project note for this codebase flags that these two backends
   duplicate the same route/service logic (server/routes/quotes.ts vs
   server/worker/routes/quotes.ts) and "had already drifted once
   before". This script runs the *same* sequence of real HTTP-shaped
   requests against both real route files and diffs the meaningful
   parts of every response — so a future edit that touches one side
   but not its twin gets caught automatically instead of by manual
   review.

   The Worker side runs against a D1Database shim backed by
   node:sqlite (see d1-sqlite-shim.ts) rather than a full `wrangler
   dev`/workerd instance: D1 is SQLite underneath, so statement
   semantics line up, and this stays fast and dependency-free. It is
   not a substitute for occasionally smoke-testing the real Worker
   with `wrangler dev` — it only proves the two route/service files
   make the same decisions given the same inputs.

   Run: npx tsx scripts/test-backend-parity.ts
   ============================================================ */

import { DatabaseSync } from "node:sqlite";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { D1DatabaseShim, AlwaysAllowRateLimit } from "./d1-sqlite-shim.js";

type Session = { cookie: string };
type ApiResult = { status: number; json: any };

interface Driver {
  name: string;
  api(method: string, routePath: string, opts?: { body?: unknown; session?: Session }): Promise<ApiResult>;
  login(email: string, password: string): Promise<Session>;
  seedUser(email: string, name: string, role: "rep" | "manager" | "admin", password: string): Promise<void>;
  teardown(): Promise<void>;
}

// ---------------------------------------------------------------
// Express driver — real app.listen(), real node:sqlite.
// ---------------------------------------------------------------
async function makeExpressDriver(): Promise<Driver> {
  const dbDir = mkdtempSync(path.join(tmpdir(), "hk-parity-express-"));
  process.env.DATABASE_PATH = path.join(dbDir, "test.db");
  process.env.JWT_SECRET = "test-only-secret-not-for-production-0000000000";
  process.env.NODE_ENV = "test";

  const express = (await import("express")).default;
  const cookieParser = (await import("cookie-parser")).default;
  const { loadUser, hashPassword } = await import("../server/auth.js");
  const { authRouter } = await import("../server/routes/auth.js");
  const { quotesRouter } = await import("../server/routes/quotes.js");
  const { approvalsRouter } = await import("../server/routes/approvals.js");
  const { catalogRouter } = await import("../server/routes/catalog.js");
  const { run } = await import("../server/db.js");

  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(loadUser);
  app.use("/api/auth", authRouter);
  app.use("/api/quotes", quotesRouter);
  app.use("/api/approvals", approvalsRouter);
  app.use("/api/catalog", catalogRouter);

  let server: Server;
  await new Promise<void>((resolve) => {
    server = app.listen(0, resolve);
  });
  const address = server!.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    name: "express",
    async api(method, routePath, opts = {}) {
      const res = await fetch(`${baseUrl}${routePath}`, {
        method,
        headers: {
          "content-type": "application/json",
          ...(opts.session ? { cookie: opts.session.cookie } : {}),
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      });
      const setCookie = res.headers.get("set-cookie");
      const cookie = setCookie ? setCookie.split(";")[0] : undefined;
      const json = res.status === 204 ? null : await res.json().catch(() => null);
      return { status: res.status, json: cookie ? { ...json, __cookie: cookie } : json };
    },
    async login(email, password) {
      const r = await this.api("POST", "/api/auth/login", { body: { email, password } });
      if (r.status !== 200 || !r.json?.__cookie) throw new Error(`express login failed: ${r.status}`);
      return { cookie: r.json.__cookie };
    },
    async seedUser(email, name, role, password) {
      run(
        `INSERT INTO users(email, name, password_hash, role) VALUES(?, ?, ?, ?)`,
        email,
        name,
        hashPassword(password),
        role,
      );
    },
    async teardown() {
      await new Promise((resolve) => server!.close(resolve));
      rmSync(dbDir, { recursive: true, force: true });
    },
  };
}

// ---------------------------------------------------------------
// Worker driver — real Hono app.request(), D1 shim over node:sqlite.
// ---------------------------------------------------------------
async function makeWorkerDriver(): Promise<Driver> {
  const sqlite = new DatabaseSync(":memory:");
  const migrationsDir = path.resolve(import.meta.dirname, "../migrations");
  for (const file of [
    "0001_init.sql",
    "0002_consistency.sql",
    "0003_password_reset_requests.sql",
    "0004_user_phone.sql",
    "0005_reassignment_and_restore.sql",
    "0006_uom_options.sql",
    "0007_catalog_item_uoms.sql",
  ]) {
    sqlite.exec(readFileSync(path.join(migrationsDir, file), "utf8"));
  }
  const db = new D1DatabaseShim(sqlite) as unknown as D1Database;

  const { Hono } = await import("hono");
  const { hashPassword, loadUser } = await import("../server/worker/auth.js");
  const { authRouter } = await import("../server/worker/routes/auth.js");
  const { quotesRouter } = await import("../server/worker/routes/quotes.js");
  const { approvalsRouter } = await import("../server/worker/routes/approvals.js");
  const { catalogRouter } = await import("../server/worker/routes/catalog.js");
  const { run } = await import("../server/db.d1.js");

  const app = new Hono();
  app.use(loadUser);
  app.route("/api/auth", authRouter);
  app.route("/api/quotes", quotesRouter);
  app.route("/api/approvals", approvalsRouter);
  app.route("/api/catalog", catalogRouter);

  const env = {
    DB: db,
    JWT_SECRET: "test-only-secret-not-for-production-0000000000",
    NODE_ENV: "test",
    AUTH_LIMITER: new AlwaysAllowRateLimit() as unknown as RateLimit,
    ASSISTANT_LIMITER: new AlwaysAllowRateLimit() as unknown as RateLimit,
  };

  // Hono's Context.executionCtx throws if no real ExecutionContext is passed
  // to app.request() — routes that call c.executionCtx.waitUntil() (the
  // notification fire-and-forget calls) need this stub to not crash.
  const executionCtx = {
    waitUntil: (promise: Promise<unknown>) => {
      promise.catch(() => undefined);
    },
    passThroughOnException: () => undefined,
  } as unknown as ExecutionContext;

  return {
    name: "worker",
    async api(method, routePath, opts = {}) {
      const res = await app.request(
        routePath,
        {
          method,
          headers: {
            "content-type": "application/json",
            ...(opts.session ? { cookie: opts.session.cookie } : {}),
          },
          body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        },
        env,
        executionCtx,
      );
      const setCookie = res.headers.get("set-cookie");
      const cookie = setCookie ? setCookie.split(";")[0] : undefined;
      const json = res.status === 204 ? null : await res.json().catch(() => null);
      return { status: res.status, json: cookie ? { ...json, __cookie: cookie } : json };
    },
    async login(email, password) {
      const r = await this.api("POST", "/api/auth/login", { body: { email, password } });
      if (r.status !== 200 || !r.json?.__cookie) throw new Error(`worker login failed: ${r.status}`);
      return { cookie: r.json.__cookie };
    },
    async seedUser(email, name, role, password) {
      await run(
        db,
        `INSERT INTO users(email, name, password_hash, role) VALUES(?, ?, ?, ?)`,
        email,
        name,
        await hashPassword(password),
        role,
      );
    },
    async teardown() {
      /* in-memory sqlite, nothing to clean up */
    },
  };
}

// ---------------------------------------------------------------
// Scenario helpers, backend-agnostic.
// ---------------------------------------------------------------

function cleanItem(over: Record<string, unknown> = {}) {
  return {
    id: "it1",
    lineNo: 1,
    code: "ATK-001",
    name: "Kertas A4 80gsm",
    uom: "rim",
    qty: 100,
    cogs: 38000,
    rrp: 55000,
    role: "CORE",
    ...over,
  };
}

const DEFAULT_ASSUMPTIONS = {
  opex: 0.08,
  targetMargin: 0.25,
  leaderMargin: 0.1,
  profitDiscount: 0.0,
  rrpDiscount: 0.1,
  marginFloor: 0.05,
  ppn: 0.11,
  step: 50,
  months: 12,
  includeLogistics: false,
};

function snapshotFor(items: ReturnType<typeof cleanItem>[], overAssumptions: Record<string, unknown> = {}) {
  return {
    assumptions: { ...DEFAULT_ASSUMPTIONS, ...overAssumptions },
    items,
    regions: [],
    meta: { quoteNo: "", date: "2026-01-01", validity: 30, payment: "", delivery: "", notes: "" },
    scenario: 0,
  };
}

async function createDraft(
  driver: Driver,
  session: Session,
  items: ReturnType<typeof cleanItem>[],
  overAssumptions: Record<string, unknown> = {},
) {
  const created = await driver.api("POST", "/api/quotes", {
    body: { title: "Test quote", snapshot: snapshotFor(items, overAssumptions) },
    session,
  });
  assert.equal(created.status, 201, `[${driver.name}] create draft failed: ${JSON.stringify(created.json)}`);
  return created.json.quote as { id: number; version: number; number: string };
}

// Both real login endpoints are rate-limited; logging in fresh on every
// scenario would trip that limit long before comparing business logic.
const sessionCache = new Map<string, Session>();
async function loginCached(d: Driver, email: string, password: string): Promise<Session> {
  const key = `${d.name}:${email}`;
  const cached = sessionCache.get(key);
  if (cached) return cached;
  const session = await d.login(email, password);
  sessionCache.set(key, session);
  return session;
}

// ---------------------------------------------------------------
// Scenarios: each returns the fields worth comparing between backends.
// Timestamps and the raw cookie are deliberately excluded.
// ---------------------------------------------------------------

type Scenario = { name: string; run: (d: Driver) => Promise<Record<string, unknown>> };
const scenarios: Scenario[] = [];
const scenario = (name: string, run: Scenario["run"]) => scenarios.push({ name, run });

scenario("rep submits a clean quote -> pending, not auto-approved", async (d) => {
  const rep = await loginCached(d, "rep@test.local", "password123");
  const quote = await createDraft(d, rep, [cleanItem()]);
  const submitted = await d.api("POST", `/api/quotes/${quote.id}/submit`, { session: rep });
  return {
    status: submitted.status,
    autoApproved: submitted.json.autoApproved,
    quoteStatus: submitted.json.quote.status,
    breachCodes: submitted.json.breaches.map((b: { code: string }) => b.code),
  };
});

scenario("manager submits a clean quote -> auto-approved", async (d) => {
  const manager = await loginCached(d, "manager@test.local", "password123");
  const quote = await createDraft(d, manager, [cleanItem()]);
  const submitted = await d.api("POST", `/api/quotes/${quote.id}/submit`, { session: manager });
  return {
    status: submitted.status,
    autoApproved: submitted.json.autoApproved,
    quoteStatus: submitted.json.quote.status,
    approvedByIsSet: submitted.json.quote.approved_by != null,
  };
});

scenario("rep submits a policy-breaching quote -> pending with breach codes", async (d) => {
  const rep = await loginCached(d, "rep@test.local", "password123");
  const quote = await createDraft(d, rep, [cleanItem()], { targetMargin: 0.05, leaderMargin: 0.0 });
  const submitted = await d.api("POST", `/api/quotes/${quote.id}/submit`, { session: rep });
  return {
    status: submitted.status,
    autoApproved: submitted.json.autoApproved,
    quoteStatus: submitted.json.quote.status,
    breachCodes: submitted.json.breaches.map((b: { code: string }) => b.code).sort(),
  };
});

scenario("manager submits a breaching quote -> NOT auto-approved despite permission", async (d) => {
  const manager = await loginCached(d, "manager@test.local", "password123");
  const quote = await createDraft(d, manager, [cleanItem()], { targetMargin: 0.05, leaderMargin: 0.0 });
  const submitted = await d.api("POST", `/api/quotes/${quote.id}/submit`, { session: manager });
  return {
    status: submitted.status,
    autoApproved: submitted.json.autoApproved,
    quoteStatus: submitted.json.quote.status,
  };
});

scenario("submitting an already-submitted quote -> 409", async (d) => {
  const rep = await loginCached(d, "rep@test.local", "password123");
  const quote = await createDraft(d, rep, [cleanItem()]);
  await d.api("POST", `/api/quotes/${quote.id}/submit`, { session: rep });
  const again = await d.api("POST", `/api/quotes/${quote.id}/submit`, { session: rep });
  return { status: again.status };
});

scenario("rep cannot decide (403)", async (d) => {
  const rep = await loginCached(d, "rep@test.local", "password123");
  const quote = await createDraft(d, rep, [cleanItem()], { targetMargin: 0.05, leaderMargin: 0.0 });
  await d.api("POST", `/api/quotes/${quote.id}/submit`, { session: rep });
  const decided = await d.api("POST", `/api/quotes/${quote.id}/decide`, {
    body: { decision: "approved", note: "" },
    session: rep,
  });
  return { status: decided.status };
});

scenario("manager approves a pending quote", async (d) => {
  const rep = await loginCached(d, "rep@test.local", "password123");
  const manager = await loginCached(d, "manager@test.local", "password123");
  const quote = await createDraft(d, rep, [cleanItem()], { targetMargin: 0.05, leaderMargin: 0.0 });
  await d.api("POST", `/api/quotes/${quote.id}/submit`, { session: rep });
  const decided = await d.api("POST", `/api/quotes/${quote.id}/decide`, {
    body: { decision: "approved", note: "Dispensasi khusus" },
    session: manager,
  });
  return {
    status: decided.status,
    quoteStatus: decided.json.quote.status,
    decisionNote: decided.json.quote.decision_note,
  };
});

scenario("rejecting without a note -> 400", async (d) => {
  const rep = await loginCached(d, "rep@test.local", "password123");
  const manager = await loginCached(d, "manager@test.local", "password123");
  const quote = await createDraft(d, rep, [cleanItem()], { targetMargin: 0.05, leaderMargin: 0.0 });
  await d.api("POST", `/api/quotes/${quote.id}/submit`, { session: rep });
  const decided = await d.api("POST", `/api/quotes/${quote.id}/decide`, {
    body: { decision: "rejected", note: "" },
    session: manager,
  });
  return { status: decided.status };
});

scenario("manager rejects with a note", async (d) => {
  const rep = await loginCached(d, "rep@test.local", "password123");
  const manager = await loginCached(d, "manager@test.local", "password123");
  const quote = await createDraft(d, rep, [cleanItem()], { targetMargin: 0.05, leaderMargin: 0.0 });
  await d.api("POST", `/api/quotes/${quote.id}/submit`, { session: rep });
  const decided = await d.api("POST", `/api/quotes/${quote.id}/decide`, {
    body: { decision: "rejected", note: "Margin terlalu tipis." },
    session: manager,
  });
  return { status: decided.status, quoteStatus: decided.json.quote.status };
});

scenario("deciding a draft (not pending) -> 409", async (d) => {
  const manager = await loginCached(d, "manager@test.local", "password123");
  const quote = await createDraft(d, manager, [cleanItem()]);
  const decided = await d.api("POST", `/api/quotes/${quote.id}/decide`, {
    body: { decision: "approved", note: "" },
    session: manager,
  });
  return { status: decided.status };
});

scenario("stale expected_version -> 409, does not overwrite", async (d) => {
  const rep = await loginCached(d, "rep@test.local", "password123");
  const quote = await createDraft(d, rep, [cleanItem()]);
  const staleVersion = quote.version;
  const first = await d.api("PUT", `/api/quotes/${quote.id}`, {
    body: { snapshot: snapshotFor([cleanItem({ qty: 200 })]), expected_version: staleVersion },
    session: rep,
  });
  const second = await d.api("PUT", `/api/quotes/${quote.id}`, {
    body: { snapshot: snapshotFor([cleanItem({ qty: 300 })]), expected_version: staleVersion },
    session: rep,
  });
  return {
    firstStatus: first.status,
    firstVersion: first.json.quote.version,
    secondStatus: second.status,
    winningQty: second.json.quote.items[0].qty,
  };
});

scenario("correct expected_version -> succeeds, bumps version", async (d) => {
  const rep = await loginCached(d, "rep@test.local", "password123");
  const quote = await createDraft(d, rep, [cleanItem()]);
  const saved = await d.api("PUT", `/api/quotes/${quote.id}`, {
    body: { snapshot: snapshotFor([cleanItem({ qty: 500 })]), expected_version: quote.version },
    session: rep,
  });
  return { status: saved.status, version: saved.json.quote.version, qty: saved.json.quote.items[0].qty };
});

scenario("a locked (submitted) quote cannot be edited", async (d) => {
  const rep = await loginCached(d, "rep@test.local", "password123");
  const quote = await createDraft(d, rep, [cleanItem()]);
  await d.api("POST", `/api/quotes/${quote.id}/submit`, { session: rep });
  const saved = await d.api("PUT", `/api/quotes/${quote.id}`, {
    body: { snapshot: snapshotFor([cleanItem({ qty: 999 })]), expected_version: quote.version },
    session: rep,
  });
  return { status: saved.status };
});

scenario("a different rep cannot submit someone else's draft (403)", async (d) => {
  const rep = await loginCached(d, "rep@test.local", "password123");
  const rep2 = await loginCached(d, "rep2@test.local", "password123");
  const quote = await createDraft(d, rep, [cleanItem()]);
  const submitted = await d.api("POST", `/api/quotes/${quote.id}/submit`, { session: rep2 });
  return { status: submitted.status };
});

scenario("a manager CAN submit another rep's draft (edit_all_quotes)", async (d) => {
  const rep = await loginCached(d, "rep@test.local", "password123");
  const manager = await loginCached(d, "manager@test.local", "password123");
  const quote = await createDraft(d, rep, [cleanItem()]);
  const submitted = await d.api("POST", `/api/quotes/${quote.id}/submit`, { session: manager });
  return { status: submitted.status, quoteStatus: submitted.json.quote.status };
});

scenario("a rep cannot read the company-wide approval queue (403)", async (d) => {
  const rep = await loginCached(d, "rep@test.local", "password123");
  const listed = await d.api("GET", "/api/approvals?decision=pending", { session: rep });
  return { status: listed.status };
});

scenario("a manager CAN read the approval queue", async (d) => {
  const manager = await loginCached(d, "manager@test.local", "password123");
  const listed = await d.api("GET", "/api/approvals?decision=pending", { session: manager });
  return { status: listed.status, isArray: Array.isArray(listed.json.approvals) };
});

scenario("a user can set and clear their own WhatsApp number", async (d) => {
  const rep = await loginCached(d, "rep@test.local", "password123");
  const set = await d.api("PATCH", "/api/auth/profile", { body: { phone: "+6281234567890" }, session: rep });
  const cleared = await d.api("PATCH", "/api/auth/profile", { body: { phone: "" }, session: rep });
  return { setStatus: set.status, setPhone: set.json.user.phone, clearedPhone: cleared.json.user.phone };
});

scenario("an invalid WhatsApp number is rejected with 400", async (d) => {
  const rep = await loginCached(d, "rep@test.local", "password123");
  const updated = await d.api("PATCH", "/api/auth/profile", { body: { phone: "not-a-phone!!" }, session: rep });
  return { status: updated.status };
});

scenario("rep cannot reassign a quote (403)", async (d) => {
  const rep = await loginCached(d, "rep@test.local", "password123");
  const rep2 = await loginCached(d, "rep2@test.local", "password123");
  const quote = await createDraft(d, rep, [cleanItem()]);
  const rep2User = await d.api("GET", "/api/auth/me", { session: rep2 });
  const reassigned = await d.api("POST", `/api/quotes/${quote.id}/reassign`, {
    body: { assigned_to: rep2User.json.user.id, note: "" },
    session: rep,
  });
  return { status: reassigned.status };
});

scenario("reassigning to an unknown user -> 400", async (d) => {
  const manager = await loginCached(d, "manager@test.local", "password123");
  const rep = await loginCached(d, "rep@test.local", "password123");
  const quote = await createDraft(d, rep, [cleanItem()]);
  const reassigned = await d.api("POST", `/api/quotes/${quote.id}/reassign`, {
    body: { assigned_to: 999999, note: "" },
    session: manager,
  });
  return { status: reassigned.status };
});

scenario("manager reassigns a draft, the new assignee can then edit it", async (d) => {
  const manager = await loginCached(d, "manager@test.local", "password123");
  const rep = await loginCached(d, "rep@test.local", "password123");
  const rep2 = await loginCached(d, "rep2@test.local", "password123");
  const quote = await createDraft(d, rep, [cleanItem()]);
  const rep2User = await d.api("GET", "/api/auth/me", { session: rep2 });
  const reassigned = await d.api("POST", `/api/quotes/${quote.id}/reassign`, {
    body: { assigned_to: rep2User.json.user.id, note: "Rep asli cuti" },
    session: manager,
  });
  const editedByNewAssignee = await d.api("PUT", `/api/quotes/${quote.id}`, {
    body: { snapshot: snapshotFor([cleanItem({ qty: 250 })]), expected_version: reassigned.json.quote.version },
    session: rep2,
  });
  return {
    reassignStatus: reassigned.status,
    assignedToIsSet: reassigned.json.quote.assigned_to != null,
    editStatus: editedByNewAssignee.status,
    editedQty: editedByNewAssignee.json.quote.items[0].qty,
  };
});

scenario("reassigning a quote records a history entry naming the new owner", async (d) => {
  const manager = await loginCached(d, "manager@test.local", "password123");
  const rep = await loginCached(d, "rep@test.local", "password123");
  const rep2 = await loginCached(d, "rep2@test.local", "password123");
  const quote = await createDraft(d, rep, [cleanItem()]);
  const rep2User = await d.api("GET", "/api/auth/me", { session: rep2 });
  await d.api("POST", `/api/quotes/${quote.id}/reassign`, {
    body: { assigned_to: rep2User.json.user.id, note: "Cakupan cuti" },
    session: manager,
  });
  const detail = await d.api("GET", `/api/quotes/${quote.id}`, { session: rep });
  const notes = detail.json.revisions.map((r: { note: string }) => r.note);
  return { hasHandoffEntry: notes.some((n: string) => n === "Dialihkan ke Rep Two: Cakupan cuti") };
});

scenario("unassigning a quote records a distinct history entry", async (d) => {
  const manager = await loginCached(d, "manager@test.local", "password123");
  const rep = await loginCached(d, "rep@test.local", "password123");
  const rep2 = await loginCached(d, "rep2@test.local", "password123");
  const quote = await createDraft(d, rep, [cleanItem()]);
  const rep2User = await d.api("GET", "/api/auth/me", { session: rep2 });
  await d.api("POST", `/api/quotes/${quote.id}/reassign`, { body: { assigned_to: rep2User.json.user.id, note: "" }, session: manager });
  await d.api("POST", `/api/quotes/${quote.id}/reassign`, { body: { assigned_to: null, note: "" }, session: manager });
  const detail = await d.api("GET", `/api/quotes/${quote.id}`, { session: rep });
  const notes = detail.json.revisions.map((r: { note: string }) => r.note);
  return { hasUnassignEntry: notes.includes("Penugasan dilepas") };
});

scenario("reassigning to the already-current assignee is a no-op (no duplicate history entry)", async (d) => {
  const manager = await loginCached(d, "manager@test.local", "password123");
  const rep = await loginCached(d, "rep@test.local", "password123");
  const rep2 = await loginCached(d, "rep2@test.local", "password123");
  const quote = await createDraft(d, rep, [cleanItem()]);
  const rep2User = await d.api("GET", "/api/auth/me", { session: rep2 });
  await d.api("POST", `/api/quotes/${quote.id}/reassign`, { body: { assigned_to: rep2User.json.user.id, note: "" }, session: manager });
  const before = await d.api("GET", `/api/quotes/${quote.id}`, { session: rep });
  const repeat = await d.api("POST", `/api/quotes/${quote.id}/reassign`, { body: { assigned_to: rep2User.json.user.id, note: "" }, session: manager });
  const after = await d.api("GET", `/api/quotes/${quote.id}`, { session: rep });
  return {
    repeatStatus: repeat.status,
    revisionCountUnchanged: before.json.revisions.length === after.json.revisions.length,
  };
});

scenario("won -> completed is an allowed manual status move", async (d) => {
  const manager = await loginCached(d, "manager@test.local", "password123");
  const quote = await createDraft(d, manager, [cleanItem()]);
  await d.api("POST", `/api/quotes/${quote.id}/submit`, { session: manager }); // manager auto-approves
  await d.api("POST", `/api/quotes/${quote.id}/status`, { body: { status: "sent" }, session: manager });
  await d.api("POST", `/api/quotes/${quote.id}/status`, { body: { status: "won" }, session: manager });
  const completed = await d.api("POST", `/api/quotes/${quote.id}/status`, { body: { status: "completed" }, session: manager });
  return { status: completed.status, quoteStatus: completed.json.quote?.status };
});

scenario("sent -> completed is rejected (must pass through won first) -> 409", async (d) => {
  const manager = await loginCached(d, "manager@test.local", "password123");
  const quote = await createDraft(d, manager, [cleanItem()]);
  await d.api("POST", `/api/quotes/${quote.id}/submit`, { session: manager });
  await d.api("POST", `/api/quotes/${quote.id}/status`, { body: { status: "sent" }, session: manager });
  const skip = await d.api("POST", `/api/quotes/${quote.id}/status`, { body: { status: "completed" }, session: manager });
  return { status: skip.status };
});

scenario("owner can reopen their own submitted quote directly, no manager decision needed", async (d) => {
  const rep = await loginCached(d, "rep@test.local", "password123");
  const quote = await createDraft(d, rep, [cleanItem()]);
  await d.api("POST", `/api/quotes/${quote.id}/submit`, { session: rep });
  const reopened = await d.api("POST", `/api/quotes/${quote.id}/reopen`, { session: rep });
  return { status: reopened.status, quoteStatus: reopened.json.quote?.status };
});

scenario("a different rep still cannot reopen someone else's submitted quote (403)", async (d) => {
  const rep = await loginCached(d, "rep@test.local", "password123");
  const rep2 = await loginCached(d, "rep2@test.local", "password123");
  const quote = await createDraft(d, rep, [cleanItem()]);
  await d.api("POST", `/api/quotes/${quote.id}/submit`, { session: rep });
  const reopened = await d.api("POST", `/api/quotes/${quote.id}/reopen`, { session: rep2 });
  return { status: reopened.status };
});

scenario("reopening a submitted quote clears it from the manager's pending-approval queue", async (d) => {
  const manager = await loginCached(d, "manager@test.local", "password123");
  const rep = await loginCached(d, "rep@test.local", "password123");
  const quote = await createDraft(d, rep, [cleanItem()], { targetMargin: 0.05, leaderMargin: 0.0 }); // breaches policy -> stays pending
  await d.api("POST", `/api/quotes/${quote.id}/submit`, { session: rep });
  const beforeQueue = await d.api("GET", "/api/approvals?decision=pending", { session: manager });
  await d.api("POST", `/api/quotes/${quote.id}/reopen`, { session: rep });
  const afterQueue = await d.api("GET", "/api/approvals?decision=pending", { session: manager });
  const inQueue = (rows: { quote_id: number }[]) => rows.some((r) => r.quote_id === quote.id);
  return {
    wasQueuedBefore: inQueue(beforeQueue.json.approvals),
    stillQueuedAfter: inQueue(afterQueue.json.approvals),
  };
});

scenario("rejecting a quote records who rejected it, visible on the quote itself", async (d) => {
  const rep = await loginCached(d, "rep@test.local", "password123");
  const manager = await loginCached(d, "manager@test.local", "password123");
  const quote = await createDraft(d, rep, [cleanItem()], { targetMargin: 0.05, leaderMargin: 0.0 });
  await d.api("POST", `/api/quotes/${quote.id}/submit`, { session: rep });
  const decided = await d.api("POST", `/api/quotes/${quote.id}/decide`, {
    body: { decision: "rejected", note: "Margin terlalu tipis." },
    session: manager,
  });
  return {
    approvedByIsSet: decided.json.quote.approved_by != null,
    approvedByName: decided.json.quote.approved_by_name,
  };
});

scenario("editing a quote (e.g. fixing it after a rejection) is recorded in the audit trail", async (d) => {
  const rep = await loginCached(d, "rep@test.local", "password123");
  const manager = await loginCached(d, "manager@test.local", "password123");
  const quote = await createDraft(d, rep, [cleanItem()], { targetMargin: 0.05, leaderMargin: 0.0 });
  await d.api("POST", `/api/quotes/${quote.id}/submit`, { session: rep });
  const decided = await d.api("POST", `/api/quotes/${quote.id}/decide`, {
    body: { decision: "rejected", note: "Tambah item dulu." },
    session: manager,
  });
  // Manager fixes it directly (edit_all_quotes lets them touch a rejected quote).
  await d.api("PUT", `/api/quotes/${quote.id}`, {
    body: { snapshot: snapshotFor([cleanItem(), cleanItem({ id: "it2", lineNo: 2, code: "ATK-002" })]), expected_version: decided.json.quote.version },
    session: manager,
  });
  const detail = await d.api("GET", `/api/quotes/${quote.id}`, { session: rep });
  const editEntry = detail.json.audit.find((a: { action: string }) => a.action === "edited");
  return { hasEditAuditEntry: Boolean(editEntry), editedByManager: editEntry?.actor_name === "Manager One" };
});

scenario("UOM list is seeded and includes Pcs/Lusin", async (d) => {
  const rep = await loginCached(d, "rep@test.local", "password123");
  const listed = await d.api("GET", "/api/catalog/uom", { session: rep });
  const names = (listed.json.options as { name: string }[]).map((o) => o.name).sort();
  return { status: listed.status, hasPcs: names.includes("Pcs"), hasLusin: names.includes("Lusin") };
});

scenario("a rep cannot add a new UOM (403)", async (d) => {
  const rep = await loginCached(d, "rep@test.local", "password123");
  const added = await d.api("POST", "/api/catalog/uom", { body: { name: "Krat" }, session: rep });
  return { status: added.status };
});

scenario("a manager can add a new UOM, and it then appears in the list", async (d) => {
  const manager = await loginCached(d, "manager@test.local", "password123");
  const added = await d.api("POST", "/api/catalog/uom", { body: { name: "Karung" }, session: manager });
  const listed = await d.api("GET", "/api/catalog/uom", { session: manager });
  const names = (listed.json.options as { name: string }[]).map((o) => o.name);
  return { addStatus: added.status, nowInList: names.includes("Karung") };
});

scenario("adding a duplicate UOM name is rejected -> 409", async (d) => {
  const manager = await loginCached(d, "manager@test.local", "password123");
  const dup = await d.api("POST", "/api/catalog/uom", { body: { name: "Pcs" }, session: manager });
  return { status: dup.status };
});

// --- Per-item unit ratios (catalog_item_uoms) ---

const unitsOf = async (d: Driver, session: Session, codes: string[]) =>
  (await d.api("POST", "/api/catalog/units", { body: { codes }, session })).json.units;

scenario("import stores per-item units, cleaned (base dropped, case-insensitive dedup)", async (d) => {
  const manager = await loginCached(d, "manager@test.local", "password123");
  const imp = await d.api("POST", "/api/catalog/import", {
    body: {
      rows: [
        {
          code: "U-SMB", name: "Sambal 275ml", uom: "BTL", cogs: 12000,
          units: [{ uom: "BOX", factor: 24 }, { uom: "Box", factor: 12 }, { uom: "btl", factor: 1 }],
        },
        { code: "U-PEN", name: "Pulpen", uom: "Pcs", cogs: 1000 },
      ],
      mode: "merge",
    },
    session: manager,
  });
  const list = await d.api("GET", "/api/catalog?q=U-", { session: manager });
  const listed = Object.fromEntries(
    (list.json.items as { code: string; units: unknown }[]).map((i) => [i.code, i.units]),
  );
  const lookup = await unitsOf(d, manager, ["U-SMB", "U-PEN", "NOT-IN-CATALOG"]);
  assert.deepEqual(lookup, {
    "U-SMB": { baseUom: "BTL", units: [{ uom: "BOX", factor: 24 }] },
    "U-PEN": { baseUom: "Pcs", units: [] },
  });
  assert.deepEqual(listed["U-SMB"], [{ uom: "BOX", factor: 24 }]);
  return { status: imp.status, listed, lookup };
});

scenario("a rep can look up units but not import them", async (d) => {
  const rep = await loginCached(d, "rep@test.local", "password123");
  const imp = await d.api("POST", "/api/catalog/import", {
    body: { rows: [{ code: "U-REP", name: "X", units: [{ uom: "Box", factor: 2 }] }] },
    session: rep,
  });
  const lookup = await d.api("POST", "/api/catalog/units", { body: { codes: ["U-SMB"] }, session: rep });
  assert.equal(imp.status, 403);
  assert.equal(lookup.status, 200);
  return { importStatus: imp.status, lookupStatus: lookup.status };
});

scenario("import without units leaves existing units alone; an empty list clears them", async (d) => {
  const manager = await loginCached(d, "manager@test.local", "password123");
  await d.api("POST", "/api/catalog/import", {
    body: { rows: [{ code: "U-KEEP", name: "Keep", uom: "Pcs", units: [{ uom: "Lusin", factor: 12 }] }] },
    session: manager,
  });
  await d.api("POST", "/api/catalog/import", {
    body: { rows: [{ code: "U-KEEP", name: "Keep", cogs: 500 }] },
    session: manager,
  });
  const afterNoUnits = await unitsOf(d, manager, ["U-KEEP"]);
  await d.api("POST", "/api/catalog/import", {
    body: { rows: [{ code: "U-KEEP", name: "Keep", units: [] }] },
    session: manager,
  });
  const afterEmpty = await unitsOf(d, manager, ["U-KEEP"]);
  assert.deepEqual(afterNoUnits["U-KEEP"].units, [{ uom: "Lusin", factor: 12 }]);
  assert.deepEqual(afterEmpty["U-KEEP"].units, []);
  return { afterNoUnits, afterEmpty };
});

scenario("a units entry equal to the existing base is dropped even when the row sends no uom", async (d) => {
  const manager = await loginCached(d, "manager@test.local", "password123");
  await d.api("POST", "/api/catalog/import", {
    body: { rows: [{ code: "U-BASE", name: "Base", uom: "Rim" }] },
    session: manager,
  });
  await d.api("POST", "/api/catalog/import", {
    body: { rows: [{ code: "U-BASE", name: "Base", units: [{ uom: "RIM", factor: 1 }, { uom: "Box", factor: 5 }] }] },
    session: manager,
  });
  const units = await unitsOf(d, manager, ["U-BASE"]);
  assert.deepEqual(units["U-BASE"], { baseUom: "Rim", units: [{ uom: "Box", factor: 5 }] });
  return { units };
});

scenario("editing an item replaces its units; bad ratios are rejected (400)", async (d) => {
  const manager = await loginCached(d, "manager@test.local", "password123");
  const rep = await loginCached(d, "rep@test.local", "password123");
  const list = await d.api("GET", "/api/catalog?q=U-PEN", { session: manager });
  const id = list.json.items[0].id;
  const body = { name: "Pulpen", uom: "Pcs", cogs: 1000, list_price: 1500, category: "" };
  const ok = await d.api("PUT", `/api/catalog/${id}`, {
    body: { ...body, units: [{ uom: "Box", factor: 24 }, { uom: "Lusin", factor: 12 }] },
    session: manager,
  });
  const bad = await d.api("PUT", `/api/catalog/${id}`, {
    body: { ...body, units: [{ uom: "Box", factor: 0 }] },
    session: manager,
  });
  const repEdit = await d.api("PUT", `/api/catalog/${id}`, {
    body: { ...body, units: [{ uom: "Box", factor: 99 }] },
    session: rep,
  });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.json.item.units, [{ uom: "Lusin", factor: 12 }, { uom: "Box", factor: 24 }]);
  assert.equal(bad.status, 400);
  assert.equal(repEdit.status, 403);
  return {
    okStatus: ok.status,
    returnedUnits: ok.json.item.units,
    badStatus: bad.status,
    repStatus: repEdit.status,
    stored: await unitsOf(d, manager, ["U-PEN"]),
  };
});

scenario("a quote line's priceUom survives save and reload", async (d) => {
  const rep = await loginCached(d, "rep@test.local", "password123");
  const quote = await createDraft(d, rep, [cleanItem({ uom: "Box", priceUom: "rim" })]);
  const detail = await d.api("GET", `/api/quotes/${quote.id}`, { session: rep });
  assert.equal(detail.json.quote.items[0].priceUom, "rim");
  return { priceUom: detail.json.quote.items[0].priceUom, uom: detail.json.quote.items[0].uom };
});

scenario("replace-mode import clears every item's units", async (d) => {
  const manager = await loginCached(d, "manager@test.local", "password123");
  await d.api("POST", "/api/catalog/import", {
    body: { rows: [{ code: "U-NEW", name: "Fresh", uom: "Pcs" }], mode: "replace" },
    session: manager,
  });
  const units = await unitsOf(d, manager, ["U-SMB", "U-PEN", "U-NEW"]);
  assert.deepEqual(units, { "U-NEW": { baseUom: "Pcs", units: [] } });
  const leftover = await d.api("POST", "/api/catalog/import", {
    body: { rows: [{ code: "U-SMB", name: "Sambal again", uom: "BTL" }] },
    session: manager,
  });
  assert.equal(leftover.status, 200);
  assert.deepEqual((await unitsOf(d, manager, ["U-SMB"]))["U-SMB"].units, []);
  return { units };
});

scenario('"mine" filter includes quotes reassigned to the viewer, not just ones they created', async (d) => {
  const manager = await loginCached(d, "manager@test.local", "password123");
  const rep = await loginCached(d, "rep@test.local", "password123");
  const rep2 = await loginCached(d, "rep2@test.local", "password123");
  const quote = await createDraft(d, rep, [cleanItem()]);
  const rep2User = await d.api("GET", "/api/auth/me", { session: rep2 });
  await d.api("POST", `/api/quotes/${quote.id}/reassign`, {
    body: { assigned_to: rep2User.json.user.id, note: "" },
    session: manager,
  });
  const mineList = await d.api("GET", "/api/quotes?mine=1", { session: rep2 });
  return {
    status: mineList.status,
    includesReassignedQuote: mineList.json.quotes.some((q: { id: number }) => q.id === quote.id),
  };
});

scenario("restoring a revision tags it restore-<client>-<n> and keeps the prior state", async (d) => {
  const rep = await loginCached(d, "rep@test.local", "password123");
  const quote = await createDraft(d, rep, [cleanItem()]);
  const saved = await d.api("POST", `/api/quotes/${quote.id}/revisions`, {
    body: { note: "Snapshot V1" },
    session: rep,
  });
  const detailBefore = await d.api("GET", `/api/quotes/${quote.id}`, { session: rep });
  const snapshotRev = detailBefore.json.revisions.find((r: { note: string }) => r.note === "Snapshot V1");
  await d.api("PUT", `/api/quotes/${quote.id}`, {
    body: { snapshot: snapshotFor([cleanItem({ qty: 700 })]), expected_version: quote.version },
    session: rep,
  });
  const restored = await d.api("POST", `/api/quotes/${quote.id}/restore/${snapshotRev.id}`, { session: rep });
  const detailAfter = await d.api("GET", `/api/quotes/${quote.id}`, { session: rep });
  const notes = detailAfter.json.revisions.map((r: { note: string }) => r.note);
  return {
    restoreStatus: restored.status,
    restoredQty: restored.json.quote.items[0].qty,
    restoreCount: restored.json.quote.restore_count,
    hasTaggedRevision: notes.some((n: string) => /^restore-.+-1$/.test(n)),
    hasPreRestoreSnapshot: notes.some((n: string) => n.startsWith("Sebelum restore-")),
  };
});

// ----------- revision authorization regression (security fix) -----------

scenario("creator can save a revision on own draft -> 201 and history records it", async (d) => {
  const rep = await loginCached(d, "rep@test.local", "password123");
  const quote = await createDraft(d, rep, [cleanItem()]);
  const saved = await d.api("POST", `/api/quotes/${quote.id}/revisions`, {
    body: { note: "Snapshot manual" },
    session: rep,
  });
  const detail = await d.api("GET", `/api/quotes/${quote.id}`, { session: rep });
  const hasRevision = detail.json.revisions.some((r: { note: string }) => r.note === "Snapshot manual");
  const hasAudit = detail.json.audit.some((a: { action: string }) => a.action === "revision_saved");
  return { status: saved.status, hasRevision, hasAudit };
});

scenario("a different rep cannot save a revision to another user's draft (403) and creates no revision/audit", async (d) => {
  const rep = await loginCached(d, "rep@test.local", "password123");
  const rep2 = await loginCached(d, "rep2@test.local", "password123");
  const quote = await createDraft(d, rep, [cleanItem()]);
  const before = await d.api("GET", `/api/quotes/${quote.id}`, { session: rep });
  const beforeRev = before.json.revisions.length;
  const beforeAudit = before.json.audit.length;
  const attempt = await d.api("POST", `/api/quotes/${quote.id}/revisions`, {
    body: { note: "Hijack attempt" },
    session: rep2,
  });
  const after = await d.api("GET", `/api/quotes/${quote.id}`, { session: rep });
  return {
    status: attempt.status,
    revUnchanged: beforeRev === after.json.revisions.length,
    auditUnchanged: beforeAudit === after.json.audit.length,
  };
});

scenario("assignee CAN save a revision after being reassigned", async (d) => {
  const rep = await loginCached(d, "rep@test.local", "password123");
  const rep2 = await loginCached(d, "rep2@test.local", "password123");
  const manager = await loginCached(d, "manager@test.local", "password123");
  const quote = await createDraft(d, rep, [cleanItem()]);
  const rep2User = await d.api("GET", "/api/auth/me", { session: rep2 });
  await d.api("POST", `/api/quotes/${quote.id}/reassign`, {
    body: { assigned_to: rep2User.json.user.id, note: "" },
    session: manager,
  });
  const saved = await d.api("POST", `/api/quotes/${quote.id}/revisions`, {
    body: { note: "Assignee snapshot" },
    session: rep2,
  });
  const detail = await d.api("GET", `/api/quotes/${quote.id}`, { session: rep2 });
  return {
    status: saved.status,
    hasRevision: detail.json.revisions.some((r: { note: string }) => r.note === "Assignee snapshot"),
  };
});

scenario("a manager (edit_all_quotes) CAN save a revision to another user's draft", async (d) => {
  const rep = await loginCached(d, "rep@test.local", "password123");
  const manager = await loginCached(d, "manager@test.local", "password123");
  const quote = await createDraft(d, rep, [cleanItem()]);
  const saved = await d.api("POST", `/api/quotes/${quote.id}/revisions`, {
    body: { note: "Manager snapshot" },
    session: manager,
  });
  const detail = await d.api("GET", `/api/quotes/${quote.id}`, { session: rep });
  return {
    status: saved.status,
    hasRevision: detail.json.revisions.some((r: { note: string }) => r.note === "Manager snapshot"),
  };
});

scenario("saving a revision on a submitted quote -> 409, no side effects", async (d) => {
  const rep = await loginCached(d, "rep@test.local", "password123");
  const quote = await createDraft(d, rep, [cleanItem()]);
  await d.api("POST", `/api/quotes/${quote.id}/submit`, { session: rep });
  const before = await d.api("GET", `/api/quotes/${quote.id}`, { session: rep });
  const beforeRev = before.json.revisions.length;
  const beforeAudit = before.json.audit.length;
  const attempt = await d.api("POST", `/api/quotes/${quote.id}/revisions`, {
    body: { note: "Should fail locked" },
    session: rep,
  });
  const after = await d.api("GET", `/api/quotes/${quote.id}`, { session: rep });
  return {
    status: attempt.status,
    revUnchanged: beforeRev === after.json.revisions.length,
    auditUnchanged: beforeAudit === after.json.audit.length,
  };
});

scenario("saving a revision on an approved quote -> 409 even for a manager (locked)", async (d) => {
  const manager = await loginCached(d, "manager@test.local", "password123");
  const quote = await createDraft(d, manager, [cleanItem()]);
  await d.api("POST", `/api/quotes/${quote.id}/submit`, { session: manager }); // auto-approves
  const before = await d.api("GET", `/api/quotes/${quote.id}`, { session: manager });
  const attempt = await d.api("POST", `/api/quotes/${quote.id}/revisions`, {
    body: { note: "Should fail approved" },
    session: manager,
  });
  const after = await d.api("GET", `/api/quotes/${quote.id}`, { session: manager });
  return {
    status: attempt.status,
    quoteStatus: before.json.quote.status,
    revUnchanged: before.json.revisions.length === after.json.revisions.length,
  };
});

scenario("saving a revision on a rejected quote is allowed (draft/rejected are editable)", async (d) => {
  const rep = await loginCached(d, "rep@test.local", "password123");
  const manager = await loginCached(d, "manager@test.local", "password123");
  const quote = await createDraft(d, rep, [cleanItem()], { targetMargin: 0.05, leaderMargin: 0.0 });
  await d.api("POST", `/api/quotes/${quote.id}/submit`, { session: rep });
  const decided = await d.api("POST", `/api/quotes/${quote.id}/decide`, {
    body: { decision: "rejected", note: "Margin terlalu tipis." },
    session: manager,
  });
  const saved = await d.api("POST", `/api/quotes/${quote.id}/revisions`, {
    body: { note: "Fix after rejection" },
    session: rep,
  });
  const detail = await d.api("GET", `/api/quotes/${quote.id}`, { session: rep });
  return {
    decideStatus: decided.status,
    saveStatus: saved.status,
    hasRevision: detail.json.revisions.some((r: { note: string }) => r.note === "Fix after rejection"),
  };
});

scenario("a different rep still cannot save a revision on a rejected quote they do not own (403)", async (d) => {
  const rep = await loginCached(d, "rep@test.local", "password123");
  const rep2 = await loginCached(d, "rep2@test.local", "password123");
  const manager = await loginCached(d, "manager@test.local", "password123");
  const quote = await createDraft(d, rep, [cleanItem()], { targetMargin: 0.05, leaderMargin: 0.0 });
  await d.api("POST", `/api/quotes/${quote.id}/submit`, { session: rep });
  await d.api("POST", `/api/quotes/${quote.id}/decide`, {
    body: { decision: "rejected", note: "Perlu revisi" },
    session: manager,
  });
  const before = await d.api("GET", `/api/quotes/${quote.id}`, { session: rep });
  const attempt = await d.api("POST", `/api/quotes/${quote.id}/revisions`, {
    body: { note: "Hijack rejected" },
    session: rep2,
  });
  const after = await d.api("GET", `/api/quotes/${quote.id}`, { session: rep });
  return {
    status: attempt.status,
    revUnchanged: before.json.revisions.length === after.json.revisions.length,
  };
});

// ---------------------------------------------------------------
// Run: ONE pair of backends for the whole run (Node caches the
// dynamically-imported server/db.js module by URL, so "fresh drivers
// per scenario" would silently share the first scenario's database
// instead of getting an isolated one — this single-setup shape avoids
// that entirely, and login-session caching keeps both sides under the
// real rate limiter). Every scenario appends more state (new quotes),
// but no scenario's extracted result depends on absolute ids/counts.
// ---------------------------------------------------------------

async function main() {
  const express = await makeExpressDriver();
  const worker = await makeWorkerDriver();
  for (const d of [express, worker]) {
    await d.seedUser("rep@test.local", "Rep One", "rep", "password123");
    await d.seedUser("manager@test.local", "Manager One", "manager", "password123");
    await d.seedUser("rep2@test.local", "Rep Two", "rep", "password123");
  }

  let passed = 0;
  const failures: { name: string; error: unknown }[] = [];

  for (const s of scenarios) {
    try {
      const [expressResult, workerResult] = await Promise.all([s.run(express), s.run(worker)]);
      assert.deepEqual(
        workerResult,
        expressResult,
        `parity mismatch\n  express: ${JSON.stringify(expressResult)}\n  worker:  ${JSON.stringify(workerResult)}`,
      );
      console.log(`  ok  ${s.name}`);
      passed++;
    } catch (error) {
      console.log(`FAIL  ${s.name}`);
      failures.push({ name: s.name, error });
    }
  }

  await express.teardown();
  await worker.teardown();

  console.log(`\n${passed}/${scenarios.length} passed.`);
  if (failures.length) {
    console.log("\nFailures:\n");
    for (const f of failures) {
      console.log(`- ${f.name}`);
      console.log(`  ${f.error instanceof Error ? f.error.message : String(f.error)}`);
    }
    process.exitCode = 1;
  }
}

main();
