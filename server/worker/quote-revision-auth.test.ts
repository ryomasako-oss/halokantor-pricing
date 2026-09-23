// @ts-nocheck
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import path from "node:path";
import { D1DatabaseShim } from "../../scripts/d1-sqlite-shim.js";

describe("Worker revision conditional insert (TOCTOU guard)", () => {
  it("conditional INSERT blocks locked status and creates no revision", async () => {
    const sqlite = new DatabaseSync(":memory:");
    const migrationsDir = path.resolve(import.meta.dirname, "../../migrations");
    for (const file of ["0001_init.sql", "0002_consistency.sql", "0003_password_reset_requests.sql", "0004_user_phone.sql", "0005_reassignment_and_restore.sql", "0006_uom_options.sql"]) {
      sqlite.exec(readFileSync(path.join(migrationsDir, file), "utf8"));
    }
    const db = new D1DatabaseShim(sqlite) as unknown as D1Database;
    const { run, get } = await import("../db.d1.js");
    const { hashPassword } = await import("./auth.js");

    await run(db, `INSERT INTO users(email, name, password_hash, role) VALUES(?, ?, ?, ?)`, "owner@test.local", "Owner", await hashPassword("password123"), "rep");
    const user = await get(db, `SELECT id FROM users WHERE email = ?`, "owner@test.local");
    const userId = user.id;

    sqlite.exec(`INSERT INTO quotes(number, title, status, scenario, rev_no, assumptions, items, regions, meta, created_by) VALUES('HK/SIP/Q/2601/001', 'Race', 'draft', 1, 1, '[]', '[]', '[]', '{}', ${userId})`);
    const quoteRow = await get(db, `SELECT id, rev_no, status FROM quotes WHERE number = ?`, "HK/SIP/Q/2601/001");
    const qid = quoteRow.id;

    // Concurrent lock before revision insert
    await run(db, `UPDATE quotes SET status = 'submitted' WHERE id = ?`, qid);

    const result = await run(db, `INSERT INTO quote_revisions(quote_id, rev_no, snapshot, note, created_by) SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM quotes WHERE id = ? AND status IN ('draft','rejected') AND (created_by = ? OR assigned_to = ? OR ? = 1))`, qid, 1, JSON.stringify({}), "race", userId, qid, userId, userId, 0);
    expect(result.meta.changes).toBe(0);
    const revCount = await get(db, `SELECT COUNT(*) as c FROM quote_revisions WHERE quote_id = ?`, qid);
    expect(revCount.c).toBe(0);
  });

  it("conditional INSERT allows draft for owner and creates one revision", async () => {
    const sqlite = new DatabaseSync(":memory:");
    const migrationsDir = path.resolve(import.meta.dirname, "../../migrations");
    for (const file of ["0001_init.sql", "0002_consistency.sql", "0003_password_reset_requests.sql", "0004_user_phone.sql", "0005_reassignment_and_restore.sql", "0006_uom_options.sql"]) {
      sqlite.exec(readFileSync(path.join(migrationsDir, file), "utf8"));
    }
    const db = new D1DatabaseShim(sqlite) as unknown as D1Database;
    const { run, get } = await import("../db.d1.js");
    const { hashPassword } = await import("./auth.js");

    await run(db, `INSERT INTO users(email, name, password_hash, role) VALUES(?, ?, ?, ?)`, "owner2@test.local", "Owner2", await hashPassword("password123"), "rep");
    const user = await get(db, `SELECT id FROM users WHERE email = ?`, "owner2@test.local");
    const userId = user.id;

    sqlite.exec(`INSERT INTO quotes(number, title, status, scenario, rev_no, assumptions, items, regions, meta, created_by) VALUES('HK/SIP/Q/2601/002', 'Race2', 'draft', 1, 1, '[]', '[]', '[]', '{}', ${userId})`);
    const quoteRow = await get(db, `SELECT id FROM quotes WHERE number = ?`, "HK/SIP/Q/2601/002");
    const qid = quoteRow.id;

    const result = await run(db, `INSERT INTO quote_revisions(quote_id, rev_no, snapshot, note, created_by) SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM quotes WHERE id = ? AND status IN ('draft','rejected') AND (created_by = ? OR assigned_to = ? OR ? = 1))`, qid, 1, JSON.stringify({}), "ok", userId, qid, userId, userId, 0);
    expect(result.meta.changes).toBe(1);
  });

  it("conditional INSERT blocks non-owner without edit_all_quotes", async () => {
    const sqlite = new DatabaseSync(":memory:");
    const migrationsDir = path.resolve(import.meta.dirname, "../../migrations");
    for (const file of ["0001_init.sql", "0002_consistency.sql", "0003_password_reset_requests.sql", "0004_user_phone.sql", "0005_reassignment_and_restore.sql", "0006_uom_options.sql"]) {
      sqlite.exec(readFileSync(path.join(migrationsDir, file), "utf8"));
    }
    const db = new D1DatabaseShim(sqlite) as unknown as D1Database;
    const { run, get } = await import("../db.d1.js");
    const { hashPassword } = await import("./auth.js");

    await run(db, `INSERT INTO users(email, name, password_hash, role) VALUES(?, ?, ?, ?)`, "owner3@test.local", "Owner", await hashPassword("password123"), "rep");
    await run(db, `INSERT INTO users(email, name, password_hash, role) VALUES(?, ?, ?, ?)`, "other@test.local", "Other", await hashPassword("password123"), "rep");
    const owner = await get(db, `SELECT id FROM users WHERE email = ?`, "owner3@test.local");
    const other = await get(db, `SELECT id FROM users WHERE email = ?`, "other@test.local");
    sqlite.exec(`INSERT INTO quotes(number, title, status, scenario, rev_no, assumptions, items, regions, meta, created_by) VALUES('HK/SIP/Q/2601/003', 'Race3', 'draft', 1, 1, '[]', '[]', '[]', '{}', ${owner.id})`);
    const quoteRow = await get(db, `SELECT id FROM quotes WHERE number = ?`, "HK/SIP/Q/2601/003");
    const qid = quoteRow.id;

    const result = await run(db, `INSERT INTO quote_revisions(quote_id, rev_no, snapshot, note, created_by) SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM quotes WHERE id = ? AND status IN ('draft','rejected') AND (created_by = ? OR assigned_to = ? OR ? = 1))`, qid, 1, JSON.stringify({}), "hijack", other.id, qid, other.id, other.id, 0);
    expect(result.meta.changes).toBe(0);
  });
});
