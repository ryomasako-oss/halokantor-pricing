/* ============================================================
   Industry detection — menebak industri klien dari item mix
   dalam kutipan, bukan dari field formal (yang tidak ada di DB).

   Strategi: kategorikan tiap item ke "bucket" produk berdasarkan
   nama/kode, lalu kelompokkan bucket ke tag industri. Confidence
   dihitung dari konsentrasi nilai di satu tag vs total.

   Contoh mapping:
   - Mesin fotokopi, printer, toner, drum → "Percetakan & Fotokopi"
   - Karpet, blind, lubrikant, AC → "Kantor & Facility"
   - Mie, kopi, snack, air mineral → "F&B / Catering"
   - ATK umum (kertas, pulpen, stapler) bila didominasi → "ATK Umum"
   ============================================================ */

import type { CapturedQuote, IndustryTag } from "./types.js";

/** Definisinya: { keyword regex OR exact match → tag label }. */
const TAG_SIGNALS: Array<{ tag: string; pattern: RegExp; valueWeight?: number }> = [
  // ---- Percetakan & Fotokopi ----
  { tag: "Percetakan & Fotokopi", pattern: /fotokopi|mesin fotokopi|xerox|copier|photostat/i },
  { tag: "Percetakan & Fotokopi", pattern: /printer laser|printer inkjet|printer dot|printer led/i },
  { tag: "Percetakan & Fotokopi", pattern: /toner|drum kit|tinta printer|cartridge|ribbon/i },
  { tag: "Percetakan & Fotokopi", pattern: /kertas foto|kertas glossy|kertas art|kertas carton|karbon/i },

  // ---- ATK / Standard Office ----
  { tag: "ATK Umum", pattern: /kertas a4|kertas f4|kertas hVS|kertas copy|block note|buku tulis|buku agenda/i },
  { tag: "ATK Umum", pattern: /pulpen|ballpoint|gel pen|spidol|marker|pensil/i },
  { tag: "ATK Umum", pattern: /stapler|staple|clip|paperclip|penjepit/i },
  { tag: "ATK Umum", pattern: /amplop|envelop|lem konus|scotch|double tape/i },
  { tag: "ATK Umum", pattern: /binder|ring binder|map plastik|file fox|folders|c sns|buku lipat/i },
  { tag: "ATK Umum", pattern: /gunting|kutip|cutter|knife|corper|penggaris/i },
  { tag: "ATK Umum", pattern: /meja| Kursi kantor|chair|office chair|sets|kursi|meja kerja/i },

  // ---- Elektronik Kantor ----
  { tag: "Elektronik Kantor", pattern: /laptop|notebook|pc desktop|all in one|monitor|keyboard|mouse/i },
  { tag: "Elektronik Kantor", pattern: /projector|layar|tv monitor|speaker|ups|stabilizer/i },
  { tag: "Elektronik Kantor", pattern: /kalkulator|calculator/i },

  // ---- Facility & Penyelenggaraan ----
  { tag: "Facility & Cleaning", pattern: /karpet|karpet kantor|blind|roller blind|shading|venetian/i },
  { tag: "Facility & Cleaning", pattern: /ac|air conditioner|split ak|ac split|luvr|lube|lubrikant|oil iึก/i },
  { tag: "Facility & Cleaning", pattern: /cleaning|cleaning agent|detergent|disinfektan|pembersih|floor wax/i },
  { tag: "Facility & Cleaning", pattern: /papan nama|nameplate|placard|sponsor sign|banner|flex| banner/i },
  { tag: "Facility & Cleaning", pattern: /jasa|service|maintenance|servis/i },

  // ---- F&B / Catering ----
  { tag: "F&B / Catering", pattern: /mie|mi instan|noodle|kopi|susu|tea|teal|snack|makanan|minuman/i },
  { tag: "F&B / Catering", pattern: /air mineral|gallon air|water gallon|botol air/i },
  { tag: "F&B / Catering", pattern: /nasi|beras|rice|gelas|mangkok|piring|sendok|garpu|talenan/i },

  // ---- Konstruksi & Banjir ----
  { tag: "Konstruksi & Bangunan", pattern: /semen|portland|plester|terak|cat|boiler|spray paint|waterproof/i },
  { tag: "Konstruksi & Bangunan", pattern: /paku|wood nail|c nail|scaffolding|measurement tool|flow meter/i },
  { tag: "Konstruksi & Bangunan", pattern: /pipa|PVC|elbow|fitting|valve|manifold|copper pipe/i },
  { tag: "Konstruksi & Bangunan", pattern: /asbes|genteng|spanduk|triplex|glass mur|sandpaper/i },

  // ---- Logistik & Gudang ----
  { tag: "Logistik & Gudang", pattern: /boxing|box|karung|bigbag|pp bag|sack|tub sack/i },
  { tag: "Logistik & Gudang", pattern: /pallet|truss|racking|rack|rak|meubel gudang|kanban/i },
  { tag: "Logistik & Gudang", pattern: /bubblewrap|stretch film|strapping|banding|shrink|wrap/i },
  { tag: "Logistik & Gudang", pattern: /label|badge|barcode|printer label|thermal|sign printer/i },

  // ---- Otomotif ----
  { tag: "Otomotif", pattern: /oli|oil|transmision|gear oil|engine oil|spark plug|filter| ban|velg|wheel/i },
  { tag: "Otomotif", pattern: / aki|accumulator|battery|terminal|inverter|solar|generator/i },
];

