/* ============================================================
   Builds the grounding context and system prompt for the pricing
   assistant. Everything the model is allowed to assert comes from
   here, so the prompt can insist on "no numbers outside this block".
   ============================================================ */

import { SCENARIOS, computeEngine } from "../shared/engine.js";
import { evaluatePolicy } from "../shared/policy.js";
import { grp, pct } from "../shared/format.js";
import type {
  PricingPolicy,
  QuoteSnapshot,
  ScenarioIndex,
} from "../shared/types.js";

export const RULES_TEXT = `Definisi engine:
- Landed cost = COGS x (1 + opex + logistik bila dinyalakan). Target price = landed / (1 - target margin).
- S1 Full Margin: harga = MIN(pembulatan ke atas target price, RRP). Status CAPPED AT RRP bila target > RRP.
- S2 Cross Subsidise: LEADER = MIN(pembulatan atas landed / (1 - margin leader), RRP); CORE = harga S1; PROFIT = MIN(RRP, MAX(harga S1, pembulatan bawah RRP x (1 - diskon profit))).
- S3 RRP Discount: harga = MIN(RRP, MAX(pembulatan bawah RRP x (1 - diskon RRP), pembulatan atas landed / (1 - margin minimum))). Status FLOOR HIT bila batas margin yang menentukan.
- Harga manual (MANUAL) selalu menang atas hasil hitungan, tetapi tetap dibatasi RRP.
- Net margin = (harga - landed) / harga. Semua harga belum termasuk PPN.
- Subsidi S2 = selisih harga S2 vs S1 dikali qty (leader memberi, profit menutup).`;

interface ContextInput {
  quote: QuoteSnapshot & { scenario: ScenarioIndex; number: string; title: string; status: string };
  policy: PricingPolicy;
  clientName: string;
  notes?: { id: string; title: string; text: string }[];
  sections: Record<string, boolean>;
}

export function buildContext({
  quote,
  policy,
  clientName,
  notes = [],
  sections,
}: ContextInput): string {
  const a = quote.assumptions;
  const engine = computeEngine(a, quote.items, quote.regions);
  const breaches = evaluatePolicy(engine, quote.scenario, policy);
  const parts: string[] = [];

  parts.push(
    "[summary] (selalu aktif)\n" +
      engine.scen
        .map(
          (s, i) =>
            `${SCENARIOS[i].key} ${SCENARIOS[i].name}: revenue/bulan ${grp(s.revenue)}; landed cost ${grp(
              s.landed,
            )}; net profit ${grp(s.profit)}; net margin ${pct(s.margin)}; nilai kontrak ${a.months} bulan ${grp(
              s.annual,
            )}; hemat klien vs RRP ${grp(s.savings)} (${pct(s.savingsPct)}); hemat item LEADER ${pct(
              s.leaderSavingsPct,
            )}; item di harga RRP ${s.atCeiling}/${engine.rows.length}; margin item terendah ${pct(
              s.lowestMargin,
            )}; item di bawah modal ${s.belowCost}`,
        )
        .join("\n") +
      `\nS1 item capped di RRP: ${engine.capped}. S3 item kena margin minimum: ${engine.floorHits}. ` +
      `S2 subsidi diberikan ${grp(engine.subsidy.given)}/bulan, ditutup ${grp(engine.subsidy.recovered)}/bulan, coverage ${pct(
        engine.subsidy.coverage,
      )}. Nilai basket di RRP ${grp(engine.rrpValue)}/bulan. ` +
      `Quotation ${quote.number} "${quote.title}" status ${quote.status}, memakai ${SCENARIOS[quote.scenario].key}. Klien: ${clientName}.`,
  );

  parts.push(
    `[policy]\nBatas kebijakan: net margin minimum ${pct(policy.minNetMargin)}; margin per item minimum ${pct(
      policy.minLineMargin,
    )}; diskon basket maksimum ${pct(policy.maxBasketDiscount)}; jual di bawah modal ${
      policy.allowBelowCost ? "diizinkan" : "dilarang"
    }; nilai di atas ${grp(policy.approvalValueThreshold)}/bulan wajib persetujuan manajer.\n` +
      (breaches.length
        ? `Pelanggaran saat ini: ${breaches.map((b) => `${b.severity === "block" ? "BLOKIR" : "PERINGATAN"} - ${b.message}`).join(" | ")}`
        : "Saat ini tidak ada pelanggaran kebijakan."),
  );

  if (sections.assumptions) {
    parts.push(
      `[assumptions]\nopex ${pct(a.opex)}; target margin ${pct(a.targetMargin)}; margin leader (S2) ${pct(
        a.leaderMargin,
      )}; diskon item profit dari RRP (S2) ${pct(a.profitDiscount)}; diskon dari RRP (S3) ${pct(
        a.rrpDiscount,
      )}; margin minimum (S3) ${pct(a.marginFloor)}; pembulatan Rp ${a.step}; PPN ${pct(
        a.ppn,
        0,
      )}; durasi kontrak ${a.months} bulan; logistik di harga: ${a.includeLogistics ? "nyala" : "mati"}.`,
    );
  }

  if (sections.items) {
    const head =
      "no|item|uom|qty|cogs|rrp|role|landed|S1 harga|S1 margin|S1 status|S2 harga|S2 margin|S2 status|S3 harga|S3 margin|S3 status";
    const lines = engine.rows
      .slice(0, 200)
      .map((r) =>
        [
          r.lineNo,
          r.name,
          r.uom,
          r.qty,
          grp(r.cogs) + (r.estCogs ? " (estimasi)" : ""),
          grp(r.rrp),
          r.role,
          grp(r.landed),
          grp(r.prices[0]),
          pct(r.margins[0]),
          r.status[0],
          grp(r.prices[1]),
          pct(r.margins[1]),
          r.status[1],
          grp(r.prices[2]),
          pct(r.margins[2]),
          r.status[2],
        ].join("|"),
      );
    parts.push(
      `[items]\n${head}\n${lines.join("\n")}${
        engine.rows.length > 200 ? `\n(${engine.rows.length - 200} item lain tidak ditampilkan)` : ""
      }`,
    );
  }

  if (sections.delivery) {
    parts.push(
      "[delivery]\n" +
        engine.regions
          .map(
            (r) =>
              `${r.name}: share ${pct(r.share, 0)}, ${r.deliveries} kirim/bulan x ${grp(r.cost)} = ${grp(
                r.monthlyCost,
              )}/bulan, nilai order @COGS ${grp(r.value)}, modifier ${pct(r.modifier)}`,
          )
          .join("\n") +
        `\nBlended ${pct(engine.blended)}; total biaya logistik ${grp(engine.logiCost)}/bulan; saat ini ${
          a.includeLogistics ? "dimasukkan" : "tidak dimasukkan"
        } ke harga.`,
    );
  }

  for (const n of notes) {
    if (sections[n.id]) parts.push(`[${n.id}] ${n.title}\n${n.text.slice(0, 6000)}`);
  }

  return parts.join("\n\n");
}

