import { Hono } from "hono";
import { z } from "zod";
import { all, get, run, stmt, batch } from "../../db.d1";
import { audit, auditFor } from "../audit";
import { requireAuth, requirePermission } from "../auth";
import { hasPermission } from "../../../shared/permissions";
import { snapshotSchema, zodMessage } from "../../validate";
import {
  EDITABLE_STATUSES,
  STATUS_FLOW,
  breachesFor,
  findQuote,
  listQuoteRows,
  nextQuoteNumber,
  quoteMetrics,
  saveRevision,
} from "../quoteService";
import { isWithinPolicy } from "../../../shared/policy";
import { DEFAULT_ASSUMPTIONS, DEFAULT_REGIONS } from "../../../shared/engine";
import {
  notifyQuoteDecided,
  notifyQuoteReassigned,
  notifyQuoteReassignedAway,
  notifyQuoteSubmitted,
} from "../notify";
import type { Client, QuoteSnapshot, QuoteStatus, User } from "../../../shared/types";
import type { Env } from "../env";

export const quotesRouter = new Hono<Env>();
quotesRouter.use(requireAuth);

/** Reps may only change their own quotes or one reassigned to them; managers/admins may change any. */
function canEdit(user: User, createdBy: number, assignedTo: number | null): boolean {
  return user.id === createdBy || user.id === assignedTo || hasPermission(user.role, "edit_all_quotes");
}

function slugify(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-+|-+$)/g, "");
}

quotesRouter.get("/", async (c) => {
  const user = c.get("user")!;
  const status = (c.req.query("status") ?? "").trim();
  const mine = c.req.query("mine") === "1";
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (status && status !== "all") {
    where.push("q.status = ?");
    params.push(status);
  }
  if (mine) {
    // Includes quotes reassigned TO this user, not just ones they created —
    // otherwise a reassigned quote silently drops out of the assignee's own list.
    where.push("(q.created_by = ? OR q.assigned_to = ?)");
    params.push(user.id, user.id);
  }
  const userIdParam = (c.req.query("user_id") ?? "").trim();
  if (userIdParam) {
    const uid = Number(userIdParam);
    if (Number.isFinite(uid)) {
      where.push("q.created_by = ?");
      params.push(uid);
    }
  }
  const quotes = await listQuoteRows(c.env.DB, where.length ? `WHERE ${where.join(" AND ")}` : "", ...params);
  return c.json({
    quotes: quotes.map((q) => {
      const { monthly_value, net_margin } = quoteMetrics(q);
      return {
        id: q.id,
        number: q.number,
        title: q.title,
        client_name: q.client_name ?? null,
        status: q.status,
        scenario: q.scenario,
        rev_no: q.rev_no,
        created_by_name: q.created_by_name ?? "",
        updated_at: q.updated_at,
        item_count: q.items.length,
        monthly_value,
        net_margin,
      };
    }),
  });
});

/** Users a manager/admin can reassign a quote to (for the "responsible person is absent" flow). */
quotesRouter.get("/users/assignable", requirePermission("decide_quotes"), async (c) => {
  const users = await all<Pick<User, "id" | "name" | "role">>(
    c.env.DB,
    "SELECT id, name, role FROM users WHERE active = 1 ORDER BY name",
  );
  return c.json({ users });
});

quotesRouter.get("/:id", async (c) => {
  const user = c.get("user")!;
  const id = Number(c.req.param("id"));
  const quote = await findQuote(c.env.DB, id);
  if (!quote) return c.json({ error: "Quotation tidak ditemukan." }, 404);

  const revisions = await all(
    c.env.DB,
    `SELECT r.id, r.rev_no, r.note, r.created_at, u.name AS created_by_name
       FROM quote_revisions r LEFT JOIN users u ON u.id = r.created_by
      WHERE r.quote_id = ? ORDER BY r.id DESC`,
    id,
  );
  const approvalRows = await all<any>(
    c.env.DB,
    `SELECT a.id, a.decision, a.note, a.requested_at, a.decided_at, a.breaches,
            a.monthly_value, a.net_margin,
            ru.name AS requested_by_name, du.name AS decided_by_name
       FROM approvals a
       LEFT JOIN users ru ON ru.id = a.requested_by
       LEFT JOIN users du ON du.id = a.decided_by
      WHERE a.quote_id = ? ORDER BY a.id DESC`,
    id,
  );
  const approvals = approvalRows.map((a) => ({ ...a, breaches: JSON.parse(a.breaches || "[]") }));

  return c.json({
    quote,
    revisions,
    approvals,
    audit: await auditFor(c.env.DB, "quote", id, 60),
    policy: await breachesFor(c.env.DB, quote),
    canEdit: canEdit(user, quote.created_by, quote.assigned_to) && EDITABLE_STATUSES.includes(quote.status),
  });
});

