/* ============================================================
   Spreadsheet importers.

   Three real shapes are supported, all parsed in the browser so no
   uploaded binary ever reaches the server:

   1. Accurate "Nilai Persediaan" inventory export  -> catalog COGS
   2. Accurate "Daftar Barang dan Jasa" item master -> catalog list price
   3. A client's own request list (any layout)      -> quote line items
   ============================================================ */

import * as XLSX from "xlsx";
import { toNum } from "@shared/format";
import type { ItemRole, QuoteItem } from "@shared/types";

export interface CatalogRow {
  code: string;
  name: string;
  uom?: string;
  cogs?: number;
  list_price?: number;
  stock?: number;
  category?: string;
}

export interface ImportReport {
  sheetName: string;
  count: number;
  skipped: number;
  notes: string[];
}

const text = (v: unknown): string => String(v ?? "").trim();
const lower = (v: unknown): string => text(v).toLowerCase();

async function readWorkbook(file: File): Promise<XLSX.WorkBook> {
  /* CSV is read as raw text. Left to guess, the parser reads the Indonesian
     thousand separator in "32.474" as a decimal point and yields 32,474.
     Keeping the cells as strings lets toNum apply the Indonesian rules.
     Real .xlsx files keep their native numbers, which are unambiguous. */
  if (/\.csv$/i.test(file.name) || file.type === "text/csv") {
    return XLSX.read(await file.text(), { type: "string", raw: true });
  }
  return XLSX.read(await file.arrayBuffer(), { type: "array" });
}

type Grid = unknown[][];

function sheetGrid(wb: XLSX.WorkBook, name: string): Grid {
  return XLSX.utils.sheet_to_json(wb.Sheets[name], {
    header: 1,
    defval: "",
    blankrows: false,
  }) as Grid;
}

/** Finds the first row that satisfies a predicate within the first n rows. */
function findHeader(rows: Grid, test: (cells: string[]) => boolean, limit = 40): number {
  for (let i = 0; i < Math.min(rows.length, limit); i++) {
    if (test(rows[i].map(lower))) return i;
  }
  return -1;
}

/* ============================================================
   1. Inventory — COGS per unit
   ============================================================ */