export const chatSystem = (ctx: string): string =>
  `Kamu asisten pricing di aplikasi Halokantor Pricing (PT Salvator Inti Pratama, distributor ATK B2B). Aplikasi ini menyusun quotation kontrak dengan 3 skenario: S1 Full Margin, S2 Cross Subsidise, S3 RRP Discount. RRP adalah harga plafon klien.

${RULES_TEXT}

Aturan menjawab:
- Jawab HANYA dari DATA QUOTATION di bawah. Kalau informasinya tidak ada, katakan terus terang.
- Jangan mengarang angka. Setiap angka harus ada di data atau dihitung jelas dari data.
- Ikuti bahasa user. Nada santai tapi profesional. Maksimal sekitar 160 kata.
- Boleh pakai baris "- " untuk poin dan **tebal**. Sorot 2 sampai 5 angka kunci dengan ==angka==.
- Kalau usulanmu melanggar kebijakan harga, sebutkan itu dengan jelas.
- Kalau user MEMINTA perubahan (margin, diskon, role item, qty, cogs, rrp, logistik, skenario), isi "actions" dan buat "answer" satu kalimat konfirmasi. Perubahan hanya diterapkan setelah user menekan Terapkan.
- Kalau user hanya bertanya "bagaimana kalau", jangan isi actions; jelaskan arah dampaknya.

Keluarkan HANYA JSON valid, tanpa teks lain dan tanpa backtick:
{"answer":"...","sources":["summary"],"actions":[],"followups":["...","..."]}
- sources: id bagian data yang dipakai (summary, policy, assumptions, items, delivery, atau id catatan).
- actions valid:
  {"type":"set","key":"opex|targetMargin|leaderMargin|profitDiscount|rrpDiscount|marginFloor|ppn","value":0.12}
  {"type":"set","key":"step|months","value":50}
  {"type":"set","key":"includeLogistics","value":true}
  {"type":"item","no":3,"field":"qty|cogs|rrp|role","value":123}
  {"type":"scenario","value":2}
- followups: 2 sampai 3 pertanyaan lanjutan pendek.

DATA QUOTATION:
${ctx}`;

export const docSystem = (ctx: string): string =>
  `Kamu analis pricing Halokantor (PT Salvator Inti Pratama). Tulis dokumen dari DATA QUOTATION saja, jangan mengarang angka.
${RULES_TEXT}
Format: markdown sederhana. Pakai "## " untuk judul bagian, "- " untuk poin, **tebal**, dan ==angka== untuk angka kunci. Jangan keluarkan JSON. Bahasa Indonesia yang rapi dan singkat.

DATA QUOTATION:
${ctx}`;

export const DOCS: Record<string, { title: string; desc: string; prompt: string }> = {
  briefing: {
    title: "Briefing untuk atasan",
    desc: "Ringkasan satu halaman, siap diteruskan",
    prompt:
      "Tulis briefing untuk atasan (maksimal 230 kata): satu paragraf ringkasan, lalu satu bagian per skenario dengan angka kunci, lalu bagian risiko, lalu 2 sampai 3 keputusan yang perlu diambil.",
  },
  faq: {
    title: "FAQ tim sales",
    desc: "Pertanyaan procurement dan jawabannya",
    prompt:
      "Buat 5 tanya jawab yang kemungkinan ditanyakan procurement klien atau tim sales tentang penawaran ini (maksimal 260 kata). Tiap pertanyaan sebagai judul '## ', jawaban 1 sampai 3 kalimat berbasis data.",
  },
  risk: {
    title: "Cek risiko harga",
    desc: "Item dan asumsi yang rawan",
    prompt:
      "Buat daftar risiko harga (maksimal 230 kata): item yang mentok di RRP, item margin tipis atau di bawah modal, ketergantungan subsidi S2 pada volume item profit, COGS estimasi, dan pelanggaran kebijakan. Urutkan dari yang paling berdampak, sebut angka.",
  },
  negotiation: {
    title: "Amunisi negosiasi",
    desc: "Argumen dan batas bawah per item",
    prompt:
      "Buat catatan negosiasi (maksimal 250 kata): 3 argumen nilai yang bisa dipakai sales, item mana yang masih punya ruang turun harga beserta batas bawahnya menurut kebijakan, dan item mana yang tidak boleh diturunkan lagi. Sebut angka.",
  },
};
