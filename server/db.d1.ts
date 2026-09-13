/* ============================================================
   D1 persistence layer — Cloudflare Workers replacement for db.ts.

   D1 is entirely async and has no interactive transactions (BEGIN/
   COMMIT/ROLLBACK): only `batch()`, a list of statements committed
   atomically with no reads in between. Callers that need to read
   before deciding what to write (e.g. the catalog import upsert)
   cannot use `batch()` and must express the logic as a single SQL
   statement instead (e.g. INSERT ... ON CONFLICT DO UPDATE).

   D1Database is passed in explicitly rather than held as a module
   global: Workers only expose bindings through the per-request `env`
   argument, so callers thread `env.DB` down to these helpers.
   ============================================================ */

type Param = string | number | null | boolean;

export async function all<T = Record<string, unknown>>(
  d1: D1Database,
  sql: string,
  ...params: Param[]
): Promise<T[]> {
  const { results } = await d1.prepare(sql).bind(...params).all<T>();
  return results;
}

export async function get<T = Record<string, unknown>>(
  d1: D1Database,
  sql: string,
  ...params: Param[]
): Promise<T | undefined> {
  const row = await d1.prepare(sql).bind(...params).first<T>();
  return row ?? undefined;
}

export async function run(d1: D1Database, sql: string, ...params: Param[]): Promise<D1Result> {
  return d1.prepare(sql).bind(...params).run();
}

/** One statement, pre-bound, for use with batch(). */
export function stmt(d1: D1Database, sql: string, ...params: Param[]): D1PreparedStatement {
  return d1.prepare(sql).bind(...params);
}

/**
 * Runs a list of pre-bound statements atomically. Replaces the
 * callback-style tx() from db.ts — batch() cannot interleave reads,
 * so every statement must be prepared up front.
 */
export async function batch(d1: D1Database, statements: D1PreparedStatement[]): Promise<D1Result[]> {
  return d1.batch(statements);
}

export async function getSetting<T>(d1: D1Database, key: string, fallback: T): Promise<T> {
  const row = await get<{ value: string }>(d1, "SELECT value FROM settings WHERE key = ?", key);
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}

export async function setSetting(d1: D1Database, key: string, value: unknown): Promise<void> {
  await run(
    d1,
    "INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    key,
    JSON.stringify(value),
  );
}
