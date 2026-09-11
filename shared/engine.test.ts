import { describe, expect, it } from "vitest";
import { DEFAULT_ASSUMPTIONS, DEFAULT_REGIONS, computeEngine } from "./engine.js";
import { DEFAULT_POLICY, evaluatePolicy, isWithinPolicy } from "./policy.js";
import type { Assumptions, QuoteItem, Region } from "./types.js";

const item = (over: Partial<QuoteItem> = {}): QuoteItem => ({
  id: "x",
  lineNo: 1,
  code: "TEST",
  name: "Test item",
  uom: "Pcs",
  qty: 100,
  cogs: 1000,
  rrp: 2000,
  role: "CORE",
  ...over,
});

const A = (over: Partial<Assumptions> = {}): Assumptions => ({
  ...DEFAULT_ASSUMPTIONS,
  ...over,
});

describe("landed cost", () => {
  it("applies opex to COGS", () => {
    const e = computeEngine(A({ opex: 0.1 }), [item({ cogs: 1000 })], []);
    expect(e.rows[0].landed).toBeCloseTo(1100, 6);
  });

  it("excludes logistics unless enabled", () => {
    const regions: Region[] = [
      { id: "r", name: "JKT", share: 1, deliveries: 4, cost: 100000 },
    ];
    const off = computeEngine(A({ includeLogistics: false }), [item()], regions);
    const on = computeEngine(A({ includeLogistics: true }), [item()], regions);
    expect(off.logiApplied).toBe(0);
    expect(on.logiApplied).toBeGreaterThan(0);
    expect(on.rows[0].landed).toBeGreaterThan(off.rows[0].landed);
  });

  it("blends logistics as cost over order value at COGS", () => {
    // 4 deliveries x 100k = 400k per month against 100 units x 1000 = 100k of goods.
    const regions: Region[] = [
      { id: "r", name: "JKT", share: 1, deliveries: 4, cost: 100000 },
    ];
    const e = computeEngine(A({ includeLogistics: true }), [item()], regions);
    expect(e.blended).toBeCloseTo(4, 6);
    expect(e.regions[0].modifier).toBeCloseTo(4, 6);
  });
});

describe("S1 full margin", () => {
  it("prices cost-plus and rounds up to the step", () => {
    // landed 1080, target margin 25% => 1440 => rounds up to 1450 at step 50.
    const e = computeEngine(A({ step: 50 }), [item({ cogs: 1000, rrp: 99999 })], []);
    expect(e.rows[0].prices[0]).toBe(1450);
    expect(e.rows[0].status[0]).toBe("OK");
  });

  it("caps at RRP and flags the line", () => {
    const e = computeEngine(A(), [item({ cogs: 1000, rrp: 1200 })], []);
    expect(e.rows[0].prices[0]).toBe(1200);
    expect(e.rows[0].status[0]).toBe("CAPPED AT RRP");
    expect(e.capped).toBe(1);
  });

  it("never exceeds RRP for any scenario", () => {
    const e = computeEngine(A({ rrpDiscount: 0, profitDiscount: 0 }), [
      item({ cogs: 5000, rrp: 5200, role: "PROFIT" }),
      item({ cogs: 5000, rrp: 5200, role: "LEADER", lineNo: 2 }),
      item({ cogs: 5000, rrp: 5200, role: "CORE", lineNo: 3 }),
    ], []);
    for (const row of e.rows) {
      for (const p of row.prices) expect(p).toBeLessThanOrEqual(row.rrp);
    }
  });
});

