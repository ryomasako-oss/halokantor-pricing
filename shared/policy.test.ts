import { describe, expect, it } from "vitest";
import { computeEngine, DEFAULT_ASSUMPTIONS } from "./engine.js";
import { DEFAULT_POLICY, evaluatePolicy, isWithinPolicy } from "./policy.js";
import type { Assumptions, PricingPolicy, QuoteItem } from "./types.js";

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

const P = (over: Partial<PricingPolicy> = {}): PricingPolicy => ({
  ...DEFAULT_POLICY,
  ...over,
});

describe("empty quote", () => {
  it("blocks with NET_MARGIN and returns nothing else", () => {
    const e = computeEngine(A(), [], []);
    const breaches = evaluatePolicy(e, 0, DEFAULT_POLICY);
    expect(breaches).toHaveLength(1);
    expect(breaches[0]).toMatchObject({ code: "NET_MARGIN", severity: "block" });
    expect(isWithinPolicy(breaches)).toBe(false);
  });
});

describe("NET_MARGIN", () => {
  it("blocks when scenario margin is below the policy floor", () => {
    // targetMargin 0.08 keeps S1 well under the default 15% floor.
    const e = computeEngine(A({ targetMargin: 0.08 }), [item()], []);
    const breaches = evaluatePolicy(e, 0, DEFAULT_POLICY);
    expect(breaches.some((b) => b.code === "NET_MARGIN" && b.severity === "block")).toBe(true);
  });

  it("does not fire when margin clears the floor", () => {
    const e = computeEngine(A({ targetMargin: 0.25 }), [item()], []);
    const breaches = evaluatePolicy(e, 0, DEFAULT_POLICY);
    expect(breaches.some((b) => b.code === "NET_MARGIN")).toBe(false);
  });
});

describe("BELOW_COST", () => {
  it("blocks when a line prices below landed cost", () => {
    const e = computeEngine(A(), [item({ manualPrice: [500, null, null] })], []);
    const breaches = evaluatePolicy(e, 0, DEFAULT_POLICY);
    const b = breaches.find((x) => x.code === "BELOW_COST");
    expect(b).toBeDefined();
    expect(b?.severity).toBe("block");
    expect(b?.lines).toEqual([1]);
  });

  it("is suppressed when allowBelowCost is true", () => {
    const e = computeEngine(A(), [item({ manualPrice: [500, null, null] })], []);
    const breaches = evaluatePolicy(e, 0, P({ allowBelowCost: true }));
    expect(breaches.some((b) => b.code === "BELOW_COST")).toBe(false);
  });

  it("does not fire on a clean quote", () => {
    const e = computeEngine(A(), [item()], []);
    const breaches = evaluatePolicy(e, 0, DEFAULT_POLICY);
    expect(breaches.some((b) => b.code === "BELOW_COST")).toBe(false);
  });
});

describe("LINE_MARGIN", () => {
  it("is unreachable under the default policy (minLineMargin 0)", () => {
    // A thin-but-nonnegative line can't be < 0, so with the default
    // floor of 0 this code never fires — documents that the check is
    // dormant, not broken, until a stricter policy sets it above 0.
    const e = computeEngine(A({ targetMargin: 0.01 }), [item()], []);
    const breaches = evaluatePolicy(e, 0, DEFAULT_POLICY);
    expect(breaches.some((b) => b.code === "LINE_MARGIN")).toBe(false);
  });

  it("blocks a nonnegative-but-thin line once minLineMargin is raised", () => {
    // targetMargin 0.06 puts S1's line margin just above 0 but under a
    // 10% per-line floor.
    const e = computeEngine(A({ targetMargin: 0.06 }), [item()], []);
    const lineMargin = e.rows[0].margins[0];
    expect(lineMargin).toBeGreaterThanOrEqual(0);
    expect(lineMargin).toBeLessThan(0.1);

    const breaches = evaluatePolicy(e, 0, P({ minLineMargin: 0.1 }));
    const b = breaches.find((x) => x.code === "LINE_MARGIN");
    expect(b).toBeDefined();
    expect(b?.severity).toBe("block");
    expect(b?.lines).toEqual([1]);
  });

  it("does not double-count a below-cost line as LINE_MARGIN too", () => {
    const e = computeEngine(A(), [item({ manualPrice: [500, null, null] })], []);
    const breaches = evaluatePolicy(e, 0, P({ minLineMargin: 0.5 }));
    expect(breaches.some((b) => b.code === "LINE_MARGIN")).toBe(false);
    expect(breaches.some((b) => b.code === "BELOW_COST")).toBe(true);
  });
});

