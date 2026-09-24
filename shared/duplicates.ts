/* ============================================================
   Duplicate line detection and merging within one quotation.

   The same product can land on a quote twice — picked from the catalog
   again, typed in by hand, or brought in by a client-list import — and
   two lines for one product double-count nothing but confuse the client
   and the approver. These helpers find such lines and fold them into one.

   Identity is the item code. Only when a line has no code do we fall back
   to its name. A coded line and an uncoded line with the same name (an
   imported client row next to the same product picked from the catalog)
   are reported as a *possible* duplicate but never merged: a shared name
   is too loose to act on automatically.

   Lines of one product in different units (5 Lusin next to 10 Pcs) are
   reported but never merged — adding their quantities would be wrong.
   ============================================================ */

import type { QuoteItem } from "./types.js";

/** Name `addBlank` gives a fresh line; several blanks are not duplicates. */
export const BLANK_ITEM_NAME = "Item baru";

const norm = (s: string | undefined) => (s ?? "").trim().replace(/\s+/g, " ").toLowerCase();

export const normalizeCode = (code: string | undefined) => norm(code);

/** Product identity of a line, or null when it has nothing to match on. */
export function productKey(item: Pick<QuoteItem, "code" | "name">): string | null {
  const code = norm(item.code);
  if (code) return `code:${code}`;
  const name = norm(item.name);
  if (!name || name === norm(BLANK_ITEM_NAME)) return null;
  return `name:${name}`;
}

export interface DuplicateGroup {
  key: string;
  /** Display name, from the first line. */
  name: string;
  /** Every line of this product, in quote order. */
  lines: QuoteItem[];
  /** At least two lines share a unit, so a merge would change something. */
  mergeable: boolean;
  /** The product appears in more than one unit; those lines stay separate. */
  mixedUom: boolean;
  /** Lines that would merge disagree on COGS, RRP or manual price. */
  priceConflict: boolean;
  /** Matched only by name between coded and uncoded lines; warn, never merge. */
  nameOnly: boolean;
}

const bucketBy = <T>(xs: T[], key: (x: T) => string | null) => {
  const out = new Map<string, T[]>();
  for (const x of xs) {
    const k = key(x);
    if (k === null) continue;
    const list = out.get(k);
    if (list) list.push(x);
    else out.set(k, [x]);
  }
  return out;
};

const byUom = (lines: QuoteItem[]) => bucketBy(lines, (l) => norm(l.uom));

const samePrices = (a: QuoteItem, b: QuoteItem) =>
  a.cogs === b.cogs &&
  a.rrp === b.rrp &&
  JSON.stringify(a.manualPrice ?? []) === JSON.stringify(b.manualPrice ?? []);

/** Every product that appears on more than one line, in first-seen order. */
export function findDuplicateGroups(items: QuoteItem[]): DuplicateGroup[] {
  const groups: DuplicateGroup[] = [];
  for (const [key, lines] of bucketBy(items, productKey)) {
    if (lines.length < 2) continue;
    const units = [...byUom(lines).values()];
    const mergeSets = units.filter((u) => u.length > 1);
    groups.push({
      key,
      name: lines[0].name,
      lines,
      mergeable: mergeSets.length > 0,
      mixedUom: units.length > 1,
      priceConflict: mergeSets.some((set) => set.some((l) => !samePrices(set[0], l))),
      nameOnly: false,
    });
  }
  return groups;
}

const nameKey = (item: Pick<QuoteItem, "name">) => {
  const name = norm(item.name);
  return name && name !== norm(BLANK_ITEM_NAME) ? name : null;
};

/**
 * Lines without a code whose name matches a line that has one. These are
 * likely the same product, typically a client-list import alongside a catalog
 * pick, but only the user can tell, so they are never merged.
 */
export function findPossibleDuplicates(items: QuoteItem[]): DuplicateGroup[] {
  const groups: DuplicateGroup[] = [];
  for (const [key, lines] of bucketBy(items, nameKey)) {
    const coded = lines.filter((l) => norm(l.code));
    if (!coded.length || coded.length === lines.length) continue;
    groups.push({
      key: `maybe:${key}`,
      name: lines[0].name,
      lines,
      mergeable: false,
      mixedUom: byUom(lines).size > 1,
      priceConflict: false,
      nameOnly: true,
    });
  }
  return groups;
}

/** Everything worth telling the user about: exact duplicates, then possible ones. */
export function findLineWarnings(items: QuoteItem[]): DuplicateGroup[] {
  return [...findDuplicateGroups(items), ...findPossibleDuplicates(items)];
}

/**
 * Folds same-unit lines into the first of them. The first line keeps its id,
 * prices, role and overrides; quantities add up. The one exception: when the
 * first line's COGS is only an estimate and a later line carries a sourced
 * COGS, the sourced figure wins, so a merge never downgrades cost data.
 */
export function mergeLines(lines: QuoteItem[]): QuoteItem {
  const [first, ...rest] = lines;
  const merged: QuoteItem = { ...first, qty: lines.reduce((sum, l) => sum + (l.qty || 0), 0) };
  if (first.estCogs) {
    const sourced = rest.find((l) => !l.estCogs && l.cogs > 0);
    if (sourced) {
      merged.cogs = sourced.cogs;
      merged.estCogs = false;
    }
  }
  const notes = [...new Set(lines.map((l) => l.notes?.trim()).filter(Boolean))];
  if (notes.length) merged.notes = notes.join("; ");
  return merged;
}

/**
 * Merges every same-unit duplicate (or only those in `onlyKeys`). Each merged
 * line sits where its first occurrence was. Callers renumber afterwards.
 */
export function mergeDuplicates(items: QuoteItem[], onlyKeys?: Set<string>): QuoteItem[] {
  const absorbed = new Set<string>();
  const replaced = new Map<string, QuoteItem>();
  for (const group of findDuplicateGroups(items)) {
    if (onlyKeys && !onlyKeys.has(group.key)) continue;
    for (const set of byUom(group.lines).values()) {
      if (set.length < 2) continue;
      replaced.set(set[0].id, mergeLines(set));
      for (const l of set.slice(1)) absorbed.add(l.id);
    }
  }
  return items.filter((it) => !absorbed.has(it.id)).map((it) => replaced.get(it.id) ?? it);
}

/** Exact and possible duplicates that involve at least one `incoming` line. */
export function incomingDuplicates(existing: QuoteItem[], incoming: QuoteItem[]): DuplicateGroup[] {
  const ids = new Set(incoming.map((i) => i.id));
  return findLineWarnings([...existing, ...incoming]).filter((g) =>
    g.lines.some((l) => ids.has(l.id)),
  );
}
