/* ============================================================
   A minimal D1Database shim backed by node:sqlite, used only by
   scripts/test-backend-parity.ts.

   This is not a Workers runtime emulator (no isolates, no real HTTP
   edge) — it exists purely so the *actual* server/worker/*.ts route
   and service files can run against a real SQLite engine outside of
   `wrangler dev`, for a fast, deterministic parity check against the
   Express/node:sqlite backend. D1 is itself SQLite under the hood, so
   statement semantics (placeholders, UNIQUE errors, last_row_id,
   changes) line up directly.
   ============================================================ */

import { DatabaseSync } from "node:sqlite";

type Param = string | number | null | boolean;

function bindable(params: Param[]) {
  // SQLite has no boolean type; D1's client accepts booleans and stores 0/1.
  return params.map((p) => (typeof p === "boolean" ? (p ? 1 : 0) : p));
}

class D1StatementShim implements Partial<D1PreparedStatement> {
  constructor(
    private db: DatabaseSync,
    private sql: string,
    private params: Param[] = [],
  ) {}

  bind(...params: Param[]): D1PreparedStatement {
    return new D1StatementShim(this.db, this.sql, params) as unknown as D1PreparedStatement;
  }

  async all<T = unknown>(): Promise<D1Result<T>> {
    const results = this.db.prepare(this.sql).all(...bindable(this.params)) as T[];
    return { results, success: true, meta: {} as never } as D1Result<T>;
  }

  async first<T = unknown>(): Promise<T | null> {
    const row = this.db.prepare(this.sql).get(...bindable(this.params));
    return (row ?? null) as T | null;
  }

  async run<T = unknown>(): Promise<D1Result<T>> {
    const info = this.db.prepare(this.sql).run(...bindable(this.params));
    return {
      results: [],
      success: true,
      meta: {
        last_row_id: Number(info.lastInsertRowid),
        changes: Number(info.changes),
      } as never,
    } as D1Result<T>;
  }
}

export class D1DatabaseShim implements Partial<D1Database> {
  constructor(private db: DatabaseSync) {}

  prepare(sql: string): D1PreparedStatement {
    return new D1StatementShim(this.db, sql) as unknown as D1PreparedStatement;
  }

  async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    this.db.exec("BEGIN");
    try {
      const results: D1Result<T>[] = [];
      for (const s of statements) results.push(await (s.run() as Promise<D1Result<T>>));
      this.db.exec("COMMIT");
      return results;
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }
}

/** Always-allow rate limiter — parity here is about business logic, not edge throttling. */
export class AlwaysAllowRateLimit implements Partial<RateLimit> {
  async limit(): Promise<RateLimitOutcome> {
    return { success: true } as RateLimitOutcome;
  }
}
