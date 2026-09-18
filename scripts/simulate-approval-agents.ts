/* ============================================================
   Two-agent simulation of the quote → approval workflow.

   "Maker" builds a quote proposal (items, assumptions, scenario)
   from a scenario spec and prices it with the real engine.
   "Approval" runs the real policy check and decides approve/reject.

   Both agents call the exact same shared/engine.ts + shared/policy.ts
   code the production app uses — this is not an LLM role-play, it's
   a deterministic replay of the real decision logic across a set of
   hand-designed scenarios, so the approve/reject split is reproducible.

   Run: npx tsx scripts/simulate-approval-agents.ts
   Output: scripts/agent-simulation-log.md (full transcript) +
           a summary printed to stdout.
   ============================================================ */

import { writeFileSync } from "node:fs";
import { computeEngine, DEFAULT_ASSUMPTIONS, DEFAULT_REGIONS } from "../shared/engine.js";
import { DEFAULT_POLICY, evaluatePolicy, isWithinPolicy } from "../shared/policy.js";
import type { Assumptions, ItemRole, PolicyBreach, QuoteItem, ScenarioIndex } from "../shared/types.js";

interface ItemSpec {
  code: string;
  name: string;
  uom: string;
  qty: number;
  cogs: number;
  rrp: number;
  role?: ItemRole;
  estCogs?: boolean;
  manualPrice?: (number | null)[];
}

interface ScenarioSpec {
  id: string;
  client: string;
  pitch: string;
  scenario: ScenarioIndex;
  assumptions: Partial<Assumptions>;
  items: ItemSpec[];
  expected: "approve" | "reject";
}

const SCENARIO_LABEL = { 0: "S1 Full Margin", 1: "S2 Cross Subsidise", 2: "S3 RRP Discount" } as const;

function items(specs: ItemSpec[]): QuoteItem[] {
  return specs.map((s, i) => ({
    id: `it${i + 1}`,
    lineNo: i + 1,
    code: s.code,
    name: s.name,
    uom: s.uom,
    qty: s.qty,
    cogs: s.cogs,
    rrp: s.rrp,
    role: s.role ?? "CORE",
    estCogs: s.estCogs,
    manualPrice: s.manualPrice,
  }));
}

