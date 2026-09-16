/* ============================================================
   Quote persistence helpers: numbering, snapshot hydration, and the
   status machine shared by the quote and approval routes.
   Async D1 version of server/quoteService.ts.
   ============================================================ */

import { all, get, getSetting, run } from "../db.d1";
import { computeEngine } from "../../shared/engine";
import { DEFAULT_POLICY, evaluatePolicy } from "../../shared/policy";
import type {
  PolicyBreach,
  PricingPolicy,
  Quote,
  QuoteSnapshot,
  QuoteStatus,
  ScenarioIndex,
} from "../../shared/types";

export interface QuoteRow {
  id: number;
  number: string;
  title: string;
  client_id: number | null;
  client_name: string | null;
  status: QuoteStatus;
  scenario: number;
  rev_no: number;
  version: number;
  assumptions: string;
  items: string;
  regions: string;
  meta: string;
  created_by: number;
  created_by_name: string;
  approved_by: number | null;
  approved_by_name: string | null;
  approved_at: string | null;
  decision_note: string | null;
  created_at: string;
  updated_at: string;
}

const SELECT_QUOTE = `
  SELECT q.*, c.name AS client_name, u.name AS created_by_name, a.name AS approved_by_name
    FROM quotes q
    LEFT JOIN clients c ON c.id = q.client_id
    LEFT JOIN users   u ON u.id = q.created_by
    LEFT JOIN users   a ON a.id = q.approved_by`;

export const currentPolicy = (d1: D1Database): Promise<PricingPolicy> =>
  getSetting<PricingPolicy>(d1, "policy", DEFAULT_POLICY);

/** Next quote number in the HK/SIP/Q/YYMM/NNN series. */
export async function nextQuoteNumber(d1: D1Database, date = new Date()): Promise<string> {
  const yy = String(date.getFullYear()).slice(-2);
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const prefix = `HK/SIP/Q/${yy}${mm}/`;
  const rows = await all<{ number: string }>(
    d1,
    "SELECT number FROM quotes WHERE number LIKE ? ORDER BY number DESC LIMIT 1",
    `${prefix}%`,
  );
  const last = rows[0] ? Number(rows[0].number.slice(prefix.length)) : 0;
  const next = (Number.isFinite(last) ? last : 0) + 1;
  return prefix + String(next).padStart(3, "0");
}

export function hydrate(row: QuoteRow): Quote {
  const snapshot = {
    assumptions: JSON.parse(row.assumptions),
    items: JSON.parse(row.items),
    regions: JSON.parse(row.regions),
    meta: JSON.parse(row.meta),
  };
  return {
    id: row.id,
    number: row.number,
    title: row.title,
    client_id: row.client_id,
    client_name: row.client_name ?? undefined,
    status: row.status,
    scenario: (row.scenario as ScenarioIndex) ?? 1,
    rev_no: row.rev_no,
    version: row.version,
    created_by: row.created_by,
    created_by_name: row.created_by_name,
    approved_by: row.approved_by,
    approved_by_name: row.approved_by_name ?? undefined,
    approved_at: row.approved_at,
    decision_note: row.decision_note,
    created_at: row.created_at,
    updated_at: row.updated_at,
    ...snapshot,
  };
}

export async function findQuote(d1: D1Database, id: number): Promise<Quote | null> {
  const row = await get<QuoteRow>(d1, `${SELECT_QUOTE} WHERE q.id = ?`, id);
  return row ? hydrate(row) : null;
}

export async function listQuoteRows(
  d1: D1Database,
  where = "",
  ...params: (string | number)[]
): Promise<Quote[]> {
  const rows = await all<QuoteRow>(d1, `${SELECT_QUOTE} ${where} ORDER BY q.updated_at DESC`, ...params);
  return rows.map(hydrate);
}

/** Monthly revenue and net margin of a quote at its selected scenario. */
export function quoteMetrics(q: QuoteSnapshot & { scenario: ScenarioIndex }) {
  const engine = computeEngine(q.assumptions, q.items, q.regions);
  const s = engine.scen[q.scenario] ?? engine.scen[0];
  return { engine, monthly_value: s.revenue, net_margin: s.margin };
}

export async function breachesFor(
  d1: D1Database,
  q: QuoteSnapshot & { scenario: ScenarioIndex },
): Promise<{ breaches: PolicyBreach[]; monthly_value: number; net_margin: number }> {
  const { engine, monthly_value, net_margin } = quoteMetrics(q);
  const policy = await currentPolicy(d1);
  return { breaches: evaluatePolicy(engine, q.scenario, policy), monthly_value, net_margin };
}

export async function saveRevision(
  d1: D1Database,
  quoteId: number,
  revNo: number,
  snapshot: QuoteSnapshot,
  userId: number,
  note: string,
): Promise<void> {
  await run(
    d1,
    "INSERT INTO quote_revisions(quote_id, rev_no, snapshot, note, created_by) VALUES(?, ?, ?, ?, ?)",
    quoteId,
    revNo,
    JSON.stringify(snapshot),
    note,
    userId,
  );
}

/** Statuses whose content is frozen until the quote is explicitly reopened. */
export const LOCKED_STATUSES: QuoteStatus[] = ["submitted", "approved", "sent", "won", "lost"];

export const EDITABLE_STATUSES: QuoteStatus[] = ["draft", "rejected"];

/** Allowed manual status moves, beyond submit/decide/reopen. */
export const STATUS_FLOW: Partial<Record<QuoteStatus, QuoteStatus[]>> = {
  approved: ["sent"],
  sent: ["won", "lost"],
};