describe("S2 cross subsidise", () => {
  it("prices leaders on the thin leader margin", () => {
    // landed 1080 at 10% leader margin => 1200 exactly.
    const e = computeEngine(A({ leaderMargin: 0.1, step: 50 }), [
      item({ cogs: 1000, rrp: 5000, role: "LEADER" }),
    ], []);
    expect(e.rows[0].prices[1]).toBe(1200);
    expect(e.rows[0].status[1]).toBe("Subsidised");
  });

  it("pushes profit items to the ceiling when discount is zero", () => {
    const e = computeEngine(A({ profitDiscount: 0 }), [
      item({ cogs: 1000, rrp: 4000, role: "PROFIT" }),
    ], []);
    expect(e.rows[0].prices[1]).toBe(4000);
    expect(e.rows[0].status[1]).toBe("Subsidiser");
  });

  it("leaves core items at the S1 price", () => {
    const e = computeEngine(A(), [item({ role: "CORE", rrp: 9999 })], []);
    expect(e.rows[0].prices[1]).toBe(e.rows[0].prices[0]);
  });

  it("never prices a profit item below its S1 price", () => {
    const e = computeEngine(A({ profitDiscount: 0.9 }), [
      item({ cogs: 1000, rrp: 4000, role: "PROFIT" }),
    ], []);
    expect(e.rows[0].prices[1]).toBe(e.rows[0].prices[0]);
  });

  it("reports subsidy given and recovered", () => {
    const e = computeEngine(A({ leaderMargin: 0.05, profitDiscount: 0 }), [
      item({ lineNo: 1, cogs: 1000, rrp: 5000, role: "LEADER", qty: 10 }),
      item({ lineNo: 2, cogs: 1000, rrp: 5000, role: "PROFIT", qty: 10 }),
    ], []);
    expect(e.subsidy.given).toBeGreaterThan(0);
    expect(e.subsidy.recovered).toBeGreaterThan(0);
    expect(e.subsidy.coverage).toBeCloseTo(
      e.subsidy.recovered / e.subsidy.given,
      9,
    );
  });
});

describe("S3 rrp discount", () => {
  it("discounts off RRP and rounds down", () => {
    // 10% off 2000 = 1800, comfortably above the floor price.
    const e = computeEngine(A({ rrpDiscount: 0.1, marginFloor: 0.05 }), [
      item({ cogs: 500, rrp: 2000 }),
    ], []);
    expect(e.rows[0].prices[2]).toBe(1800);
    expect(e.rows[0].status[2]).toBe("OK");
  });

  it("holds the margin floor when the discount would cut too deep", () => {
    // landed 1080; floor 5% => 1137 -> rounds up to 1150, above the 1200*0.6 discount.
    const e = computeEngine(A({ rrpDiscount: 0.5, marginFloor: 0.05, step: 50 }), [
      item({ cogs: 1000, rrp: 2000 }),
    ], []);
    expect(e.rows[0].prices[2]).toBe(1150);
    expect(e.rows[0].status[2]).toBe("FLOOR HIT");
    expect(e.floorHits).toBe(1);
  });

  it("flags below cost when RRP itself cannot cover landed cost", () => {
    const e = computeEngine(A(), [item({ cogs: 2000, rrp: 1000 })], []);
    expect(e.rows[0].margins[2]).toBeLessThan(0);
    expect(e.rows[0].status[2]).toBe("BELOW COST");
    expect(e.scen[2].belowCost).toBe(1);
  });
});

describe("manual overrides", () => {
  it("wins over the computed price", () => {
    const e = computeEngine(A(), [
      item({ cogs: 1000, rrp: 5000, manualPrice: [1337, null, null] }),
    ], []);
    expect(e.rows[0].prices[0]).toBe(1337);
    expect(e.rows[0].overridden[0]).toBe(true);
    expect(e.rows[0].status[0]).toBe("MANUAL");
    expect(e.rows[0].prices[1]).not.toBe(1337);
  });

  it("is still clamped to the client ceiling", () => {
    const e = computeEngine(A(), [
      item({ cogs: 1000, rrp: 2000, manualPrice: [9999, null, null] }),
    ], []);
    expect(e.rows[0].prices[0]).toBe(2000);
  });

  it("ignores zero and non-numeric overrides", () => {
    const e = computeEngine(A(), [
      item({ cogs: 1000, rrp: 5000, manualPrice: [0, null, NaN] }),
    ], []);
    expect(e.rows[0].overridden).toEqual([false, false, false]);
  });
});

