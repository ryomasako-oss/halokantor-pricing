import { Router } from "express";
import { z } from "zod";
import { all, get, run, tx } from "../db.js";
import { audit, auditFor } from "../audit.js";
import { type AuthedRequest, requireAuth, requirePermission } from "../auth.js";
import { hasPermission } from "../../shared/permissions.js";
import { snapshotSchema, zodMessage } from "../validate.js";
import {
  EDITABLE_STATUSES,
  STATUS_FLOW,
  breachesFor,
  findQuote,
  listQuoteRows,
  nextQuoteNumber,
  quoteMetrics,
  saveRevision,
} from "../quoteService.js";
import { isWithinPolicy } from "../../shared/policy.js";
import { DEFAULT_ASSUMPTIONS, DEFAULT_REGIONS } from "../../shared/engine.js";
import {
  notifyQuoteDecided,
  notifyQuoteReassigned,
  notifyQuoteReassignedAway,
  notifyQuoteSubmitted,
} from "../notify.js";
import type { Client, QuoteSnapshot, QuoteStatus, User } from "../../shared/types.js";

export const quotesRouter = Router();
quotesRouter.use(requireAuth);

/** Reps may only change their own quotes or one reassigned to them; managers/admins may change any. */
function canEdit(req: AuthedRequest, createdBy: number, assignedTo: number | null): boolean {
  return (
    req.user!.id === createdBy ||
    req.user!.id === assignedTo ||
    hasPermission(req.user!.role, "edit_all_quotes")
  );
}

function slugify(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-+|-+$)/g, "");
}

quotesRouter.get("/", (req: AuthedRequest, res) => {
  const status = String(req.query.status ?? "").trim();
  const mine = String(req.query.mine ?? "") === "1";
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
    params.push(req.user!.id, req.user!.id);
  }
  const userIdParam = String(req.query.user_id ?? "").trim();
  if (userIdParam) {
    const uid = Number(userIdParam);
    if (Number.isFinite(uid)) {
      where.push("q.created_by = ?");
      params.push(uid);
    }
  }
  const quotes = listQuoteRows(where.length ? `WHERE ${where.join(" AND ")}` : "", ...params);
  res.json({
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
quotesRouter.get("/users/assignable", requirePermission("decide_quotes"), (_req: AuthedRequest, res) => {
  res.json({
    users: all<Pick<User, "id" | "name" | "role">>(
      "SELECT id, name, role FROM users WHERE active = 1 ORDER BY name",
    ),
  });
});

quotesRouter.get("/:id", (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const quote = findQuote(id);
  if (!quote) {
    res.status(404).json({ error: "Quotation tidak ditemukan." });
    return;
  }
  const revisions = all(
    `SELECT r.id, r.rev_no, r.note, r.created_at, u.name AS created_by_name
       FROM quote_revisions r LEFT JOIN users u ON u.id = r.created_by
      WHERE r.quote_id = ? ORDER BY r.id DESC`,
    id,
  );
  const approvals = all(
    `SELECT a.id, a.decision, a.note, a.requested_at, a.decided_at, a.breaches,
            a.monthly_value, a.net_margin,
            ru.name AS requested_by_name, du.name AS decided_by_name
       FROM approvals a
       LEFT JOIN users ru ON ru.id = a.requested_by
       LEFT JOIN users du ON du.id = a.decided_by
      WHERE a.quote_id = ? ORDER BY a.id DESC`,
    id,
  ).map((a: any) => ({ ...a, breaches: JSON.parse(a.breaches || "[]") }));

  res.json({
    quote,
    revisions,
    approvals,
    audit: auditFor("quote", id, 60),
    policy: breachesFor(quote),
    canEdit: canEdit(req, quote.created_by, quote.assigned_to) && EDITABLE_STATUSES.includes(quote.status),
  });
});

quotesRouter.post("/", (req: AuthedRequest, res) => {
  const parsed = z
    .object({
      title: z.string().min(1).max(200),
      client_id: z.number().int().nullable().optional(),
      snapshot: snapshotSchema.partial().optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: zodMessage(parsed.error) });
    return;
  }
  const client = parsed.data.client_id
    ? get<Client>("SELECT * FROM clients WHERE id = ?", parsed.data.client_id)
    : undefined;

  // nextQuoteNumber() reads then this insert writes, not atomically — two
  // concurrent requests can read the same number before either inserts.
  // Retry with a fresh number if the UNIQUE constraint on quotes.number trips.
  let number = nextQuoteNumber();
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
        preparedBy: req.user!.name,
      },
    };
    try {
      id = tx(() => {
        const info = run(
          `INSERT INTO quotes(number, title, client_id, status, scenario, rev_no,
                              assumptions, items, regions, meta, created_by)
           VALUES(?, ?, ?, 'draft', ?, 1, ?, ?, ?, ?, ?)`,
          number,
          parsed.data.title,
          parsed.data.client_id ?? null,
          snapshot!.scenario,
          JSON.stringify(snapshot!.assumptions),
          JSON.stringify(snapshot!.items),
          JSON.stringify(snapshot!.regions),
          JSON.stringify(snapshot!.meta),
          req.user!.id,
        );
        const newId = Number(info.lastInsertRowid);
        saveRevision(newId, 1, snapshot!, req.user!.id, "Dibuat");
        return newId;
      });
      break;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (attempt === 4 || !message.includes("UNIQUE constraint failed: quotes.number")) throw err;
      number = nextQuoteNumber();
    }
  }

  audit(req.user!.id, "quote", id!, "created", { number, title: parsed.data.title });
  res.status(201).json({ quote: findQuote(id!) });
});