export async function parseInventory(file: File): Promise<{ rows: CatalogRow[]; report: ImportReport }> {
  const wb = await readWorkbook(file);
  const sheetName =
    wb.SheetNames.find((n) => /list gabungan/i.test(n)) ||
    wb.SheetNames.find((n) => /nilai persediaan|persediaan|inventory/i.test(n)) ||
    wb.SheetNames[0];
  const rows = sheetGrid(wb, sheetName);

  const hi = findHeader(rows, (c) => c.some((x) => /nama barang/.test(x)) && c.some((x) => /kode barang/.test(x)));
  if (hi < 0) {
    throw new Error(
      `Sheet "${sheetName}" tidak punya kolom "Nama Barang" dan "Kode Barang". Pastikan ini laporan Nilai Persediaan dari Accurate.`,
    );
  }

  const header = rows[hi].map(lower);
  const nameCol = header.findIndex((h) => /nama barang/.test(h));
  const codeCol = header.findIndex((h) => /kode barang/.test(h));

  /* Two header layouts exist. "List Gabungan" names each column fully
     ("Masuk - Kuantitas"); the raw report splits it over two rows, with the
     group label ("Masuk") on the first and "Kuantitas"/"Nilai" on the second. */
  const group: Record<string, { qty: number; value: number }> = {};
  const flat = header.some((h) => /masuk\s*-\s*kuantitas/.test(h));

  if (flat) {
    const pick = (re: RegExp) => header.findIndex((h) => re.test(h));
    group.awal = { qty: pick(/saldo awal\s*-\s*kuantitas/), value: pick(/saldo awal\s*-\s*nilai/) };
    group.masuk = { qty: pick(/masuk\s*-\s*kuantitas/), value: pick(/masuk\s*-\s*nilai/) };
    group.akhir = { qty: pick(/saldo akhir\s*-\s*kuantitas/), value: pick(/saldo akhir\s*-\s*nilai/) };
  } else {
    const sub = (rows[hi + 1] ?? []).map(lower);
    // Carry the group label forward across the merged header cells.
    const labels: string[] = [];
    let current = "";
    const width = Math.max(header.length, sub.length);
    for (let c = 0; c < width; c++) {
      if (header[c]) current = header[c];
      labels[c] = current;
    }
    const locate = (re: RegExp, kind: RegExp) =>
      sub.findIndex((s, c) => kind.test(s) && re.test(labels[c] ?? ""));
    group.awal = { qty: locate(/saldo awal/, /kuantitas/), value: locate(/saldo awal/, /nilai/) };
    group.masuk = { qty: locate(/^masuk/, /kuantitas/), value: locate(/^masuk/, /nilai/) };
    group.akhir = { qty: locate(/saldo akhir/, /kuantitas/), value: locate(/saldo akhir/, /nilai/) };
  }

  const dataStart = flat ? hi + 1 : hi + 2;
  const out: CatalogRow[] = [];
  const seen = new Map<string, number>();
  let skipped = 0;
  let fromMasuk = 0;
  let fromSaldo = 0;
  let noValue = 0;

  const at = (row: unknown[], i: number): number => (i >= 0 ? toNum(row[i]) : NaN);

  for (const row of rows.slice(dataStart)) {
    const name = text(row[nameCol]);
    const code = text(row[codeCol]);
    if (!name || !code || /^(total|subtotal|jumlah)/i.test(name)) continue;

    // Unit cost from goods received is the truest cost; fall back to balances.
    let cogs = 0;
    const mq = at(row, group.masuk.qty);
    const mv = at(row, group.masuk.value);
    const aq = at(row, group.akhir.qty);
    const av = at(row, group.akhir.value);
    const wq = at(row, group.awal.qty);
    const wv = at(row, group.awal.value);

    if (mq > 0 && mv > 0) {
      cogs = mv / mq;
      fromMasuk++;
    } else if (aq > 0 && av > 0) {
      cogs = av / aq;
      fromSaldo++;
    } else if (wq > 0 && wv > 0) {
      cogs = wv / wq;
      fromSaldo++;
    } else {
      noValue++;
    }

    const stock = Number.isFinite(aq) ? aq : 0;
    const rounded = Math.round(cogs);

    // The same item can appear once per branch; keep the best-evidenced row.
    const existingIndex = seen.get(code);
    if (existingIndex !== undefined) {
      const prev = out[existingIndex];
      if ((prev.cogs ?? 0) === 0 && rounded > 0) prev.cogs = rounded;
      prev.stock = (prev.stock ?? 0) + stock;
      skipped++;
      continue;
    }
    seen.set(code, out.length);
    out.push({ code, name, cogs: rounded, stock });
  }

  if (!out.length) throw new Error("Tidak ada baris barang yang terbaca dari file inventory.");

  const notes = [
    `${fromMasuk} item memakai harga dari barang masuk (paling akurat).`,
    fromSaldo ? `${fromSaldo} item memakai nilai saldo karena tidak ada pembelian di periode ini.` : "",
    noValue ? `${noValue} item tidak punya nilai sama sekali, COGS diisi 0 dan perlu dilengkapi manual.` : "",
    skipped ? `${skipped} baris duplikat digabung (barang yang sama di beberapa cabang).` : "",
  ].filter(Boolean);

  return { rows: out, report: { sheetName, count: out.length, skipped, notes } };
}

/* ============================================================
   2. Item master — list price and stock
   ============================================================ */

