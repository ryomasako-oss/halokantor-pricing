/* Unit-of-measure conversion for quote lines.

   Each catalog item has a base unit (catalog_items.uom, factor 1) plus
   optional extra units with a per-item ratio: "Box = 24" means one Box holds
   24 base units. Ratios are per item because a Box of pens and a Box of
   clips hold different amounts. They come from Accurate's Satuan #2-#5 /
   Rasio columns or from the catalog edit form.

   A line's cogs/rrp/manualPrice are always "per the line's unit", so the
   pricing engine, policy checks and quotation document stay unit-agnostic.
   Switching a line's unit rescales all three by newFactor / oldFactor. When
   either ratio is unknown, the unit label still changes but the numbers do
   not, and `priceUom` records which unit the numbers are really in, so the
   UI can warn and a later switch still converts from the right unit. The
   warning clears only when the rep marks the line as checked (both COGS and
   RRP), never implicitly from editing one of them. */

import type { QuoteItem, UnitFactor } from "./types.js";

export interface ItemUnits {
  baseUom: string;
  units: UnitFactor[];
}

const norm = (u: string) => u.trim().toLowerCase();

export const sameUom = (a: string, b: string) => norm(a) === norm(b);

/* Two decimals. Rupiah values are whole numbers in practice, but a ratio
   that doesn't divide evenly (25,000 per Box of 24 -> 1,041.67 per Pcs)
   needs cents so a round trip lands within Rp 1 of where it started. */
const round2 = (x: number) => Math.round(x * 100) / 100;

/** Base units in one `uom` for this item, or undefined when no ratio is known. */
export function unitFactor(units: ItemUnits | undefined, uom: string): number | undefined {
  if (!units) return undefined;
  if (sameUom(uom, units.baseUom)) return 1;
  const f = units.units.find((u) => sameUom(u.uom, uom))?.factor;
  return f && f > 0 ? f : undefined;
}

/**
 * Normalises an item's extra units before storing: drops the base unit itself
 * (its factor is always 1), blank names and non-positive ratios, and keeps
 * the first of any case-insensitive duplicates.
 */
export function cleanUnits(baseUom: string | undefined, units: UnitFactor[]): UnitFactor[] {
  const out: UnitFactor[] = [];
  for (const u of units) {
    const uom = u.uom.trim();
    if (!uom || !(u.factor > 0)) continue;
    if (baseUom && sameUom(uom, baseUom)) continue;
    if (out.some((o) => sameUom(o.uom, uom))) continue;
    out.push({ uom, factor: u.factor });
  }
  return out;
}

/** The unit this line's numbers are actually expressed in. */
export const priceUnitOf = (line: QuoteItem) => line.priceUom ?? line.uom;

/** Switches a line's unit, rescaling COGS, RRP and any manual price. */
export function changeLineUom(line: QuoteItem, to: string, units?: ItemUnits): QuoteItem {
  const from = priceUnitOf(line);
  if (sameUom(from, to)) return { ...line, uom: to, priceUom: undefined };

  const fFrom = unitFactor(units, from);
  const fTo = unitFactor(units, to);
  if (fFrom === undefined || fTo === undefined) return { ...line, uom: to, priceUom: from };

  const r = fTo / fFrom;
  return {
    ...line,
    uom: to,
    priceUom: undefined,
    cogs: round2(line.cogs * r),
    rrp: round2(line.rrp * r),
    manualPrice: line.manualPrice?.map((p) => (p === null ? null : round2(p * r))),
  };
}

/** Human-readable warning when the line's numbers are not in its shown unit. */
export function uomWarning(line: QuoteItem): string | null {
  if (!line.priceUom || sameUom(line.priceUom, line.uom)) return null;
  return `Rasio ${line.uom} belum ada: COGS/RRP masih per ${line.priceUom}, cek manual`;
}

/** The line's COGS/RRP expressed per base unit, or null when it can't be converted. */
export function toBaseUnit(line: QuoteItem, units: ItemUnits): { cogs: number; rrp: number } | null {
  const f = unitFactor(units, priceUnitOf(line));
  if (f === undefined) return null;
  return { cogs: round2(line.cogs / f), rrp: round2(line.rrp / f) };
}

/**
 * Units offered in a line's dropdown: the item's own base and extra units
 * first (Accurate may use e.g. "BTL", which isn't in the managed list), then
 * the managed list, then the line's current unit if still missing.
 * Case-insensitive de-dup, first spelling wins.
 */
export function uomChoices(managed: string[], units: ItemUnits | undefined, current: string): string[] {
  const out: string[] = [];
  const add = (u: string) => {
    if (u.trim() && !out.some((o) => sameUom(o, u))) out.push(u);
  };
  if (units) {
    add(units.baseUom);
    units.units.forEach((u) => add(u.uom));
  }
  managed.forEach(add);
  add(current);
  // A <select> needs an option whose value equals the current value exactly,
  // so the line's own spelling wins ("Pcs" on the line vs "PCS" from Accurate).
  return out.map((u) => (sameUom(u, current) ? current : u));
}