quotesRouter.put("/:id", (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const existing = findQuote(id);
  if (!existing) {
    res.status(404).json({ error: "Quotation tidak ditemukan." });
    return;
  }
  if (!canEdit(req, existing.created_by, existing.assigned_to)) {
    res.status(403).json({ error: "Quotation ini milik pengguna lain." });
    return;
  }
  if (!EDITABLE_STATUSES.includes(existing.status)) {
    res.status(409).json({
      error: `Quotation berstatus ${existing.status} terkunci. Buka kembali sebagai revisi baru untuk mengubahnya.`,
    });
    return;
  }
  const parsed = z
    .object({
      title: z.string().min(1).max(200).optional(),
      client_id: z.number().int().nullable().optional(),
      snapshot: snapshotSchema,
      expected_version: z.number().int(),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: zodMessage(parsed.error) });
    return;
  }
  const s = parsed.data.snapshot;
  const info = run(
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
  if (info.changes === 0) {
    res.status(409).json({
      error: "Quotation ini sudah diubah pengguna lain. Muat ulang untuk melihat versi terbaru.",
      quote: findQuote(id),
    });
    return;
  }
  res.json({ quote: findQuote(id) });
});

/** Explicit named snapshot, so a rep can bookmark a version before experimenting. */
quotesRouter.post("/:id/revisions", (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const quote = findQuote(id);
  if (!quote) {
    res.status(404).json({ error: "Quotation tidak ditemukan." });
    return;
  }
  const note = String(req.body?.note ?? "Snapshot manual").slice(0, 200);
  saveRevision(id, quote.rev_no, quote, req.user!.id, note);
  audit(req.user!.id, "quote", id, "revision_saved", { note });
  res.status(201).json({ ok: true });
});