export async function parseItemMaster(file: File): Promise<{ rows: CatalogRow[]; report: ImportReport }> {
  const wb = await readWorkbook(file);
  const sheetName = wb.SheetNames.find((n) => /daftar barang/i.test(n)) || wb.SheetNames[0];
  const rows = sheetGrid(wb, sheetName);

  const hi = findHeader(
    rows,
    (c) => c.some((x) => /kode barang/.test(x)) && c.some((x) => /nama barang/.test(x)),
  );
  if (hi < 0) {
    throw new Error(
      `Sheet "${sheetName}" tidak punya kolom "Kode Barang" dan "Nama Barang". Pastikan ini export Daftar Barang dan Jasa.`,
    );
  }
  const header = rows[hi].map(lower);
  const codeCol = header.findIndex((h) => /kode barang/.test(h));
  const nameCol = header.findIndex((h) => /nama barang/.test(h));
  const priceCol = header.findIndex((h) => /hrg\.? jual|harga jual/.test(h));
  const stockCol = header.findIndex((h) => /^kts|kuantitas/.test(h));
  const typeCol = header.findIndex((h) => /jenis barang/.test(h));

  const out: CatalogRow[] = [];
  let category = "";
  let skipped = 0;
  let priced = 0;

  for (const row of rows.slice(hi + 1)) {
    const code = text(row[codeCol]);
    const name = text(row[nameCol]);
    // Brand grouping rows carry a label but no code or name.
    if (!code || !name) {
      const label = row.map(text).filter(Boolean);
      if (label.length === 1 && label[0].length < 40) category = label[0];
      else skipped++;
      continue;
    }
    if (/^(total|subtotal|jumlah)/i.test(name)) continue;
    if (typeCol >= 0 && /jasa/i.test(text(row[typeCol]))) {
      skipped++;
      continue;
    }
    const price = priceCol >= 0 ? toNum(row[priceCol]) : NaN;
    if (price > 0) priced++;
    out.push({
      code,
      name,
      list_price: price > 0 ? Math.round(price) : 0,
      stock: stockCol >= 0 && Number.isFinite(toNum(row[stockCol])) ? toNum(row[stockCol]) : 0,
      category,
    });
  }

  if (!out.length) throw new Error("Tidak ada baris barang yang terbaca dari daftar barang.");

  return {
    rows: out,
    report: {
      sheetName,
      count: out.length,
      skipped,
      notes: [
        `${priced} item punya harga jual default yang bisa dipakai sebagai acuan RRP.`,
        out.length - priced > 0
          ? `${out.length - priced} item belum punya harga jual di master, plafonnya harus diisi manual.`
          : "",
      ].filter(Boolean),
    },
  };
}

/* ============================================================
   3. Full catalog template — one row per item, replaces the catalog
   ============================================================ */

const FULL_CATALOG_HEADERS = [
  "Kode Barang",
  "Nama Barang",
  "Kategori",
  "Satuan",
  "COGS",
  "Harga Jual",
  "Stok",
];

const FULL_CATALOG_SAMPLE: (string | number)[][] = [
  ["ATK-0001", "Pulpen Standard AE7", "Alat Tulis", "Pcs", 2100, 3500, 480],
  ["ATK-0002", "Kertas HVS A4 80gr", "Kertas", "Rim", 42000, 55000, 0],
];

/** Builds and triggers a download of the blank full-catalog import template. */
export function downloadFullCatalogTemplate(): void {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([FULL_CATALOG_HEADERS, ...FULL_CATALOG_SAMPLE]);
  ws["!cols"] = [{ wch: 14 }, { wch: 32 }, { wch: 16 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 10 }];
  XLSX.utils.book_append_sheet(wb, ws, "Katalog");
  XLSX.writeFile(wb, "template barang pricing engine.xlsx");
}