// ---------------------------------------------------------------
// 20 scenarios: 10 designed to clear DEFAULT_POLICY, 10 designed to
// breach it (each exercising a different block code or combination).
// ---------------------------------------------------------------
const SCENARIOS: ScenarioSpec[] = [
  // ---- approve (10) ----
  {
    id: "A1",
    client: "PT Agrinesia",
    pitch: "Kontrak ATK bulanan standar, S1 cost-plus normal.",
    scenario: 0,
    assumptions: {},
    items: items([
      { code: "ATK-001", name: "Kertas A4 80gsm", uom: "rim", qty: 200, cogs: 38000, rrp: 55000 },
      { code: "ATK-002", name: "Pulpen gel biru", uom: "pcs", qty: 500, cogs: 2200, rrp: 4000 },
      { code: "ATK-003", name: "Stapler kecil", uom: "pcs", qty: 40, cogs: 15000, rrp: 25000 },
    ]),
    expected: "approve",
  },
  {
    id: "A2",
    client: "PT Bahtera Adi Jaya",
    pitch: "S2 cross-subsidy sehat: leader tipis, profit line menutup.",
    scenario: 1,
    assumptions: { leaderMargin: 0.1, profitDiscount: 0.02 },
    items: items([
      { code: "ATK-010", name: "Printer laser mono", uom: "unit", qty: 5, cogs: 1800000, rrp: 2600000, role: "LEADER" },
      { code: "ATK-011", name: "Toner compatible", uom: "pcs", qty: 60, cogs: 180000, rrp: 320000, role: "PROFIT" },
      { code: "ATK-012", name: "Kertas foto", uom: "pak", qty: 30, cogs: 45000, rrp: 70000, role: "CORE" },
    ]),
    expected: "approve",
  },
  {
    id: "A3",
    client: "CV Mitra Sejahtera",
    pitch: "S3 diskon RRP moderat 10%, margin floor aman.",
    scenario: 2,
    assumptions: { rrpDiscount: 0.1, marginFloor: 0.05 },
    items: items([
      { code: "ATK-020", name: "Tinta printer 4 warna", uom: "set", qty: 25, cogs: 210000, rrp: 300000 },
      { code: "ATK-021", name: "Amplop coklat besar", uom: "pak", qty: 100, cogs: 18000, rrp: 28000 },
    ]),
    expected: "approve",
  },
  {
    id: "A4",
    client: "Koperasi Karyawan Salvator",
    pitch: "Order kecil, margin tinggi, jelas di bawah ambang persetujuan.",
    scenario: 0,
    assumptions: { targetMargin: 0.3 },
    items: items([
      { code: "ATK-030", name: "Buku agenda", uom: "pcs", qty: 60, cogs: 12000, rrp: 22000 },
      { code: "ATK-031", name: "Spidol whiteboard", uom: "pcs", qty: 80, cogs: 3500, rrp: 7000 },
    ]),
    expected: "approve",
  },
  {
    id: "A5",
    client: "PT Graha Utama Nusantara",
    pitch: "Volume besar tapi margin tetap nyaman di atas 15%.",
    scenario: 0,
    assumptions: { targetMargin: 0.22 },
    items: items([
      { code: "ATK-040", name: "Kertas A4 80gsm", uom: "rim", qty: 500, cogs: 38000, rrp: 55000 },
      { code: "ATK-041", name: "Kertas F4 80gsm", uom: "rim", qty: 250, cogs: 40000, rrp: 58000 },
    ]),
    expected: "approve",
  },
  {
    id: "A6",
    client: "PT Cipta Boga Makmur",
    pitch: "Beberapa item masih pakai COGS estimasi — hanya warning, tidak menghalangi approve.",
    scenario: 0,
    assumptions: {},
    items: items([
      { code: "ATK-050", name: "Map plastik", uom: "pcs", qty: 300, cogs: 4000, rrp: 8000, estCogs: true },
      { code: "ATK-051", name: "Binder clip no.5", uom: "box", qty: 150, cogs: 6000, rrp: 11000 },
    ]),
    expected: "approve",
  },
  {
    id: "A7",
    client: "PT Delta Logistik Prima",
    pitch: "Multi-region dengan logistik diperhitungkan, margin masih sehat.",
    scenario: 0,
    assumptions: { includeLogistics: true, targetMargin: 0.24 },
    items: items([
      { code: "ATK-060", name: "Kertas A4 80gsm", uom: "rim", qty: 400, cogs: 38000, rrp: 58000 },
      { code: "ATK-061", name: "Kertas A3 80gsm", uom: "rim", qty: 100, cogs: 55000, rrp: 82000 },
    ]),
    expected: "approve",
  },
  {
    id: "A8",
    client: "PT Wahana Edukasi",
    pitch: "Kontrak panjang 24 bulan, nilai bulanan tetap kecil jadi aman.",
    scenario: 0,
    assumptions: { months: 24, targetMargin: 0.2 },
    items: items([
      { code: "ATK-070", name: "Buku tulis 38 lembar", uom: "pak", qty: 200, cogs: 25000, rrp: 40000 },
    ]),
    expected: "approve",
  },
  {
    id: "A9",
    client: "PT Sentra Niaga Abadi",
    pitch: "S2 dengan recovery kuat: leader disubsidi penuh, profit line menutupnya lebih dari cukup.",
    scenario: 1,
    assumptions: { leaderMargin: 0.08, profitDiscount: 0.0 },
    items: items([
      { code: "ATK-080", name: "Mesin fotokopi entry", uom: "unit", qty: 2, cogs: 9000000, rrp: 13000000, role: "LEADER" },
      { code: "ATK-081", name: "Toner drum kit", uom: "set", qty: 15, cogs: 650000, rrp: 1100000, role: "PROFIT" },
    ]),
    expected: "approve",
  },
  {
    id: "A10",
    client: "PT Nusa Perkasa",
    pitch: "S3 diskon tipis 6%, jauh dari batas 35%, margin floor tidak tersentuh.",
    scenario: 2,
    assumptions: { rrpDiscount: 0.06, marginFloor: 0.1 },
    items: items([
      { code: "ATK-090", name: "Kalkulator basic", uom: "pcs", qty: 90, cogs: 22000, rrp: 35000 },
      { code: "ATK-091", name: "Gunting kantor", uom: "pcs", qty: 120, cogs: 9000, rrp: 16000 },
    ]),
    expected: "approve",
  },

  // ---- reject (10) ----
  {
    id: "R1",
    client: "PT Karya Mandiri Sentosa",
    pitch: "Sales rep terlalu agresif menurunkan target margin ke 8% demi menang tender.",
    scenario: 0,
    assumptions: { targetMargin: 0.08 },
    items: items([
      { code: "ATK-100", name: "Kertas A4 80gsm", uom: "rim", qty: 300, cogs: 38000, rrp: 55000 },
    ]),
    expected: "reject",
  },
  {
    id: "R2",
    client: "PT Fajar Sentosa Abadi",
    pitch: "Satu item di-override manual di bawah landed cost demi cocok dengan budget klien.",
    scenario: 0,
    assumptions: {},
    items: items([
      { code: "ATK-110", name: "Printer inkjet", uom: "unit", qty: 8, cogs: 1200000, rrp: 1700000, manualPrice: [900000, null, null] },
      { code: "ATK-111", name: "Tinta refill", uom: "botol", qty: 40, cogs: 45000, rrp: 70000 },
    ]),
    expected: "reject",
  },
  {
    id: "R3",
    client: "PT Cahaya Timur Raya",
    pitch: "S3 diskon dipaksa 45% off RRP demi menyaingi kompetitor.",
    scenario: 2,
    assumptions: { rrpDiscount: 0.45, marginFloor: 0.02 },
    items: items([
      { code: "ATK-120", name: "Kertas A4 80gsm", uom: "rim", qty: 500, cogs: 38000, rrp: 60000 },
    ]),
    expected: "reject",
  },
  {
    id: "R4",
    client: "PT Menara Global Industri",
    pitch: "Order korporat sangat besar, margin sehat tapi nilai bulanan melewati ambang persetujuan.",
    scenario: 0,
    assumptions: { targetMargin: 0.25 },
    items: items([
      { code: "ATK-130", name: "Kertas A4 80gsm", uom: "rim", qty: 12000, cogs: 38000, rrp: 60000 },
    ]),
    expected: "reject",
  },
  {
    id: "R5",
    client: "PT Rimba Sejahtera",
    pitch: "Margin rendah (10%) ditambah satu item dijual di bawah cost — dua breach sekaligus.",
    scenario: 0,
    assumptions: { targetMargin: 0.1 },
    items: items([
      { code: "ATK-140", name: "Kertas A4 80gsm", uom: "rim", qty: 200, cogs: 38000, rrp: 50000 },
      { code: "ATK-141", name: "Printer laser mono", uom: "unit", qty: 4, cogs: 1800000, rrp: 2200000, manualPrice: [1500000, null, null] },
    ]),
    expected: "reject",
  },
  {
    id: "R6",
    client: "PT Anugerah Bersama",
    pitch: "Deal besar sekaligus diskon dalam — basket discount dan value threshold jebol bareng.",
    scenario: 2,
    assumptions: { rrpDiscount: 0.4, marginFloor: 0.03 },
    items: items([
      { code: "ATK-150", name: "Kertas A4 80gsm", uom: "rim", qty: 15000, cogs: 38000, rrp: 62000 },
    ]),
    expected: "reject",
  },
  {
    id: "R7",
    client: "PT Sumber Rejeki Abadi",
    pitch: "S2 salah kalibrasi: leader margin negatif efektif, tidak tertutup profit line, net margin ambruk.",
    scenario: 1,
    assumptions: { leaderMargin: 0.0, profitDiscount: 0.4 },
    items: items([
      { code: "ATK-160", name: "Mesin fotokopi entry", uom: "unit", qty: 4, cogs: 9000000, rrp: 11000000, role: "LEADER" },
      { code: "ATK-161", name: "Toner drum kit", uom: "set", qty: 10, cogs: 650000, rrp: 900000, role: "PROFIT" },
    ]),
    expected: "reject",
  },
  {
    id: "R8",
    client: "PT Bumi Cendekia",
    pitch: "Manual override di dua item sekaligus jatuh di bawah landed cost karena salah input harga nego.",
    scenario: 0,
    assumptions: {},
    items: items([
      { code: "ATK-170", name: "Laptop entry office", uom: "unit", qty: 6, cogs: 4200000, rrp: 5800000, manualPrice: [3900000, null, null] },
      { code: "ATK-171", name: "Mouse wireless", uom: "pcs", qty: 30, cogs: 55000, rrp: 90000, manualPrice: [40000, null, null] },
    ]),
    expected: "reject",
  },
  {
    id: "R9",
    client: "PT Kencana Wibawa",
    pitch: "Tender korporat borderline di atas ambang nilai bulanan meski margin standar.",
    scenario: 0,
    assumptions: { targetMargin: 0.25 },
    items: items([
      { code: "ATK-180", name: "Printer laser mono", uom: "unit", qty: 25, cogs: 1800000, rrp: 2600000 },
      { code: "ATK-181", name: "Toner compatible", uom: "pcs", qty: 400, cogs: 180000, rrp: 320000 },
    ]),
    expected: "reject",
  },
  {
    id: "R10",
    client: "PT Prima Global Trading",
    pitch: "Perang harga habis-habisan: target margin ditekan sampai 3% biar 'pasti menang'.",
    scenario: 0,
    assumptions: { targetMargin: 0.03 },
    items: items([
      { code: "ATK-190", name: "Kertas A4 80gsm", uom: "rim", qty: 250, cogs: 38000, rrp: 52000 },
      { code: "ATK-191", name: "Pulpen gel biru", uom: "pcs", qty: 600, cogs: 2200, rrp: 3800 },
    ]),
    expected: "reject",
  },
];