describe("BASKET_DISCOUNT", () => {
  it("blocks when the basket discount off RRP exceeds the cap", () => {
    const e = computeEngine(A({ rrpDiscount: 0.5, marginFloor: 0.01 }), [item()], []);
    const breaches = evaluatePolicy(e, 2, DEFAULT_POLICY);
    expect(breaches.some((b) => b.code === "BASKET_DISCOUNT" && b.severity === "block")).toBe(true);
  });

  it("does not fire on a modest discount", () => {
    const e = computeEngine(A({ rrpDiscount: 0.1, marginFloor: 0.05 }), [item()], []);
    const breaches = evaluatePolicy(e, 2, DEFAULT_POLICY);
    expect(breaches.some((b) => b.code === "BASKET_DISCOUNT")).toBe(false);
  });
});

describe("VALUE_THRESHOLD", () => {
  it("blocks a large-enough order regardless of healthy margin", () => {
    const e = computeEngine(A({ targetMargin: 0.25 }), [item({ qty: 100000 })], []);
    expect(e.scen[0].margin).toBeGreaterThanOrEqual(0.15);
    const breaches = evaluatePolicy(e, 0, DEFAULT_POLICY);
    expect(breaches.some((b) => b.code === "VALUE_THRESHOLD" && b.severity === "block")).toBe(true);
  });

  it("does not fire under the threshold", () => {
    const e = computeEngine(A({ targetMargin: 0.25 }), [item({ qty: 10 })], []);
    const breaches = evaluatePolicy(e, 0, DEFAULT_POLICY);
    expect(breaches.some((b) => b.code === "VALUE_THRESHOLD")).toBe(false);
  });
});

describe("MISSING_COGS", () => {
  it("warns but never blocks, and never fails isWithinPolicy alone", () => {
    const e = computeEngine(A({ targetMargin: 0.25 }), [item({ estCogs: true })], []);
    const breaches = evaluatePolicy(e, 0, DEFAULT_POLICY);
    const b = breaches.find((x) => x.code === "MISSING_COGS");
    expect(b).toBeDefined();
    expect(b?.severity).toBe("warn");
    expect(isWithinPolicy(breaches)).toBe(true);
  });

  it("does not fire when COGS is sourced, not estimated", () => {
    const e = computeEngine(A({ targetMargin: 0.25 }), [item({ estCogs: false })], []);
    const breaches = evaluatePolicy(e, 0, DEFAULT_POLICY);
    expect(breaches.some((b) => b.code === "MISSING_COGS")).toBe(false);
  });
});

describe("isWithinPolicy", () => {
  it("is true with no breaches at all", () => {
    expect(isWithinPolicy([])).toBe(true);
  });

  it("is false when any breach is a block, even alongside warnings", () => {
    const breaches = [
      { code: "MISSING_COGS" as const, severity: "warn" as const, message: "" },
      { code: "NET_MARGIN" as const, severity: "block" as const, message: "" },
    ];
    expect(isWithinPolicy(breaches)).toBe(false);
  });
});

describe("multiple breaches compound", () => {
  it("reports NET_MARGIN and BELOW_COST together, not just one", () => {
    const e = computeEngine(
      A({ targetMargin: 0.05 }),
      [item({ manualPrice: [500, null, null] })],
      [],
    );
    const breaches = evaluatePolicy(e, 0, DEFAULT_POLICY);
    expect(breaches.some((b) => b.code === "NET_MARGIN")).toBe(true);
    expect(breaches.some((b) => b.code === "BELOW_COST")).toBe(true);
  });
});