export async function parseFullCatalog(file: File): Promise<{ rows: CatalogRow[]; report: ImportReport }> {
  const wb = await readWorkbook(file);
  const sheetName = wb.SheetNames.find((n) => /katalog/i.test(n)) || wb.SheetNames[0];
  const rows = sheetGrid(wb, sheetName);

  const hi = findHeader(rows, (c) => c.some((x) => /kode barang|kode/.test(x)) && c.some((x) => /nama barang|nama/.test(x)));
  if (hi < 0) {
    throw new Error(
      `Sheet "${sheetName}" tidak punya kolom "Kode Barang" dan "Nama Barang". Pakai template yang disediakan.`,
    );
  }
  const header = rows[hi].map(lower);
  const col = {
    code: header.findIndex((h) => /kode barang|^kode$/.test(h)),
    name: header.findIndex((h) => /nama barang|^nama$/.test(h)),
    uom: header.findIndex((h) => /satuan|uom/.test(h)),
    category: header.findIndex((h) => /kategori/.test(h)),
    cogs: header.findIndex((h) => /cogs|hpp|harga pokok/.test(h)),
    listPrice: header.findIndex((h) => /harga jual|rrp|list price/.test(h)),
    stock: header.findIndex((h) => /^stok$|stock/.test(h)),
  };
  if (col.code < 0 || col.name < 0) {
    throw new Error("Kolom Kode Barang dan Nama Barang wajib ada. Pakai template yang disediakan.");
  }

  const out: CatalogRow[] = [];
  const seen = new Set<string>();
  let skipped = 0;

  for (const row of rows.slice(hi + 1)) {
    const code = text(row[col.code]);
    const name = text(row[col.name]);
    if (!code || !name || /^(total|subtotal|jumlah)/i.test(name)) continue;
    if (seen.has(code)) {
      skipped++;
      continue;
    }
    seen.add(code);
    out.push({
      code,
      name,
      uom: col.uom >= 0 ? text(row[col.uom]) || "Pcs" : "Pcs",
      category: col.category >= 0 ? text(row[col.category]) : "",
      cogs: col.cogs >= 0 ? Math.max(0, Math.round(toNum(row[col.cogs]))) : 0,
      list_price: col.listPrice >= 0 ? Math.max(0, Math.round(toNum(row[col.listPrice]))) : 0,
      stock: col.stock >= 0 && Number.isFinite(toNum(row[col.stock])) ? toNum(row[col.stock]) : 0,
    });
  }

  if (!out.length) throw new Error("Tidak ada baris barang yang terbaca dari file.");

  return {
    rows: out,
    report: {
      sheetName,
      count: out.length,
      skipped,
      notes: skipped ? [`${skipped} baris dengan kode duplikat dilewati (baris pertama dipakai).`] : [],
    },
  };
}

/* ============================================================
   4. Client request list — quote line items
   ============================================================ */

export interface ParsedItems {
  items: QuoteItem[];
  report: ImportReport & { estCogs: number; fromRegion: number; hasQty: boolean; hasRole: boolean };
}

const CITY =
  /jakarta|bogor|bandung|surabaya|medan|semarang|makassar|palembang|pekanbaru|lampung|jambi|riau|kalimantan|sumatera|bekasi|tangerang|depok|solo|yogya|malang|denpasar|balikpapan/;