// ---------------------------------------------------------------
// Agents
// ---------------------------------------------------------------

function makerAgent(spec: ScenarioSpec) {
  const assumptions: Assumptions = { ...DEFAULT_ASSUMPTIONS, ...spec.assumptions };
  const engine = computeEngine(assumptions, spec.items, DEFAULT_REGIONS);
  const s = engine.scen[spec.scenario];
  const message =
    `[MAKER] ${spec.client} — ${spec.pitch}\n` +
    `  Skenario: ${SCENARIO_LABEL[spec.scenario]}\n` +
    `  Item: ${spec.items.map((i) => `${i.name} x${i.qty}`).join(", ")}\n` +
    `  Estimasi nilai bulanan: Rp ${Math.round(s.revenue).toLocaleString("id-ID")}, ` +
    `net margin ${(s.margin * 100).toFixed(1)}%, diskon dari RRP ${(s.savingsPct * 100).toFixed(1)}%.`;
  return { assumptions, engine, message };
}

function approvalAgent(engine: ReturnType<typeof computeEngine>, scenario: ScenarioIndex) {
  const breaches: PolicyBreach[] = evaluatePolicy(engine, scenario, DEFAULT_POLICY);
  const approved = isWithinPolicy(breaches);
  const blocking = breaches.filter((b) => b.severity === "block");
  const warnings = breaches.filter((b) => b.severity === "warn");

  let message = `[APPROVAL] Keputusan: ${approved ? "APPROVE" : "REJECT"}.`;
  if (blocking.length) {
    message += "\n  Alasan tolak:\n" + blocking.map((b) => `    - [${b.code}] ${b.message}`).join("\n");
  }
  if (warnings.length) {
    message += "\n  Catatan (tidak menghalangi):\n" + warnings.map((b) => `    - [${b.code}] ${b.message}`).join("\n");
  }
  if (!blocking.length && !warnings.length) {
    message += "\n  Tidak ada breach — semua metrik di dalam kebijakan.";
  }
  return { breaches, approved, message };
}

