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
  const { run } = await import("../server/db.js");

  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(loadUser);
  app.use("/api/auth", authRouter);
  app.use("/api/quotes", quotesRouter);

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
  for (const file of ["0001_init.sql", "0002_consistency.sql", "0003_password_reset_requests.sql"]) {
    sqlite.exec(readFileSync(path.join(migrationsDir, file), "utf8"));
  }
  const db = new D1DatabaseShim(sqlite) as unknown as D1Database;

  const { Hono } = await import("hono");
  const { hashPassword, loadUser } = await import("../server/worker/auth.js");
  const { authRouter } = await import("../server/worker/routes/auth.js");
  const { quotesRouter } = await import("../server/worker/routes/quotes.js");
  const { run } = await import("../server/db.d1.js");

  const app = new Hono();
  app.use(loadUser);
  app.route("/api/auth", authRouter);
  app.route("/api/quotes", quotesRouter);

  const env = {
    DB: db,
    JWT_SECRET: "test-only-secret-not-for-production-0000000000",
    NODE_ENV: "test",
    AUTH_LIMITER: new AlwaysAllowRateLimit() as unknown as RateLimit,
    ASSISTANT_LIMITER: new AlwaysAllowRateLimit() as unknown as RateLimit,
  };

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
