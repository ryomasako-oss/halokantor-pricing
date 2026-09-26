/* Runs the importers against the real Accurate exports when they are present
   on this machine. Skipped automatically on a clean checkout or in CI. */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { detectKind, parseClientList, parseFullCatalog, parseInventory, parseItemMaster } from "./parsers.js";

const SAMPLES = path.join(os.homedir(), "Downloads");
const inventoryFile = path.join(SAMPLES, "PT Salvator Inti Pratama Inventory.xlsx");
const masterFile = path.join(SAMPLES, "daftar_barang_dan_jasa_salvatore_251008104548.xlsx");

const asFile = (p: string): File =>
  new File([fs.readFileSync(p)], path.basename(p), {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

const has = (p: string) => fs.existsSync(p);

describe.skipIf(!has(inventoryFile))("inventory import", () => {
  it("detects the file kind", async () => {
    expect(await detectKind(asFile(inventoryFile))).toBe("inventory");
  });

  it("derives a unit cost for the bulk of the catalogue", async () => {
    const { rows, report } = await parseInventory(asFile(inventoryFile));
    expect(rows.length).toBeGreaterThan(1000);
    expect(report.notes.length).toBeGreaterThan(0);

    /* Roughly 42% of this export yields a unit cost: 3.952 of 6.824 items are
       dormant, with no movement and no value in the period, so no cost can be
       derived for them at all. That is a property of the source data, not of
       the parser — see the "NILAI HILANG" / "DORMANT" flags in the file's own
       Panduan sheet. Anything above 40% means extraction is working. */
    const priced = rows.filter((r) => (r.cogs ?? 0) > 0);
    expect(priced.length / rows.length).toBeGreaterThan(0.4);
    expect(priced.length).toBeGreaterThan(2500);

    // Codes must be unique after the per-branch merge.
    expect(new Set(rows.map((r) => r.code)).size).toBe(rows.length);
    // No negative or absurd unit costs.
    for (const r of rows) {
      expect(r.cogs ?? 0).toBeGreaterThanOrEqual(0);
      expect(r.cogs ?? 0).toBeLessThan(1e9);
    }
  });

  it("computes cost as goods-received value over quantity", async () => {
    const { rows } = await parseInventory(asFile(inventoryFile));
    // 3M 4100 WHITE SP PAD 16IN: 2.052.162,109175 / 32 = 64.130,07 -> 64.130
    const pad = rows.find((r) => r.code === "100677");
    expect(pad).toBeDefined();
    expect(pad!.cogs).toBe(Math.round(2052162.109175 / 32));
  });
});

describe.skipIf(!has(masterFile))("item master import", () => {
  it("detects the file kind", async () => {
    expect(await detectKind(asFile(masterFile))).toBe("master");
  });

  it("reads codes, names, list prices and brand categories", async () => {
    const { rows } = await parseItemMaster(asFile(masterFile));
    expect(rows.length).toBeGreaterThan(100);

    const marker = rows.find((r) => r.code === "80801250");
    expect(marker?.name).toMatch(/ARTLINE EK-107R/i);
    expect(marker?.list_price).toBe(3833);
    expect(marker?.category).toBe("ARTLINE");

    // Every row carries a usable identifier.
    for (const r of rows.slice(0, 200)) {
      expect(r.code).toBeTruthy();
      expect(r.name).toBeTruthy();
    }
  });

  it("leaves units untouched: this short report has no Satuan columns", async () => {
    const { rows } = await parseItemMaster(asFile(masterFile));
    expect(rows.every((r) => r.uom === undefined && r.units === undefined)).toBe(true);
  });
});

const fullMasterFile = path.join(SAMPLES, "daftar-barang (2).xlsx");

describe.skipIf(!has(fullMasterFile))("full item master export with units", () => {
  it("reads the base unit and Satuan #2 ratios", async () => {
    const { rows, report } = await parseItemMaster(asFile(fullMasterFile));
    const sambal = rows.find((r) => r.code === "80802930");
    expect(sambal).toMatchObject({ uom: "BTL", units: [{ uom: "BOX", factor: 24 }] });
    const pad = rows.find((r) => r.code === "80802506");
    expect(pad).toMatchObject({ uom: "PCS", units: [] });
    expect(report.notes.some((n) => /satuan tambahan/.test(n))).toBe(true);
  });
});

describe("item master unit columns", () => {
  const sheetFile = (grid: unknown[][]) => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(grid), "Daftar Barang");
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    return new File([buf], "daftar.xlsx");
  };

  it("maps Satuan / Satuan #n / Rasio Satuan #n, never the price column", async () => {
    const { rows } = await parseItemMaster(
      sheetFile([
        ["Kode Barang", "Nama Barang", "Satuan", "Satuan #2", "Rasio Satuan #2", "Satuan #3", "Rasio Satuan #3", "Def. Hrg. Jual Satuan #1"],
        ["A1", "Pulpen", "PCS", "LUSIN", "12.000000", "BOX", "144.000000", "3500.000000"],
        ["A2", "Kertas", "RIM", "", "", "", "", "0"],
        ["A3", "Map", "PCS", "pcs", "1.000000", "PAK", "0", "0"],
      ]),
    );
    expect(rows[0]).toMatchObject({ uom: "PCS", list_price: 3500, units: [{ uom: "LUSIN", factor: 12 }, { uom: "BOX", factor: 144 }] });
    expect(rows[1]).toMatchObject({ uom: "RIM", units: [] });
    // A same-as-base entry and a zero ratio are both dropped.
    expect(rows[2]).toMatchObject({ uom: "PCS", units: [] });
  });
  it("full catalog template: a blank Satuan cell sends no unit, so a merge keeps the stored base", async () => {
    const { rows } = await parseFullCatalog(
      sheetFile([
        ["Kode Barang", "Nama Barang", "Satuan", "COGS"],
        ["B1", "Sambal", "", "12000"],
        ["B2", "Pulpen", "Lusin", "1000"],
      ]),
    );
    expect(rows[0].uom).toBeUndefined();
    expect(rows[1].uom).toBe("Lusin");
  });
});

