import { describe, expect, it } from "vitest";
import {
  findDuplicateGroups, incomingDuplicates, mergeDuplicates, mergeLines, productKey,
} from "./duplicates.js";
import type { QuoteItem } from "./types.js";

let seq = 0;
const item = (over: Partial<QuoteItem> = {}): QuoteItem => ({
  id: `l${++seq}`,
  lineNo: 1,
  code: "ATK-001",
  name: "Kertas A4",
  uom: "Rim",
  qty: 10,
  cogs: 40000,
  rrp: 55000,
  role: "CORE",
  ...over,
});

describe("productKey", () => {
  it("matches codes regardless of case and surrounding/inner whitespace", () => {
    expect(productKey(item({ code: " atk-001 " }))).toBe(productKey(item({ code: "ATK-001" })));
    expect(productKey(item({ code: "ATK  001" }))).toBe(productKey(item({ code: "atk 001" })));
  });

  it("falls back to the name only when there is no code", () => {
    expect(productKey(item({ code: "", name: " Pulpen  Hitam " }))).toBe("name:pulpen hitam");
  });

  it("never matches a coded line to an uncoded line by name", () => {
    expect(productKey(item({ code: "X1", name: "Pulpen" }))).not.toBe(
      productKey(item({ code: "", name: "Pulpen" })),
    );
  });

  it("gives blank placeholder lines no identity", () => {
    expect(productKey(item({ code: "", name: "Item baru" }))).toBeNull();
    expect(productKey(item({ code: "", name: "  " }))).toBeNull();
  });
});

describe("findDuplicateGroups", () => {
  it("returns nothing for an empty or duplicate-free quote", () => {
    expect(findDuplicateGroups([])).toEqual([]);
    expect(findDuplicateGroups([item(), item({ code: "ATK-002" })])).toEqual([]);
  });

  it("ignores several blank lines added with 'tambah baris'", () => {
    const blank = () => item({ code: "", name: "Item baru", cogs: 0, rrp: 0 });
    expect(findDuplicateGroups([blank(), blank(), blank()])).toEqual([]);
  });

  it("groups a three-way duplicate in quote order", () => {
    const a = item(), b = item({ code: "ATK-002" }), c = item(), d = item({ code: "atk-001" });
    const groups = findDuplicateGroups([a, b, c, d]);
    expect(groups).toHaveLength(1);
    expect(groups[0].lines.map((l) => l.id)).toEqual([a.id, c.id, d.id]);
    expect(groups[0]).toMatchObject({ mergeable: true, mixedUom: false, priceConflict: false });
  });

  it("reports same product in different units, but not as mergeable", () => {
    const [g] = findDuplicateGroups([item({ uom: "Pcs" }), item({ uom: "Lusin" })]);
    expect(g).toMatchObject({ mergeable: false, mixedUom: true });
  });

  it("is mergeable when two of three share a unit", () => {
    const [g] = findDuplicateGroups([item({ uom: "Pcs" }), item({ uom: "Lusin" }), item({ uom: "pcs" })]);
    expect(g).toMatchObject({ mergeable: true, mixedUom: true });
  });

  it("flags differing COGS, RRP or manual price among lines that would merge", () => {
    expect(findDuplicateGroups([item(), item({ cogs: 41000 })])[0].priceConflict).toBe(true);
    expect(findDuplicateGroups([item(), item({ rrp: 50000 })])[0].priceConflict).toBe(true);
    expect(
      findDuplicateGroups([item(), item({ manualPrice: [50000, null, null] })])[0].priceConflict,
    ).toBe(true);
  });

  it("does not flag a price difference between lines in different units", () => {
    const [g] = findDuplicateGroups([item({ uom: "Pcs", cogs: 1000 }), item({ uom: "Lusin", cogs: 12000 })]);
    expect(g.priceConflict).toBe(false);
  });
});

describe("mergeLines", () => {
  it("sums qty and keeps the first line's id, prices and overrides", () => {
    const a = item({ qty: 10, role: "LEADER", manualPrice: [50000, null, null] });
    const b = item({ qty: 5, cogs: 99999, rrp: 1, role: "PROFIT" });
    expect(mergeLines([a, b])).toEqual({ ...a, qty: 15 });
  });

  it("prefers a sourced COGS over the first line's estimate", () => {
    const merged = mergeLines([item({ cogs: 30000, estCogs: true }), item({ cogs: 42000, estCogs: false })]);
    expect(merged).toMatchObject({ cogs: 42000, estCogs: false });
  });

  it("keeps a sourced COGS over a later estimate", () => {
    const merged = mergeLines([item({ cogs: 40000 }), item({ cogs: 1, estCogs: true })]);
    expect(merged.cogs).toBe(40000);
  });

  it("joins distinct notes", () => {
    const merged = mergeLines([item({ notes: "Kirim Senin" }), item({ notes: "Kirim Senin" }), item({ notes: "Warna putih" })]);
    expect(merged.notes).toBe("Kirim Senin; Warna putih");
  });
});

describe("mergeDuplicates", () => {
  it("merges in place of the first occurrence and drops the rest", () => {
    const a = item({ qty: 1 }), b = item({ code: "ATK-002" }), c = item({ qty: 2 });
    const out = mergeDuplicates([a, b, c]);
    expect(out.map((l) => l.id)).toEqual([a.id, b.id]);
    expect(out[0].qty).toBe(3);
  });

  it("leaves different-unit lines of the same product separate", () => {
    const a = item({ uom: "Pcs", qty: 10 }), b = item({ uom: "Lusin", qty: 2 }), c = item({ uom: "Pcs", qty: 5 });
    const out = mergeDuplicates([a, b, c]);
    expect(out.map((l) => [l.id, l.qty])).toEqual([[a.id, 15], [b.id, 2]]);
  });

  it("only touches the groups it is asked to", () => {
    const a = item(), b = item(), x = item({ code: "Z" }), y = item({ code: "Z" });
    const out = mergeDuplicates([a, b, x, y], new Set(["code:z"]));
    expect(out.map((l) => l.id)).toEqual([a.id, b.id, x.id]);
  });

  it("is a no-op on a quote without duplicates", () => {
    const items = [item(), item({ code: "ATK-002" })];
    expect(mergeDuplicates(items)).toEqual(items);
  });
});

describe("incomingDuplicates", () => {
  it("reports only groups touched by the new lines", () => {
    const old1 = item({ code: "OLD" }), old2 = item({ code: "OLD" });
    const existing = [old1, old2, item({ code: "ATK-001" })];
    const incoming = [item({ code: "atk-001" }), item({ code: "NEW" })];
    const groups = incomingDuplicates(existing, incoming);
    expect(groups.map((g) => g.key)).toEqual(["code:atk-001"]);
  });
});
