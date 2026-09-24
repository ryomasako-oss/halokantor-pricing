/* Exports the full working file: the client-facing lines plus the internal
   margin analysis, assumptions, logistics and scenario comparison. */

import * as XLSX from "xlsx";
import { SCENARIOS } from "@shared/engine";
import type { Assumptions, EngineResult, QuoteMeta, ScenarioIndex } from "@shared/types";

interface Input {
  engine: EngineResult;
  meta: QuoteMeta;
  assumptions: Assumptions;
  scenario: ScenarioIndex;
  number: string;
  title: string;
  clientName: string;
}

const money = "#,##0";
const percent = "0.0%";

function applyFormat(sheet: XLSX.WorkSheet, columns: Record<string, string>): void {
  const range = XLSX.utils.decode_range(sheet["!ref"] || "A1");
  for (let r = range.s.r + 1; r <= range.e.r; r++) {
    for (const [col, fmt] of Object.entries(columns)) {
      const cell = sheet[`${col}${r + 1}`];
      if (cell && typeof cell.v === "number") cell.z = fmt;
    }
  }
}

export function quoteWorkbook(input: Input): XLSX.WorkBook {
  const { engine, meta, assumptions, scenario, number, title, clientName } = input;
  const wb = XLSX.utils.book_new();

  /* Client-facing sheet */
  const quoteRows = engine.rows.map((r) => ({
    No: r.lineNo,
    Kode: r.code,
    Item: r.name,
    Satuan: r.uom,
    "Qty": r.qty,
    "Harga satuan": Math.round(r.prices[scenario]),
    "Total per bulan": Math.round(r.prices[scenario] * r.qty),
  }));
  const s = engine.scen[scenario];
  quoteRows.push(
    {} as never,
    { Item: "Subtotal per bulan", "Total per bulan": Math.round(s.revenue) } as never,
    {
      Item: `PPN ${(assumptions.ppn * 100).toFixed(0)}%`,
      "Total per bulan": Math.round(s.revenue * assumptions.ppn),
    } as never,
    {
      Item: "Total per bulan termasuk PPN",
      "Total per bulan": Math.round(s.revenue * (1 + assumptions.ppn)),
    } as never,
    {
      Item: `Nilai kontrak ${assumptions.months} bulan (belum PPN)`,
      "Total per bulan": Math.round(s.annual),
    } as never,
  );
  const quoteSheet = XLSX.utils.json_to_sheet(quoteRows);
  quoteSheet["!cols"] = [{ wch: 5 }, { wch: 14 }, { wch: 46 }, { wch: 8 }, { wch: 10 }, { wch: 14 }, { wch: 16 }];
  applyFormat(quoteSheet, { E: money, F: money, G: money });
  XLSX.utils.book_append_sheet(wb, quoteSheet, "Penawaran");

  /* Internal analysis */
  const analysis = engine.rows.map((r) => ({
    No: r.lineNo,
    Item: r.name,
    Satuan: r.uom,
    Qty: r.qty,
    COGS: Math.round(r.cogs),
    "COGS estimasi": r.estCogs ? "YA" : "",
    "Landed cost": Math.round(r.landed),
    RRP: Math.round(r.rrp),
    Role: r.role,
    "S1 harga": Math.round(r.prices[0]),
    "S1 margin": r.margins[0],
    "S1 status": r.status[0],
    "S2 harga": Math.round(r.prices[1]),
    "S2 margin": r.margins[1],
    "S2 status": r.status[1],
    "S3 harga": Math.round(r.prices[2]),
    "S3 margin": r.margins[2],
    "S3 status": r.status[2],
    "Nilai terpilih/bln": Math.round(r.qty * r.prices[scenario]),
  }));
  const analysisSheet = XLSX.utils.json_to_sheet(analysis);
  analysisSheet["!cols"] = [{ wch: 5 }, { wch: 42 }, ...Array(17).fill({ wch: 12 })];
  applyFormat(analysisSheet, {
    E: money, G: money, H: money, J: money, K: percent,
    M: money, N: percent, P: money, Q: percent, S: money,
  });
  XLSX.utils.book_append_sheet(wb, analysisSheet, "Analisis Internal");

  /* Scenario comparison */
  const compare = SCENARIOS.map((sc, i) => {
    const x = engine.scen[i];
    return {
      Skenario: `${sc.key} ${sc.name}`,
      Aturan: sc.rule,
      "Revenue/bln": Math.round(x.revenue),
      "Landed cost/bln": Math.round(x.landed),
      "Profit/bln": Math.round(x.profit),
      "Net margin": x.margin,
      "Nilai kontrak": Math.round(x.annual),
      "Hemat klien": x.savingsPct,
      "Hemat item leader": x.leaderSavingsPct,
      "Item di plafon": x.atCeiling,
      "Margin terendah": x.lowestMargin,
      "Item di bawah modal": x.belowCost,
      Terpilih: i === scenario ? "YA" : "",
    };
  });
  const compareSheet = XLSX.utils.json_to_sheet(compare);
  compareSheet["!cols"] = [{ wch: 22 }, { wch: 52 }, ...Array(11).fill({ wch: 14 })];
  applyFormat(compareSheet, {
    C: money, D: money, E: money, F: percent, G: money, H: percent, I: percent, K: percent,
  });
  XLSX.utils.book_append_sheet(wb, compareSheet, "Perbandingan");

  /* Assumptions and logistics */
  const info = [
    ["Quotation", number],
    ["Judul", title],
    ["Klien", clientName],
    ["Tanggal", meta.date],
    ["Skenario terpilih", `${SCENARIOS[scenario].key} ${SCENARIOS[scenario].name}`],
    ["", ""],
    ["ASUMSI", ""],
    ["Opex", assumptions.opex],
    ["Target margin", assumptions.targetMargin],
    ["Margin leader (S2)", assumptions.leaderMargin],
    ["Diskon item profit (S2)", assumptions.profitDiscount],
    ["Diskon dari RRP (S3)", assumptions.rrpDiscount],
    ["Margin minimum (S3)", assumptions.marginFloor],
    ["PPN", assumptions.ppn],
    ["Pembulatan harga", assumptions.step],
    ["Durasi kontrak (bulan)", assumptions.months],
    ["Logistik masuk harga", assumptions.includeLogistics ? "YA" : "TIDAK"],
    ["Blended logistik", engine.blended],
    ["", ""],
    ["LOGISTIK PER REGION", ""],
    ["Region", "Share|Kirim/bln|Biaya/kirim|Biaya/bln|Modifier"],
    ...engine.regions.map((r) => [
      r.name,
      `${(r.share * 100).toFixed(0)}%|${r.deliveries}|${Math.round(r.cost)}|${Math.round(r.monthlyCost)}|${(r.modifier * 100).toFixed(2)}%`,
    ]),
  ];
  const infoSheet = XLSX.utils.aoa_to_sheet(info);
  infoSheet["!cols"] = [{ wch: 30 }, { wch: 54 }];
  XLSX.utils.book_append_sheet(wb, infoSheet, "Asumsi");

  return wb;
}

export function downloadQuoteWorkbook(input: Input): void {
  const safe = (input.number || "quotation").replace(/[^\w-]+/g, "-");
  XLSX.writeFile(quoteWorkbook(input), `${safe}.xlsx`);
}