export async function parseClientList(file: File): Promise<ParsedItems> {
  const wb = await readWorkbook(file);
  const sheetName =
    wb.SheetNames.find((n) => /base_economics/i.test(n)) ||
    wb.SheetNames.find((n) => /item|kebutuhan|atk|penawaran|request|rfq/i.test(n)) ||
    wb.SheetNames[0];
  const rows = sheetGrid(wb, sheetName);

  const hi = findHeader(
    rows,
    (c) =>
      c.some((x) => /item|nama barang|nama|deskripsi|description|barang/.test(x)) &&
      c.filter(Boolean).length >= 3,
    30,
  );
  if (hi < 0) {
    throw new Error(`Sheet "${sheetName}" tidak punya baris judul dengan kolom nama item.`);
  }

  const header = rows[hi].map(lower);
  const find = (re: RegExp) => header.findIndex((h) => re.test(h));
  const col = {
    name: find(/^(item|nama barang|nama item|nama|deskripsi|description|barang)/),
    code: find(/kode|code|sku/),
    uom: find(/uom|satuan|unit/),
    qty: find(/qty|kuantitas|jumlah|quantity|kebutuhan|kts/),
    cogs: find(/cogs|hpp|harga beli|modal|supplier/),
    rrp: find(/rrp|ceiling|plafon|harga maks|het|harga kontrak|budget/),
    role: find(/role|peran/),
  };
  if (col.name < 0) col.name = find(/item|nama|barang/);
  if (col.name < 0) throw new Error("Kolom nama item tidak ditemukan di baris judul.");

  const cityCols = header.map((h, i) => (CITY.test(h) ? i : -1)).filter((i) => i >= 0);

  const items: QuoteItem[] = [];
  let skipped = 0;
  let estCogs = 0;
  let fromRegion = 0;

  for (const row of rows.slice(hi + 1)) {
    const name = text(row[col.name]);
    if (!name || /^(total|subtotal|jumlah|grand total)/i.test(name)) continue;

    let rrp = col.rrp >= 0 ? toNum(row[col.rrp]) : NaN;
    // Ceilings quoted per city: the lowest one is the binding constraint.
    if (!(rrp > 0) && cityCols.length) {
      const values = cityCols.map((i) => toNum(row[i])).filter((v) => v > 0);
      if (values.length) {
        rrp = Math.min(...values);
        fromRegion++;
      }
    }

    let cogs = col.cogs >= 0 ? toNum(row[col.cogs]) : NaN;
    let est = false;
    if (!(cogs > 0)) {
      cogs = rrp > 0 ? Math.round(rrp * 0.7) : 0;
      est = true;
      estCogs++;
    }

    if (!(rrp > 0) && !(cogs > 0)) {
      skipped++;
      continue;
    }

    const qty = col.qty >= 0 ? toNum(row[col.qty]) : NaN;
    const roleRaw = col.role >= 0 ? text(row[col.role]).toUpperCase() : "";
    items.push({
      id: `imp-${items.length}-${Math.random().toString(36).slice(2, 7)}`,
      lineNo: items.length + 1,
      code: col.code >= 0 ? text(row[col.code]) : "",
      name,
      uom: col.uom >= 0 ? text(row[col.uom]) || "Pcs" : "Pcs",
      qty: qty > 0 ? qty : 1,
      cogs: Math.round(cogs),
      rrp: rrp > 0 ? Math.round(rrp) : 0,
      role: (["LEADER", "CORE", "PROFIT"].includes(roleRaw) ? roleRaw : "CORE") as ItemRole,
      estCogs: est,
    });
  }

  if (!items.length) {
    throw new Error("Tidak ada baris item yang terbaca. Pastikan ada kolom nama item dan harga.");
  }

  const notes = [
    fromRegion ? `${fromRegion} item memakai plafon terendah dari kolom kota.` : "",
    estCogs ? `${estCogs} item belum punya COGS; cocokkan dengan katalog atau isi manual.` : "",
    col.qty < 0 ? "Kolom qty tidak ditemukan, semua qty diisi 1." : "",
    col.role < 0 ? "Kolom role tidak ada, semua item dianggap CORE." : "",
    skipped ? `${skipped} baris dilewati karena tidak punya harga sama sekali.` : "",
  ].filter(Boolean);

  return {
    items,
    report: {
      sheetName,
      count: items.length,
      skipped,
      estCogs,
      fromRegion,
      hasQty: col.qty >= 0,
      hasRole: col.role >= 0,
      notes,
    },
  };
}

/** Detects which importer suits a workbook, so the UI can pick automatically. */
export async function detectKind(file: File): Promise<"inventory" | "master" | "client"> {
  const wb = await readWorkbook(file);
  const names = wb.SheetNames.map((n) => n.toLowerCase()).join("|");
  if (/nilai persediaan|list gabungan/.test(names)) return "inventory";
  if (/daftar barang/.test(names)) return "master";
  const first = sheetGrid(wb, wb.SheetNames[0])
    .slice(0, 12)
    .map((r) => r.map(lower).join(" "))
    .join(" ");
  if (/nilai persediaan/.test(first)) return "inventory";
  if (/daftar barang dan jasa/.test(first)) return "master";
  return "client";
}