describe("totals", () => {
  it("sums revenue, profit and margin consistently", () => {
    const items = [
      item({ lineNo: 1, qty: 10, cogs: 1000, rrp: 9999 }),
      item({ lineNo: 2, qty: 5, cogs: 2000, rrp: 9999 }),
    ];
    const e = computeEngine(A(), items, []);
    const s = e.scen[0];
    const expected = e.rows.reduce((acc, r) => acc + r.qty * r.prices[0], 0);
    expect(s.revenue).toBeCloseTo(expected, 6);
    expect(s.profit).toBeCloseTo(s.revenue - s.landed, 6);
    expect(s.margin).toBeCloseTo(s.profit / s.revenue, 9);
    expect(s.annual).toBeCloseTo(s.revenue * DEFAULT_ASSUMPTIONS.months, 6);
  });

  it("survives an empty basket without dividing by zero", () => {
    const e = computeEngine(A(), [], DEFAULT_REGIONS);
    expect(e.scen[0].revenue).toBe(0);
    expect(e.scen[0].margin).toBe(0);
    expect(e.blended).toBe(0);
    expect(Number.isFinite(e.scen[0].savingsPct)).toBe(true);
  });

  it("tolerates a zero-quantity or zero-price line", () => {
    const e = computeEngine(A(), [item({ qty: 0, cogs: 0, rrp: 0 })], []);
    expect(e.scen[0].revenue).toBe(0);
    expect(Number.isFinite(e.scen[0].lowestMargin)).toBe(true);
  });
});

describe("policy", () => {
  // Price lands at 1450 against an 1800 ceiling: 25,5% margin, 19,4% off RRP.
  const healthy = computeEngine(A(), [item({ cogs: 1000, rrp: 1800, qty: 10 })], []);

  it("passes a healthy quote", () => {
    const breaches = evaluatePolicy(healthy, 0, DEFAULT_POLICY);
    expect(isWithinPolicy(breaches)).toBe(true);
  });

  it("blocks a quote under the minimum net margin", () => {
    const thin = computeEngine(A({ targetMargin: 0.02 }), [
      item({ cogs: 1000, rrp: 1800 }),
    ], []);
    const breaches = evaluatePolicy(thin, 0, DEFAULT_POLICY);
    expect(isWithinPolicy(breaches)).toBe(false);
    expect(breaches.some((b) => b.code === "NET_MARGIN")).toBe(true);
  });

  it("blocks below-cost lines and names them", () => {
    const bad = computeEngine(A(), [
      item({ lineNo: 7, cogs: 5000, rrp: 1000 }),
    ], []);
    const breaches = evaluatePolicy(bad, 0, DEFAULT_POLICY);
    const belowCost = breaches.find((b) => b.code === "BELOW_COST");
    expect(belowCost?.lines).toEqual([7]);
  });

  it("warns but does not block on estimated COGS", () => {
    const est = computeEngine(A(), [
      item({ cogs: 1000, rrp: 1800, estCogs: true }),
    ], []);
    const breaches = evaluatePolicy(est, 0, DEFAULT_POLICY);
    expect(breaches.some((b) => b.code === "MISSING_COGS")).toBe(true);
    expect(isWithinPolicy(breaches)).toBe(true);
  });

  it("blocks a basket discounted past the policy ceiling", () => {
    const deep = computeEngine(A({ rrpDiscount: 0.5, marginFloor: 0.05 }), [
      item({ cogs: 100, rrp: 2000 }),
    ], []);
    const breaches = evaluatePolicy(deep, 2, DEFAULT_POLICY);
    expect(breaches.some((b) => b.code === "BASKET_DISCOUNT")).toBe(true);
  });

  it("blocks a quote above the value threshold", () => {
    const big = computeEngine(A(), [
      item({ cogs: 1000, rrp: 1800, qty: 100_000 }),
    ], []);
    const breaches = evaluatePolicy(big, 0, DEFAULT_POLICY);
    expect(breaches.some((b) => b.code === "VALUE_THRESHOLD")).toBe(true);
  });

  it("blocks an empty quote", () => {
    const empty = computeEngine(A(), [], []);
    expect(isWithinPolicy(evaluatePolicy(empty, 0, DEFAULT_POLICY))).toBe(false);
  });
});