quotesRouter.post("/", async (c) => {
  const user = c.get("user")!;
  const parsed = z
    .object({
      title: z.string().min(1).max(200),
      client_id: z.number().int().nullable().optional(),
      snapshot: snapshotSchema.partial().optional(),
    })
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: zodMessage(parsed.error) }, 400);

  const client = parsed.data.client_id
    ? await get<Client>(c.env.DB, "SELECT * FROM clients WHERE id = ?", parsed.data.client_id)
    : undefined;

  // nextQuoteNumber() reads then this insert writes, with an await in between —
  // two concurrent requests can read the same number before either inserts.
  // Retry with a fresh number if the UNIQUE constraint on quotes.number trips.
  let number = await nextQuoteNumber(c.env.DB);
  let id: number | undefined;
  let snapshot: QuoteSnapshot | undefined;
  for (let attempt = 0; attempt < 5; attempt++) {
    snapshot = {
      assumptions: parsed.data.snapshot?.assumptions ?? DEFAULT_ASSUMPTIONS,
      items: parsed.data.snapshot?.items ?? [],
      regions: parsed.data.snapshot?.regions ?? DEFAULT_REGIONS,
      scenario: parsed.data.snapshot?.scenario ?? 1,
      meta: parsed.data.snapshot?.meta ?? {
        quoteNo: number,
        date: new Date().toISOString().slice(0, 10),
        validity: 30,
        payment: client?.payment_terms || "30 hari setelah invoice",
        delivery: client?.delivery_terms || "Franco Jakarta, jadwal mingguan",
        notes: "",
        preparedBy: user.name,
      },
    };
    try {
      const info = await run(
        c.env.DB,
        `INSERT INTO quotes(number, title, client_id, status, scenario, rev_no,
                            assumptions, items, regions, meta, created_by)
         VALUES(?, ?, ?, 'draft', ?, 1, ?, ?, ?, ?, ?)`,
        number,
        parsed.data.title,
        parsed.data.client_id ?? null,
        snapshot.scenario,
        JSON.stringify(snapshot.assumptions),
        JSON.stringify(snapshot.items),
        JSON.stringify(snapshot.regions),
        JSON.stringify(snapshot.meta),
        user.id,
      );
      id = Number(info.meta.last_row_id);
      break;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (attempt === 4 || !message.includes("UNIQUE constraint failed: quotes.number")) throw err;
      number = await nextQuoteNumber(c.env.DB);
    }
  }
  await saveRevision(c.env.DB, id!, 1, snapshot!, user.id, "Dibuat");

  await audit(c.env.DB, user.id, "quote", id!, "created", { number, title: parsed.data.title });
  return c.json({ quote: await findQuote(c.env.DB, id!) }, 201);
});

quotesRouter.put("/:id", async (c) => {
  const user = c.get("user")!;
  const id = Number(c.req.param("id"));
  const existing = await findQuote(c.env.DB, id);
  if (!existing) return c.json({ error: "Quotation tidak ditemukan." }, 404);
  if (!canEdit(user, existing.created_by, existing.assigned_to)) return c.json({ error: "Quotation ini milik pengguna lain." }, 403);
  if (!EDITABLE_STATUSES.includes(existing.status)) {
    return c.json(
      { error: `Quotation berstatus ${existing.status} terkunci. Buka kembali sebagai revisi baru untuk mengubahnya.` },
      409,
    );
  }
  const parsed = z
    .object({
      title: z.string().min(1).max(200).optional(),
      client_id: z.number().int().nullable().optional(),
      snapshot: snapshotSchema,
      expected_version: z.number().int(),
    })
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: zodMessage(parsed.error) }, 400);

  const s = parsed.data.snapshot;
  const result = await run(
    c.env.DB,
    `UPDATE quotes SET title = COALESCE(?, title), client_id = ?, scenario = ?,
            assumptions = ?, items = ?, regions = ?, meta = ?,
            version = version + 1, updated_at = datetime('now')
      WHERE id = ? AND version = ?`,
    parsed.data.title ?? null,
    parsed.data.client_id === undefined ? existing.client_id : parsed.data.client_id,
    s.scenario,
    JSON.stringify(s.assumptions),
    JSON.stringify(s.items),
    JSON.stringify(s.regions),
    JSON.stringify(s.meta),
    id,
    parsed.data.expected_version,
  );
  if (result.meta.changes === 0) {
    return c.json(
      {
        error: "Quotation ini sudah diubah pengguna lain. Muat ulang untuk melihat versi terbaru.",
        quote: await findQuote(c.env.DB, id),
      },
      409,
    );
  }
  return c.json({ quote: await findQuote(c.env.DB, id) });
});