// ---------------------------------------------------------------
// Run
// ---------------------------------------------------------------

const log: string[] = [];
log.push(`# Simulasi agent maker ↔ approval — Halokantor Pricing`);
log.push(``);
log.push(`Dijalankan: ${new Date().toISOString()}`);
log.push(`Policy dipakai: ${JSON.stringify(DEFAULT_POLICY)}`);
log.push(``);

let approvedCount = 0;
let rejectedCount = 0;
let mismatches = 0;

for (const spec of SCENARIOS) {
  const { engine, message: makerMsg } = makerAgent(spec);
  const { approved, message: approvalMsg } = approvalAgent(engine, spec.scenario);

  if (approved) approvedCount++;
  else rejectedCount++;

  const matched = (approved && spec.expected === "approve") || (!approved && spec.expected === "reject");
  if (!matched) mismatches++;

  log.push(`## ${spec.id} — ${spec.client} ${matched ? "" : "⚠️ HASIL BEDA DARI EKSPEKTASI DESAIN"}`);
  log.push("```");
  log.push(makerMsg);
  log.push("");
  log.push(approvalMsg);
  log.push("```");
  log.push(``);
}

log.push(`## Ringkasan`);
log.push(`- Total skenario: ${SCENARIOS.length}`);
log.push(`- Approved: ${approvedCount}`);
log.push(`- Rejected: ${rejectedCount}`);
log.push(`- Meleset dari desain awal: ${mismatches}`);

const out = log.join("\n");
writeFileSync(new URL("./agent-simulation-log.md", import.meta.url), out, "utf8");

console.log(out.split("## Ringkasan")[1] ? "## Ringkasan" + out.split("## Ringkasan")[1] : out);
console.log(`\nLog lengkap: scripts/agent-simulation-log.md`);