/**
 * Kategorikan satu item ke satu atau lebih tag berdasarkan nama + kode.
 * Kembalikan array { tag, value } — value = kontribusi nilai item terhadap tag.
 */
function tagMatches(itemName: string, itemCode: string, itemValue: number): Array<{ tag: string; value: number }> {
  const haystack = `${itemName} ${itemCode}`.toLowerCase();
  const matches: Array<{ tag: string; value: number }> = [];

  for (const signal of TAG_SIGNALS) {
    if (signal.pattern.test(haystack)) {
      // Satu item bisa match beberapa tag; bagi nilainya merata ke tag yang ketemu
      // (bila nanti diperlukan, bisa pakai valueWeight per signal)
      matches.push({ tag: signal.tag, value: itemValue });
    }
  }

  return matches;
}

/**
 * Deteksi industri dari satu kutipan.
 * Parsing items dari JSON string (format yang sama dengan yang disimpan di DB).
 */
export function detectIndustry(
  itemsJson: string,
  assumptionsJson: string,
): IndustryTag[] {
  let items: Array<{ name: string; code: string; qty: number; cogs: number; rrp: number }>;
  try {
    items = JSON.parse(itemsJson) as typeof items;
  } catch {
    return [];
  }

  if (!Array.isArray(items) || items.length === 0) return [];

  // Hitung nilai (pakai RRP sebagai proxy nilai transaksi)
  const totalValue = items.reduce((s, it) => s + it.qty * it.rrp, 0);
  if (totalValue <= 0) return [];

  // Agregasi per tag
  const tagBuckets: Record<string, number> = {};
  const evidence: Record<string, string[]> = {};

  for (const item of items) {
    const itemValue = item.qty * item.rrp;
    const matches = tagMatches(item.name, item.code, itemValue);
    for (const m of matches) {
      tagBuckets[m.tag] = (tagBuckets[m.tag] ?? 0) + m.value;
      if (!evidence[m.tag].includes(item.name)) {
        evidence[m.tag].push(item.name);
      }
    }
  }

  // Konversi ke IndustryTag dengan confidence
  const tags: IndustryTag[] = Object.entries(tagBuckets)
    .map(([tag, value]) => ({
      label: tag,
      evidence: evidence[tag] ?? [],
      confidence: totalValue > 0 ? value / totalValue : 0,
    }))
    .sort((a, b) => b.confidence - a.confidence);

  return tags;
}

/**
 * Deteksi industri untuk klien berdasarkan semua kutipan won/approved.
 * Mengambil tag dominan dan rata-rata metrik.
 */
export function industryProfileForClient(
  quotes: CapturedQuote[],
  itemsLoader: (quoteId: number) => { items: string; assumptions: string } | null,
): IndustryTag[] {
  const wonApproved = quotes.filter((q) => q.status === "won" || q.status === "approved");

  if (wonApproved.length === 0) return [];

  const tagAccum: Record<string, number> = {};
  const totalWeight = { value: 0 };

  for (const q of wonApproved) {
    const data = itemsLoader(q.id);
    if (!data) continue;
    const tags = detectIndustry(data.items, data.assumptions);
    for (const t of tags) {
      tagAccum[t.label] = (tagAccum[t.label] ?? 0) + t.confidence * (q.status === "won" ? 1.2 : 1);
      totalWeight.value += t.confidence * (q.status === "won" ? 1.2 : 1);
    }
  }

  if (totalWeight.value <= 0) return [];

  return Object.entries(tagAccum)
    .map(([label, accum]) => ({
      label,
      evidence: [], // tidak track evidence lintas kutipan di sini; cukup per-kutipan
      confidence: accum / totalWeight.value,
    }))
    .sort((a, b) => b.confidence - a.confidence);
}