/** Explicit named snapshot, so a rep can bookmark a version before experimenting. */
quotesRouter.post("/:id/revisions", async (c) => {
  const user = c.get("user")!;
  const id = Number(c.req.param("id"));
  const quote = await findQuote(c.env.DB, id);
  if (!quote) return c.json({ error: "Quotation tidak ditemukan." }, 404);

  const body = await c.req.json().catch(() => ({}));
  const note = String(body?.note ?? "Snapshot manual").slice(0, 200);
  await saveRevision(c.env.DB, id, quote.rev_no, quote, user.id, note);
  await audit(c.env.DB, user.id, "quote", id, "revision_saved", { note });
  return c.json({ ok: true }, 201);
});

quotesRouter.post("/:id/restore/:revisionId", async (c) => {
  const user = c.get("user")!;
  const id = Number(c.req.param("id"));
  const quote = await findQuote(c.env.DB, id);
  if (!quote) return c.json({ error: "Quotation tidak ditemukan." }, 404);
  if (!canEdit(user, quote.created_by, quote.assigned_to) || !EDITABLE_STATUSES.includes(quote.status)) {
    return c.json({ error: "Quotation harus berstatus draft untuk dipulihkan." }, 409);
  }
  const rev = await get<{ snapshot: string; rev_no: number }>(
    c.env.DB,
    "SELECT snapshot, rev_no FROM quote_revisions WHERE id = ? AND quote_id = ?",
    Number(c.req.param("revisionId")),
    id,
  );
  if (!rev) return c.json({ error: "Revisi tidak ditemukan." }, 404);

  const s = JSON.parse(rev.snapshot) as QuoteSnapshot;
  const client = quote.client_id
    ? await get<{ code: string }>(c.env.DB, "SELECT code FROM clients WHERE id = ?", quote.client_id)
    : undefined;
  const restoreNo = quote.restore_count + 1;
  const tag = `restore-${slugify(client?.code || quote.client_name || "unassigned") || "unassigned"}-${restoreNo}`;

  await batch(c.env.DB, [
    // Snapshot what was there before the overwrite, so an accidental restore
    // doesn't silently discard unsaved draft content with no way back.
    stmt(
      c.env.DB,
      "INSERT INTO quote_revisions(quote_id, rev_no, snapshot, note, created_by) VALUES(?, ?, ?, ?, ?)",
      id,
      quote.rev_no,
      JSON.stringify(quote),
      `Sebelum ${tag}`,
      user.id,
    ),
    stmt(
      c.env.DB,
      `UPDATE quotes SET scenario = ?, assumptions = ?, items = ?, regions = ?, meta = ?,
              version = version + 1, restore_count = ?, updated_at = datetime('now') WHERE id = ?`,
      s.scenario ?? quote.scenario,
      JSON.stringify(s.assumptions),
      JSON.stringify(s.items),
      JSON.stringify(s.regions),
      JSON.stringify(s.meta),
      restoreNo,
      id,
    ),
    stmt(
      c.env.DB,
      "INSERT INTO quote_revisions(quote_id, rev_no, snapshot, note, created_by) VALUES(?, ?, ?, ?, ?)",
      id,
      quote.rev_no,
      JSON.stringify(s),
      tag,
      user.id,
    ),
  ]);
  await audit(c.env.DB, user.id, "quote", id, "restored", { from_rev: rev.rev_no, tag });
  return c.json({ quote: await findQuote(c.env.DB, id) });
});

/** Hand a quote to another active user — manager/admin only, e.g. when the
 * responsible person is absent. Grants the new assignee edit rights alongside
 * (not instead of) the original creator. */