describe("client request list import", () => {
  it("reads a plain list and fills in sensible defaults", async () => {
    const csv = [
      "Nama Barang,Satuan,Qty,RRP",
      "Copy Paper HVS A4 70gr,Rim,120,46000",
      "Snowman Ballpoint V-4 Blue,Pcs,300,2500",
      "TOTAL,,,",
    ].join("\n");
    const file = new File([csv], "request.csv", { type: "text/csv" });
    const { items, report } = await parseClientList(file);

    expect(items).toHaveLength(2);
    expect(items[0].name).toBe("Copy Paper HVS A4 70gr");
    expect(items[0].qty).toBe(120);
    expect(items[0].rrp).toBe(46000);
    // No cost column, so cost is estimated and flagged for review.
    expect(items[0].estCogs).toBe(true);
    expect(report.estCogs).toBe(2);
    expect(items[0].role).toBe("CORE");
  });

  it("takes the lowest city ceiling when prices are quoted per city", async () => {
    const csv = [
      "Item,Qty,Jakarta,Bandung,Surabaya",
      "Kertas A4,10,46000,47500,49000",
    ].join("\n");
    const { items, report } = await parseClientList(new File([csv], "cities.csv"));
    expect(items[0].rrp).toBe(46000);
    expect(report.fromRegion).toBe(1);
  });

  it("parses Indonesian thousand separators", async () => {
    const csv = ["Item,Qty,COGS,RRP", "Kertas A4,10,\"32.474\",\"46.000\""].join("\n");
    const { items } = await parseClientList(new File([csv], "id.csv"));
    expect(items[0].cogs).toBe(32474);
    expect(items[0].rrp).toBe(46000);
    expect(items[0].estCogs).toBe(false);
  });

  it("refuses a file with no usable rows", async () => {
    const csv = ["Nama Barang,Satuan,Qty,RRP", "TOTAL,,,"].join("\n");
    await expect(parseClientList(new File([csv], "empty.csv"))).rejects.toThrow(/Tidak ada baris item/);
  });
});
