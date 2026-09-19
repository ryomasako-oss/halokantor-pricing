/* ============================================================
   Shared domain types — used by both server and web client.
   ============================================================ */

export type Role = "rep" | "manager" | "admin";

export interface User {
  id: number;
  email: string;
  name: string;
  role: Role;
  active: 0 | 1;
  phone: string;
  created_at: string;
}

export interface PasswordResetRequest {
  id: number;
  email: string;
  created_at: string;
}

/** The three pricing strategies the engine evaluates side by side. */
export type ScenarioKey = "S1" | "S2" | "S3";
export type ScenarioIndex = 0 | 1 | 2;

/** Role a line item plays in the cross-subsidy scenario (S2). */
export type ItemRole = "LEADER" | "CORE" | "PROFIT";

export interface Assumptions {
  /** Operating cost as a fraction of COGS (handling, warehouse, admin). */
  opex: number;
  /** Target net margin used by S1 and by CORE items in S2. */
  targetMargin: number;
  /** Thin margin applied to LEADER items in S2. */
  leaderMargin: number;
  /** Discount off RRP applied to PROFIT items in S2 (0 = sell at ceiling). */
  profitDiscount: number;
  /** Blanket discount off RRP in S3. */
  rrpDiscount: number;
  /** Hard margin floor that S3 may never price below. */
  marginFloor: number;
  /** VAT rate, presentational only — all engine prices are pre-VAT. */
  ppn: number;
  /** Price rounding increment in Rupiah. */
  step: number;
  /** Contract length in months, for contract-value figures. */
  months: number;
  /** Whether blended logistics cost is folded into the landed cost. */
  includeLogistics: boolean;
}

export interface QuoteItem {
  /** Stable line identifier within a quote. */
  id: string;
  lineNo: number;
  code: string;
  name: string;
  uom: string;
  qty: number;
  /** Supplier cost per unit, excluding VAT. */
  cogs: number;
  /** Client ceiling price per unit — the quote may never exceed it. */
  rrp: number;
  role: ItemRole;
  /** True when COGS was estimated rather than sourced from inventory. */
  estCogs?: boolean;
  /**
   * Manual price override per scenario. A non-null entry wins over the
   * engine's computed price for that scenario, but is still clamped to RRP.
   */
  manualPrice?: (number | null)[];
  notes?: string;
}

export interface Region {
  id: string;
  name: string;
  /** Fraction of total order value shipped to this region. */
  share: number;
  /** Deliveries per month. */
  deliveries: number;
  /** Cost per delivery in Rupiah. */
  cost: number;
}

export interface ComputedRegion extends Region {
  monthlyCost: number;
  value: number;
  modifier: number;
}

export type LineStatus =
  | "OK"
  | "CAPPED AT RRP"
  | "FLOOR HIT"
  | "BELOW COST"
  | "Standard"
  | "Subsidised"
  | "Subsidiser"
  | "MANUAL";

export interface ComputedRow extends QuoteItem {
  /** COGS plus opex (and logistics when enabled). */
  landed: number;
  /** Cost-plus price before the RRP ceiling is applied. */
  target: number;
  /** Final price per scenario, index 0..2. */
  prices: number[];
  /** Net margin per scenario, index 0..2. */
  margins: number[];
  status: LineStatus[];
  /** Whether the price for that scenario came from a manual override. */
  overridden: boolean[];
  /** Monthly rupiah swing of S2 versus S1 for this line. */
  delta: number;
}

export interface ScenarioResult {
  revenue: number;
  landed: number;
  profit: number;
  margin: number;
  annual: number;
  annualProfit: number;
  rrpValue: number;
  savings: number;
  savingsPct: number;
  leaderSavingsPct: number;
  atCeiling: number;
  lowestMargin: number;
  belowCost: number;
}

export interface EngineResult {
  rows: ComputedRow[];
  scen: ScenarioResult[];
  cogsValue: number;
  rrpValue: number;
  landedTotal: number;
  regions: ComputedRegion[];
  logiCost: number;
  blended: number;
  logiApplied: number;
  shareTotal: number;
  capped: number;
  floorHits: number;
  subsidy: { given: number; recovered: number; coverage: number };
}

/* ---------------- Pricing policy & approvals ---------------- */

export interface PricingPolicy {
  /** Minimum acceptable blended net margin for the whole quote. */
  minNetMargin: number;
  /** Minimum acceptable net margin on any single line. */
  minLineMargin: number;
  /** Maximum discount off RRP the basket may give away. */
  maxBasketDiscount: number;
  /** Whether any line is allowed to price below landed cost. */
  allowBelowCost: boolean;
  /** Quotes above this monthly value always need manager sign-off. */
  approvalValueThreshold: number;
}

export type BreachSeverity = "block" | "warn";

export interface PolicyBreach {
  code:
    | "NET_MARGIN"
    | "LINE_MARGIN"
    | "BASKET_DISCOUNT"
    | "BELOW_COST"
    | "VALUE_THRESHOLD"
    | "MISSING_COGS";
  severity: BreachSeverity;
  message: string;
  /** Line numbers involved, when the breach is line-specific. */
  lines?: number[];
}

export type QuoteStatus =
  | "draft"
  | "submitted"
  | "approved"
  | "rejected"
  | "sent"
  | "won"
  | "lost";

export interface QuoteMeta {
  quoteNo: string;
  date: string;
  /** Validity window in days. */
  validity: number;
  payment: string;
  delivery: string;
  notes: string;
  preparedBy?: string;
}

export interface Client {
  id: number;
  name: string;
  code: string;
  address: string;
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  payment_terms: string;
  delivery_terms: string;
  created_at: string;
}

export interface QuoteSnapshot {
  assumptions: Assumptions;
  items: QuoteItem[];
  regions: Region[];
  meta: QuoteMeta;
  scenario: ScenarioIndex;
}

export interface Quote extends QuoteSnapshot {
  id: number;
  number: string;
  title: string;
  client_id: number | null;
  client_name?: string;
  status: QuoteStatus;
  rev_no: number;
  version: number;
  created_by: number;
  created_by_name?: string;
  approved_by: number | null;
  approved_by_name?: string;
  approved_at: string | null;
  decision_note: string | null;
  created_at: string;
  updated_at: string;
}

export interface QuoteListRow {
  id: number;
  number: string;
  title: string;
  client_name: string | null;
  status: QuoteStatus;
  scenario: ScenarioIndex;
  rev_no: number;
  created_by_name: string;
  updated_at: string;
  monthly_value: number;
  net_margin: number;
}

export interface CatalogItem {
  id: number;
  code: string;
  name: string;
  uom: string;
  cogs: number;
  list_price: number;
  stock: number;
  category: string;
  source: string;
  updated_at: string;
}

export interface AuditEntry {
  id: number;
  actor_name: string;
  entity: string;
  entity_id: number;
  action: string;
  detail: string;
  created_at: string;
}

export interface Approval {
  id: number;
  quote_id: number;
  quote_number: string;
  quote_title: string;
  client_name: string | null;
  requested_by_name: string;
  requested_at: string;
  decided_by_name: string | null;
  decided_at: string | null;
  decision: "pending" | "approved" | "rejected";
  note: string | null;
  breaches: PolicyBreach[];
  monthly_value: number;
  net_margin: number;
}