quotesRouter.post("/:id/reassign", requirePermission("decide_quotes"), async (c) => {
  const user = c.get("user")!;
  const id = Number(c.req.param("id"));
  const quote = await findQuote(c.env.DB, id);
  if (!quote) return c.json({ error: "Quotation tidak ditemukan." }, 404);

  const parsed = z
    .object({ assigned_to: z.number().int().nullable(), note: z.string().max(500).default("") })
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: zodMessage(parsed.error) }, 400);

  if (parsed.data.assigned_to === quote.assigned_to) {
    // No actual change (e.g. re-picking the current assignee) — skip the
    // history entry and notifications so they aren't sent for nothing.
    return c.json({ quote });
  }
  let target: User | undefined;
  if (parsed.data.assigned_to !== null) {
    target = await get<User>(c.env.DB, "SELECT * FROM users WHERE id = ? AND active = 1", parsed.data.assigned_to);
    if (!target) return c.json({ error: "Pengguna tujuan tidak ditemukan atau tidak aktif." }, 400);
  }
  // Whoever was responsible before this change — the previous assignee, or
  // the creator if no one had been assigned yet — so they're told the quote
  // moved off their plate, not just the person receiving it.
  const previousOwnerId = quote.assigned_to ?? quote.created_by;
  const previousOwner =
    previousOwnerId !== user.id && previousOwnerId !== target?.id
      ? await get<User>(c.env.DB, "SELECT * FROM users WHERE id = ?", previousOwnerId)
      : undefined;

  const historyNote = target
    ? `Dialihkan ke ${target.name}${parsed.data.note ? `: ${parsed.data.note}` : ""}`
    : `Penugasan dilepas${parsed.data.note ? `: ${parsed.data.note}` : ""}`;

  await batch(c.env.DB, [
    stmt(
      c.env.DB,
      "UPDATE quotes SET assigned_to = ?, updated_at = datetime('now') WHERE id = ?",
      parsed.data.assigned_to,
      id,
    ),
    stmt(
      c.env.DB,
      "INSERT INTO quote_revisions(quote_id, rev_no, snapshot, note, created_by) VALUES(?, ?, ?, ?, ?)",
      id,
      quote.rev_no,
      JSON.stringify(quote),
      historyNote,
      user.id,
    ),
  ]);
  await audit(c.env.DB, user.id, "quote", id, "reassigned", { to: parsed.data.assigned_to, note: parsed.data.note });

  if (target) {
    c.executionCtx.waitUntil(
      notifyQuoteReassigned(c.env, {
        recipient: { name: target.name, email: target.email, phone: target.phone },
        quoteNumber: quote.number,
        quoteTitle: quote.title,
        reassignedBy: user.name,
        note: parsed.data.note,
        quoteId: id,
      }),
    );
  }
  if (previousOwner) {
    c.executionCtx.waitUntil(
      notifyQuoteReassignedAway(c.env, {
        recipient: { name: previousOwner.name, email: previousOwner.email, phone: previousOwner.phone },
        quoteNumber: quote.number,
        quoteTitle: quote.title,
        reassignedBy: user.name,
        newOwnerName: target?.name ?? null,
        note: parsed.data.note,
        quoteId: id,
      }),
    );
  }
  return c.json({ quote: await findQuote(c.env.DB, id) });
});

/* ---------------- approval workflow ---------------- */

