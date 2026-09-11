/* ============================================================
   Pricing policy.

   Turns an engine result into a list of breaches. A "block" breach
   means the quote cannot be approved by its author and must go to a
   manager; a "warn" breach is surfaced but does not gate anything.
   ============================================================ */

import type {
  EngineResult,
  PolicyBreach,
  PricingPolicy,
  ScenarioIndex,
} from "./types.js";

export const DEFAULT_POLICY: PricingPolicy = {
  minNetMargin: 0.15,
  minLineMargin: 0.0,
  maxBasketDiscount: 0.35,
  allowBelowCost: false,
  approvalValueThreshold: 50_000_000,
};

const pctText = (x: number, d = 1) =>
  `${(x * 100).toFixed(d).replace(".", ",")}%`;
const rpText = (n: number) =>
  "Rp " + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");

export function evaluatePolicy(
  engine: EngineResult,
  scenario: ScenarioIndex,
  policy: PricingPolicy,
): PolicyBreach[] {
  const breaches: PolicyBreach[] = [];
  const s = engine.scen[scenario];
  if (!s) return breaches;

  if (engine.rows.length === 0) {
    breaches.push({
      code: "NET_MARGIN",
      severity: "block",
      message: "Quotation belum punya item.",
    });
    return breaches;
  }

  if (s.margin < policy.minNetMargin) {
    breaches.push({
      code: "NET_MARGIN",
      severity: "block",
      message: `Net margin ${pctText(s.margin)} di bawah batas kebijakan ${pctText(
        policy.minNetMargin,
      )}.`,
    });
  }

  const belowCost = engine.rows.filter((r) => r.margins[scenario] < 0);
  if (belowCost.length && !policy.allowBelowCost) {
    breaches.push({
      code: "BELOW_COST",
      severity: "block",
      message: `${belowCost.length} item dijual di bawah landed cost.`,
      lines: belowCost.map((r) => r.lineNo),
    });
  }

  const thinLines = engine.rows.filter(
    (r) => r.margins[scenario] >= 0 && r.margins[scenario] < policy.minLineMargin,
  );
  if (thinLines.length) {
    breaches.push({
      code: "LINE_MARGIN",
      severity: "block",
      message: `${thinLines.length} item marginnya di bawah batas per item ${pctText(
        policy.minLineMargin,
      )}.`,
      lines: thinLines.map((r) => r.lineNo),
    });
  }

  if (s.savingsPct > policy.maxBasketDiscount) {
    breaches.push({
      code: "BASKET_DISCOUNT",
      severity: "block",
      message: `Diskon total ${pctText(s.savingsPct)} melewati batas ${pctText(
        policy.maxBasketDiscount,
      )} dari RRP.`,
    });
  }

  if (s.revenue > policy.approvalValueThreshold) {
    breaches.push({
      code: "VALUE_THRESHOLD",
      severity: "block",
      message: `Nilai ${rpText(s.revenue)} per bulan melewati ambang persetujuan ${rpText(
        policy.approvalValueThreshold,
      )}.`,
    });
  }

  const estimated = engine.rows.filter((r) => r.estCogs);
  if (estimated.length) {
    breaches.push({
      code: "MISSING_COGS",
      severity: "warn",
      message: `${estimated.length} item masih memakai COGS estimasi, bukan angka dari inventory.`,
      lines: estimated.map((r) => r.lineNo),
    });
  }

  return breaches;
}

/** True when nothing blocks approval — only warnings, or nothing at all. */
export const isWithinPolicy = (breaches: PolicyBreach[]): boolean =>
  !breaches.some((b) => b.severity === "block");
