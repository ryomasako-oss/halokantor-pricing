/* ============================================================
   Pricing engine.

   Pure, deterministic, and dependency-free so that the server, the
   browser and the test suite all price a quote identically. Every
   figure produced here is exclusive of VAT.

   Landed cost  = COGS x (1 + opex + logistics)
   Target price = landed / (1 - target margin)

   S1 Full Margin     cost-plus everywhere, capped at the client's RRP.
   S2 Cross Subsidise leader lines run thin, accessory lines recover it.
   S3 RRP Discount    blanket discount off RRP, held up by a margin floor.
   ============================================================ */

import type {
  Assumptions,
  ComputedRegion,
  ComputedRow,
  EngineResult,
  LineStatus,
  QuoteItem,
  Region,
  ScenarioResult,
} from "./types.js";

export const SCENARIOS = [
  {
    key: "S1" as const,
    name: "Full Margin",
    color: "#1F5F8B",
    tint: "#E8F0F7",
    rule: "Cost-plus di semua item, dibatasi RRP.",
  },
  {
    key: "S2" as const,
    name: "Cross Subsidise",
    color: "#2A7F8E",
    tint: "#E4F2F3",
    rule: "Item leader dijual tipis, ditutup item aksesori.",
  },
  {
    key: "S3" as const,
    name: "RRP Discount",
    color: "#7A5C99",
    tint: "#F0EBF5",
    rule: "Semua item diskon dari RRP, ada margin minimum.",
  },
];