quotesRouter.post("/:id/submit", async (c) => {
  const user = c.get("user")!;
  const id = Number(c.req.param("id"));
  const quote = await findQuote(c.env.DB, id);
  if (!quote) return c.json({ error: "Quotation tidak ditemukan." }, 404);
  if (!canEdit(user, quote.created_by, quote.assigned_to)) return c.json({ error: "Quotation ini milik pengguna lain." }, 403);
  if (!EDITABLE_STATUSES.includes(quote.status)) return c.json({ error: "Hanya draft yang bisa diajukan." }, 409);

  const { breaches, monthly_value, net_margin } = await breachesFor(c.env.DB, quote);
  const clean = isWithinPolicy(breaches);
  // A manager submitting a quote that breaks no rule is approved on the spot.
  const autoApprove = clean && hasPermission(user.role, "decide_quotes");
  const now = new Date().toISOString();

  await batch(c.env.DB, [
    stmt(
      c.env.DB,
      `INSERT INTO approvals(quote_id, requested_by, decision, breaches, monthly_value, net_margin,
                             decided_by, decided_at, note)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      user.id,
      autoApprove ? "approved" : "pending",
      JSON.stringify(breaches),
      monthly_value,
      net_margin,
      autoApprove ? user.id : null,
      autoApprove ? now : null,
      autoApprove ? "Otomatis disetujui: seluruh angka di dalam kebijakan." : null,
    ),
    stmt(
      c.env.DB,
      `UPDATE quotes SET status = ?, approved_by = ?, approved_at = ?, updated_at = datetime('now')
        WHERE id = ?`,
      autoApprove ? "approved" : "submitted",
      autoApprove ? user.id : null,
      autoApprove ? now : null,
      id,
    ),
    stmt(
      c.env.DB,
      "INSERT INTO quote_revisions(quote_id, rev_no, snapshot, note, created_by) VALUES(?, ?, ?, ?, ?)",
      id,
      quote.rev_no,
      JSON.stringify(quote),
      autoApprove ? "Disetujui" : "Diajukan",
      user.id,
    ),
  ]);

  await audit(c.env.DB, user.id, "quote", id, autoApprove ? "auto_approved" : "submitted", {
    breaches: breaches.map((b) => b.code),
    monthly_value,
    net_margin,
  });

  if (!autoApprove) {
    // Only the actual decision-maker (manager) gets the "needs your action"
    // email — admin still has decide_quotes for coverage/escalation, but
    // routing this to every admin as well just spams the people who are
    // meant to be monitoring, not approving on every quote.
    const recipients = await all<{ name: string; email: string; phone: string }>(
      c.env.DB,
      `SELECT name, email, phone FROM users WHERE role = 'manager' AND active = 1`,
    );
    // waitUntil: the response below returns before this settles, and Workers
    // don't keep running background work past that point unless extended.
    c.executionCtx.waitUntil(
      notifyQuoteSubmitted(c.env, {
        recipients,
        quoteNumber: quote.number,
        quoteTitle: quote.title,
        submittedBy: user.name,
        quoteId: id,
      }),
    );
  }

  return c.json({ quote: await findQuote(c.env.DB, id), breaches, autoApproved: autoApprove });
});

quotesRouter.post("/:id/decide", requirePermission("decide_quotes"), async (c) => {
  const user = c.get("user")!;
  const id = Number(c.req.param("id"));
  const quote = await findQuote(c.env.DB, id);
  if (!quote) return c.json({ error: "Quotation tidak ditemukan." }, 404);
  if (quote.status !== "submitted") return c.json({ error: "Quotation ini tidak sedang menunggu persetujuan." }, 409);

  const parsed = z
    .object({ decision: z.enum(["approved", "rejected"]), note: z.string().max(1000).default("") })
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: zodMessage(parsed.error) }, 400);
  // A rejection must say why, so the rep knows what to change.
  if (parsed.data.decision === "rejected" && !parsed.data.note.trim()) {
    return c.json({ error: "Penolakan wajib disertai alasan." }, 400);
  }
  const pending = await get<{ id: number }>(
    c.env.DB,
    "SELECT id FROM approvals WHERE quote_id = ? AND decision = 'pending' ORDER BY id DESC LIMIT 1",
    id,
  );
  const now = new Date().toISOString();

  const statements = [];
  if (pending) {
    statements.push(
      stmt(
        c.env.DB,
        "UPDATE approvals SET decision = ?, decided_by = ?, decided_at = ?, note = ? WHERE id = ?",
        parsed.data.decision,
        user.id,
        now,
        parsed.data.note,
        pending.id,
      ),
    );
  }
  statements.push(
    stmt(
      c.env.DB,
      `UPDATE quotes SET status = ?, approved_by = ?, approved_at = ?, decision_note = ?,
              updated_at = datetime('now') WHERE id = ?`,
      parsed.data.decision,
      parsed.data.decision === "approved" ? user.id : null,
      parsed.data.decision === "approved" ? now : null,
      parsed.data.note,
      id,
    ),
    stmt(
      c.env.DB,
      "INSERT INTO quote_revisions(quote_id, rev_no, snapshot, note, created_by) VALUES(?, ?, ?, ?, ?)",
      id,
      quote.rev_no,
      JSON.stringify(quote),
      parsed.data.decision === "approved" ? "Disetujui" : "Ditolak",
      user.id,
    ),
  );
  await batch(c.env.DB, statements);

  await audit(c.env.DB, user.id, "quote", id, parsed.data.decision, { note: parsed.data.note });

  const submitter = await get<{ name: string; email: string; phone: string }>(
    c.env.DB,
    "SELECT name, email, phone FROM users WHERE id = ?",
    quote.created_by,
  );
  if (submitter) {
    c.executionCtx.waitUntil(
      notifyQuoteDecided(c.env, {
        recipient: submitter,
        quoteNumber: quote.number,
        quoteTitle: quote.title,
        decision: parsed.data.decision,
        decidedBy: user.name,
        note: parsed.data.note,
        quoteId: id,
      }),
    );
  }

  return c.json({ quote: await findQuote(c.env.DB, id) });
});

quotesRouter.post("/:id/status", async (c) => {
  const user = c.get("user")!;
  const id = Number(c.req.param("id"));
  const quote = await findQuote(c.env.DB, id);
  if (!quote) return c.json({ error: "Quotation tidak ditemukan." }, 404);
  if (!canEdit(user, quote.created_by, quote.assigned_to)) return c.json({ error: "Quotation ini milik pengguna lain." }, 403);

  const body = await c.req.json().catch(() => ({}));
  const next = String(body?.status ?? "") as QuoteStatus;
  const allowed = STATUS_FLOW[quote.status] ?? [];
  if (!allowed.includes(next)) {
    return c.json({ error: `Status ${quote.status} tidak bisa langsung menjadi ${next}.` }, 409);
  }
  await run(c.env.DB, "UPDATE quotes SET status = ?, updated_at = datetime('now') WHERE id = ?", next, id);
  await audit(c.env.DB, user.id, "quote", id, `status_${next}`);
  return c.json({ quote: await findQuote(c.env.DB, id) });
});

/** Unlocks a decided quote as a new revision, preserving the approved history. */
quotesRouter.post("/:id/reopen", async (c) => {
  const user = c.get("user")!;
  const id = Number(c.req.param("id"));
  const quote = await findQuote(c.env.DB, id);
  if (!quote) return c.json({ error: "Quotation tidak ditemukan." }, 404);
  if (!canEdit(user, quote.created_by, quote.assigned_to)) return c.json({ error: "Quotation ini milik pengguna lain." }, 403);
  if (quote.status === "draft") return c.json({ error: "Quotation sudah berstatus draft." }, 409);

  const nextRev = quote.rev_no + 1;
  const statements = [
    stmt(
      c.env.DB,
      "INSERT INTO quote_revisions(quote_id, rev_no, snapshot, note, created_by) VALUES(?, ?, ?, ?, ?)",
      id,
      quote.rev_no,
      JSON.stringify(quote),
      `Ditutup sebagai revisi ${quote.rev_no}`,
      user.id,
    ),
    stmt(
      c.env.DB,
      `UPDATE quotes SET status = 'draft', rev_no = ?, approved_by = NULL, approved_at = NULL,
              decision_note = NULL, updated_at = datetime('now') WHERE id = ?`,
      nextRev,
      id,
    ),
  ];
  if (quote.status === "submitted") {
    // Reopening a quote that's still awaiting a decision voids that
    // request — otherwise it lingers forever in the manager's pending
    // queue, pointing at content that's already back in draft.
    statements.push(stmt(c.env.DB, "DELETE FROM approvals WHERE quote_id = ? AND decision = 'pending'", id));
  }
  await batch(c.env.DB, statements);
  await audit(c.env.DB, user.id, "quote", id, "reopened", { rev_no: nextRev });
  return c.json({ quote: await findQuote(c.env.DB, id) });
});

quotesRouter.delete("/:id", async (c) => {
  const user = c.get("user")!;
  const id = Number(c.req.param("id"));
  const quote = await findQuote(c.env.DB, id);
  if (!quote) return c.json({ error: "Quotation tidak ditemukan." }, 404);

  const isOwnDraft = quote.created_by === user.id && quote.status === "draft";
  if (!isOwnDraft && !hasPermission(user.role, "delete_quotes")) {
    return c.json({ error: "Hanya draft milik sendiri yang bisa dihapus. Selain itu perlu admin." }, 403);
  }
  await run(c.env.DB, "DELETE FROM quotes WHERE id = ?", id);
  await audit(c.env.DB, user.id, "quote", id, "deleted", { number: quote.number });
  return c.json({ ok: true });
});