quotesRouter.post("/:id/restore/:revisionId", (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const quote = findQuote(id);
  if (!quote) {
    res.status(404).json({ error: "Quotation tidak ditemukan." });
    return;
  }
  if (!canEdit(req, quote.created_by, quote.assigned_to) || !EDITABLE_STATUSES.includes(quote.status)) {
    res.status(409).json({ error: "Quotation harus berstatus draft untuk dipulihkan." });
    return;
  }
  const rev = get<{ snapshot: string; rev_no: number }>(
    "SELECT snapshot, rev_no FROM quote_revisions WHERE id = ? AND quote_id = ?",
    Number(req.params.revisionId),
    id,
  );
  if (!rev) {
    res.status(404).json({ error: "Revisi tidak ditemukan." });
    return;
  }
  const s = JSON.parse(rev.snapshot) as QuoteSnapshot;
  const client = quote.client_id
    ? get<{ code: string }>("SELECT code FROM clients WHERE id = ?", quote.client_id)
    : undefined;
  const restoreNo = quote.restore_count + 1;
  const tag = `restore-${slugify(client?.code || quote.client_name || "unassigned") || "unassigned"}-${restoreNo}`;

  tx(() => {
    // Snapshot what was there before the overwrite, so an accidental restore
    // doesn't silently discard unsaved draft content with no way back.
    saveRevision(id, quote.rev_no, quote, req.user!.id, `Sebelum ${tag}`);
    run(
      `UPDATE quotes SET scenario = ?, assumptions = ?, items = ?, regions = ?, meta = ?,
              version = version + 1, restore_count = ?, updated_at = datetime('now') WHERE id = ?`,
      s.scenario ?? quote.scenario,
      JSON.stringify(s.assumptions),
      JSON.stringify(s.items),
      JSON.stringify(s.regions),
      JSON.stringify(s.meta),
      restoreNo,
      id,
    );
    saveRevision(id, quote.rev_no, s, req.user!.id, tag);
  });
  audit(req.user!.id, "quote", id, "restored", { from_rev: rev.rev_no, tag });
  res.json({ quote: findQuote(id) });
});

/** Hand a quote to another active user — manager/admin only, e.g. when the
 * responsible person is absent. Grants the new assignee edit rights alongside
 * (not instead of) the original creator. */
quotesRouter.post("/:id/reassign", requirePermission("decide_quotes"), (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const quote = findQuote(id);
  if (!quote) {
    res.status(404).json({ error: "Quotation tidak ditemukan." });
    return;
  }
  const parsed = z
    .object({ assigned_to: z.number().int().nullable(), note: z.string().max(500).default("") })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: zodMessage(parsed.error) });
    return;
  }
  if (parsed.data.assigned_to === quote.assigned_to) {
    // No actual change (e.g. re-picking the current assignee) — skip the
    // history entry and notifications so they aren't sent for nothing.
    res.json({ quote });
    return;
  }
  let target: User | undefined;
  if (parsed.data.assigned_to !== null) {
    target = get<User>("SELECT * FROM users WHERE id = ? AND active = 1", parsed.data.assigned_to);
    if (!target) {
      res.status(400).json({ error: "Pengguna tujuan tidak ditemukan atau tidak aktif." });
      return;
    }
  }
  // Whoever was responsible before this change — the previous assignee, or
  // the creator if no one had been assigned yet — so they're told the quote
  // moved off their plate, not just the person receiving it.
  const previousOwnerId = quote.assigned_to ?? quote.created_by;
  const previousOwner =
    previousOwnerId !== req.user!.id && previousOwnerId !== target?.id
      ? get<User>("SELECT * FROM users WHERE id = ?", previousOwnerId)
      : undefined;

  const historyNote = target
    ? `Dialihkan ke ${target.name}${parsed.data.note ? `: ${parsed.data.note}` : ""}`
    : `Penugasan dilepas${parsed.data.note ? `: ${parsed.data.note}` : ""}`;

  tx(() => {
    run("UPDATE quotes SET assigned_to = ?, updated_at = datetime('now') WHERE id = ?", parsed.data.assigned_to, id);
    saveRevision(id, quote.rev_no, quote, req.user!.id, historyNote);
  });
  audit(req.user!.id, "quote", id, "reassigned", { to: parsed.data.assigned_to, note: parsed.data.note });

  if (target) {
    void notifyQuoteReassigned({
      recipient: { name: target.name, email: target.email, phone: target.phone },
      quoteNumber: quote.number,
      quoteTitle: quote.title,
      reassignedBy: req.user!.name,
      note: parsed.data.note,
      quoteId: id,
    });
  }
  if (previousOwner) {
    void notifyQuoteReassignedAway({
      recipient: { name: previousOwner.name, email: previousOwner.email, phone: previousOwner.phone },
      quoteNumber: quote.number,
      quoteTitle: quote.title,
      reassignedBy: req.user!.name,
      newOwnerName: target?.name ?? null,
      note: parsed.data.note,
      quoteId: id,
    });
  }
  res.json({ quote: findQuote(id) });
});