export const DEFAULT_ASSUMPTIONS: Assumptions = {
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

export const DEFAULT_REGIONS: Region[] = [
  { id: "r1", name: "Jakarta", share: 0.45, deliveries: 4, cost: 75000 },
  { id: "r2", name: "Bogor", share: 0.2, deliveries: 2, cost: 100000 },
  { id: "r3", name: "Bandung", share: 0.2, deliveries: 1, cost: 250000 },
  { id: "r4", name: "Surabaya", share: 0.15, deliveries: 1, cost: 450000 },
];

/** Trims binary floating-point dust before rounding decisions. */
const clean = (x: number): number => Number(x.toFixed(9));

const finite = (x: unknown, fallback = 0): number => {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
};

export function computeEngine(
  a: Assumptions,
  items: QuoteItem[],
  regions: Region[],
): EngineResult {
  const step = Math.max(1, finite(a.step, 1) || 1);
  const roundUp = (x: number) => Math.ceil(clean(x / step)) * step;
  const roundDown = (x: number) => Math.floor(clean(x / step)) * step;

  const opex = finite(a.opex);
  const targetMargin = Math.min(0.999, finite(a.targetMargin));
  const leaderMargin = Math.min(0.999, finite(a.leaderMargin));
  const marginFloor = Math.min(0.999, finite(a.marginFloor));

  const cogsValue = items.reduce((s, it) => s + finite(it.qty) * finite(it.cogs), 0);
  const shareTotal = regions.reduce((s, r) => s + finite(r.share), 0);

  const computedRegions: ComputedRegion[] = regions.map((r) => {
    const monthlyCost = finite(r.deliveries) * finite(r.cost);
    // Shares are normalized so a basket that doesn't sum to 100% still
    // splits cogsValue proportionally instead of silently under/over-counting it.
    const share = shareTotal > 0 ? finite(r.share) / shareTotal : 0;
    const value = cogsValue * share;
    return { ...r, monthlyCost, value, modifier: value > 0 ? monthlyCost / value : 0 };
  });

  const logiCost = computedRegions.reduce((s, r) => s + r.monthlyCost, 0);
  const logiValue = computedRegions.reduce((s, r) => s + r.value, 0);
  const blended = logiValue > 0 ? logiCost / logiValue : 0;
  const logiApplied = a.includeLogistics ? blended : 0;

  const rows: ComputedRow[] = items.map((it) => {
    const cogs = finite(it.cogs);
    const rrp = finite(it.rrp);
    const qty = finite(it.qty);
    const landed = cogs * clean(1 + opex + logiApplied);
    const target = landed / (1 - targetMargin);
    const targetRounded = roundUp(target);

    // S1 — cost-plus, never above the client ceiling.
    const s1 = Math.min(targetRounded, rrp);

    // S2 — role decides who gives the discount and who pays for it.
    let s2: number;
    if (it.role === "LEADER") {
      s2 = Math.min(roundUp(landed / (1 - leaderMargin)), rrp);
    } else if (it.role === "PROFIT") {
      s2 = Math.min(rrp, Math.max(s1, roundDown(rrp * (1 - finite(a.profitDiscount)))));
    } else {
      s2 = s1;
    }

    // S3 — blanket discount off RRP, floored by the minimum margin.
    const discounted = roundDown(rrp * (1 - finite(a.rrpDiscount)));
    const floorPrice = roundUp(landed / (1 - marginFloor));
    const s3 = Math.min(rrp, Math.max(discounted, floorPrice));

    const computed = [s1, s2, s3];
    const overridden: boolean[] = [false, false, false];
    const prices = computed.map((p, k) => {
      const manual = it.manualPrice?.[k];
      if (manual == null || !Number.isFinite(manual) || manual <= 0) return p;
      overridden[k] = true;
      // A manual price still respects the client's ceiling.
      return Math.min(finite(manual), rrp);
    });

    const margins = prices.map((p) => (p > 0 ? (p - landed) / p : 0));

    const status: LineStatus[] = [
      margins[0] < 0
        ? "BELOW COST"
        : overridden[0]
          ? "MANUAL"
          : targetRounded > rrp
            ? "CAPPED AT RRP"
            : "OK",
      margins[1] < 0
        ? "BELOW COST"
        : overridden[1]
          ? "MANUAL"
          : it.role === "LEADER"
            ? "Subsidised"
            : it.role === "PROFIT"
              ? "Subsidiser"
              : "Standard",
      margins[2] < 0
        ? "BELOW COST"
        : overridden[2]
          ? "MANUAL"
          : discounted < floorPrice
            ? "FLOOR HIT"
            : "OK",
    ];

    return {
      ...it,
      qty,
      cogs,
      rrp,
      landed,
      target,
      prices,
      margins,
      status,
      overridden,
      delta: (prices[1] - prices[0]) * qty,
    };
  });

  const rrpValue = rows.reduce((s, r) => s + r.qty * r.rrp, 0);
  const landedTotal = rows.reduce((s, r) => s + r.qty * r.landed, 0);
  const leaders = rows.filter((r) => r.role === "LEADER");
  const leaderRrp = leaders.reduce((s, r) => s + r.qty * r.rrp, 0);

  const scen: ScenarioResult[] = [0, 1, 2].map((k) => {
    const revenue = rows.reduce((s, r) => s + r.qty * r.prices[k], 0);
    const profit = revenue - landedTotal;
    const leaderRevenue = leaders.reduce((s, r) => s + r.qty * r.prices[k], 0);
    return {
      revenue,
      landed: landedTotal,
      profit,
      margin: revenue > 0 ? profit / revenue : 0,
      annual: revenue * finite(a.months, 12),
      annualProfit: profit * finite(a.months, 12),
      rrpValue,
      savings: rrpValue - revenue,
      savingsPct: rrpValue > 0 ? 1 - revenue / rrpValue : 0,
      leaderSavingsPct: leaderRrp > 0 ? 1 - leaderRevenue / leaderRrp : 0,
      atCeiling: rows.filter((r) => r.rrp > 0 && r.prices[k] === r.rrp).length,
      lowestMargin: rows.length ? Math.min(...rows.map((r) => r.margins[k])) : 0,
      belowCost: rows.filter((r) => r.margins[k] < 0).length,
    };
  });

  const given = -rows
    .filter((r) => r.role === "LEADER")
    .reduce((s, r) => s + r.delta, 0);
  const recovered = rows
    .filter((r) => r.role === "PROFIT")
    .reduce((s, r) => s + r.delta, 0);

  return {
    rows,
    scen,
    cogsValue,
    rrpValue,
    landedTotal,
    regions: computedRegions,
    logiCost,
    blended,
    logiApplied,
    shareTotal,
    capped: rows.filter((r) => r.status[0] === "CAPPED AT RRP").length,
    floorHits: rows.filter((r) => r.status[2] === "FLOOR HIT").length,
    subsidy: { given, recovered, coverage: given > 0 ? recovered / given : 0 },
  };
}