/* ---------------- approval workflow ---------------- */

quotesRouter.post("/:id/submit", (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const quote = findQuote(id);
  if (!quote) {
    res.status(404).json({ error: "Quotation tidak ditemukan." });
    return;
  }
  if (!canEdit(req, quote.created_by, quote.assigned_to)) {
    res.status(403).json({ error: "Quotation ini milik pengguna lain." });
    return;
  }
  if (!EDITABLE_STATUSES.includes(quote.status)) {
    res.status(409).json({ error: "Hanya draft yang bisa diajukan." });
    return;
  }
  const { breaches, monthly_value, net_margin } = breachesFor(quote);
  const clean = isWithinPolicy(breaches);
  // A manager submitting a quote that breaks no rule is approved on the spot.
  const autoApprove = clean && hasPermission(req.user!.role, "decide_quotes");

  tx(() => {
    run(
      `INSERT INTO approvals(quote_id, requested_by, decision, breaches, monthly_value, net_margin,
                             decided_by, decided_at, note)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      req.user!.id,
      autoApprove ? "approved" : "pending",
      JSON.stringify(breaches),
      monthly_value,
      net_margin,
      autoApprove ? req.user!.id : null,
      autoApprove ? new Date().toISOString() : null,
      autoApprove ? "Otomatis disetujui: seluruh angka di dalam kebijakan." : null,
    );
    run(
      `UPDATE quotes SET status = ?, approved_by = ?, approved_at = ?, updated_at = datetime('now')
        WHERE id = ?`,
      autoApprove ? "approved" : "submitted",
      autoApprove ? req.user!.id : null,
      autoApprove ? new Date().toISOString() : null,
      id,
    );
    saveRevision(id, quote.rev_no, quote, req.user!.id, autoApprove ? "Disetujui" : "Diajukan");
  });

  audit(req.user!.id, "quote", id, autoApprove ? "auto_approved" : "submitted", {
    breaches: breaches.map((b) => b.code),
    monthly_value,
    net_margin,
  });

  if (!autoApprove) {
    // Only the actual decision-maker (manager) gets the "needs your action"
    // email — admin still has decide_quotes for coverage/escalation, but
    // routing this to every admin as well just spams the people who are
    // meant to be monitoring, not approving on every quote.
    const recipients = all<{ name: string; email: string; phone: string }>(
      `SELECT name, email, phone FROM users WHERE role = 'manager' AND active = 1`,
    );
    void notifyQuoteSubmitted({
      recipients,
      quoteNumber: quote.number,
      quoteTitle: quote.title,
      submittedBy: req.user!.name,
      quoteId: id,
    });
  }

  res.json({ quote: findQuote(id), breaches, autoApproved: autoApprove });
});

quotesRouter.post("/:id/decide", requirePermission("decide_quotes"), (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const quote = findQuote(id);
  if (!quote) {
    res.status(404).json({ error: "Quotation tidak ditemukan." });
    return;
  }
  if (quote.status !== "submitted") {
    res.status(409).json({ error: "Quotation ini tidak sedang menunggu persetujuan." });
    return;
  }
  const parsed = z
    .object({
      decision: z.enum(["approved", "rejected"]),
      note: z.string().max(1000).default(""),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: zodMessage(parsed.error) });
    return;
  }
  // A rejection must say why, so the rep knows what to change.
  if (parsed.data.decision === "rejected" && !parsed.data.note.trim()) {
    res.status(400).json({ error: "Penolakan wajib disertai alasan." });
    return;
  }
  const pending = get<{ id: number }>(
    "SELECT id FROM approvals WHERE quote_id = ? AND decision = 'pending' ORDER BY id DESC LIMIT 1",
    id,
  );
  const now = new Date().toISOString();

  tx(() => {
    if (pending) {
      run(
        "UPDATE approvals SET decision = ?, decided_by = ?, decided_at = ?, note = ? WHERE id = ?",
        parsed.data.decision,
        req.user!.id,
        now,
        parsed.data.note,
        pending.id,
      );
    }
    run(
      `UPDATE quotes SET status = ?, approved_by = ?, approved_at = ?, decision_note = ?,
              updated_at = datetime('now') WHERE id = ?`,
      parsed.data.decision,
      parsed.data.decision === "approved" ? req.user!.id : null,
      parsed.data.decision === "approved" ? now : null,
      parsed.data.note,
      id,
    );
    saveRevision(
      id,
      quote.rev_no,
      quote,
      req.user!.id,
      parsed.data.decision === "approved" ? "Disetujui" : "Ditolak",
    );
  });

  audit(req.user!.id, "quote", id, parsed.data.decision, { note: parsed.data.note });

  const submitter = get<{ name: string; email: string; phone: string }>(
    "SELECT name, email, phone FROM users WHERE id = ?",
    quote.created_by,
  );
  if (submitter) {
    void notifyQuoteDecided({
      recipient: submitter,
      quoteNumber: quote.number,
      quoteTitle: quote.title,
      decision: parsed.data.decision,
      decidedBy: req.user!.name,
      note: parsed.data.note,
      quoteId: id,
    });
  }

  res.json({ quote: findQuote(id) });
});

quotesRouter.post("/:id/status", (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const quote = findQuote(id);
  if (!quote) {
    res.status(404).json({ error: "Quotation tidak ditemukan." });
    return;
  }
  if (!canEdit(req, quote.created_by, quote.assigned_to)) {
    res.status(403).json({ error: "Quotation ini milik pengguna lain." });
    return;
  }
  const next = String(req.body?.status ?? "") as QuoteStatus;
  const allowed = STATUS_FLOW[quote.status] ?? [];
  if (!allowed.includes(next)) {
    res.status(409).json({
      error: `Status ${quote.status} tidak bisa langsung menjadi ${next}.`,
    });
    return;
  }
  run("UPDATE quotes SET status = ?, updated_at = datetime('now') WHERE id = ?", next, id);
  audit(req.user!.id, "quote", id, `status_${next}`);
  res.json({ quote: findQuote(id) });
});

/** Unlocks a decided quote as a new revision, preserving the approved history. */
quotesRouter.post("/:id/reopen", (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const quote = findQuote(id);
  if (!quote) {
    res.status(404).json({ error: "Quotation tidak ditemukan." });
    return;
  }
  if (!canEdit(req, quote.created_by, quote.assigned_to)) {
    res.status(403).json({ error: "Quotation ini milik pengguna lain." });
    return;
  }
  if (quote.status === "draft") {
    res.status(409).json({ error: "Quotation sudah berstatus draft." });
    return;
  }
  const nextRev = quote.rev_no + 1;
  tx(() => {
    saveRevision(id, quote.rev_no, quote, req.user!.id, `Ditutup sebagai revisi ${quote.rev_no}`);
    run(
      `UPDATE quotes SET status = 'draft', rev_no = ?, approved_by = NULL, approved_at = NULL,
              decision_note = NULL, updated_at = datetime('now') WHERE id = ?`,
      nextRev,
      id,
    );
  });
  audit(req.user!.id, "quote", id, "reopened", { rev_no: nextRev });
  res.json({ quote: findQuote(id) });
});

quotesRouter.delete("/:id", (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const quote = findQuote(id);
  if (!quote) {
    res.status(404).json({ error: "Quotation tidak ditemukan." });
    return;
  }
  const isOwnDraft = quote.created_by === req.user!.id && quote.status === "draft";
  if (!isOwnDraft && !hasPermission(req.user!.role, "delete_quotes")) {
    res.status(403).json({
      error: "Hanya draft milik sendiri yang bisa dihapus. Selain itu perlu admin.",
    });
    return;
  }
  run("DELETE FROM quotes WHERE id = ?", id);
  audit(req.user!.id, "quote", id, "deleted", { number: quote.number });
  res.json({ ok: true });
});
