/* ============================================================
   Recommendation engine — cari kutipan "mirip" dalam knowledge store
   dan generate rekomendasi untuk klien baru.

   Definisi "mirip":
   - Industri sama (tag overlap ≥ 1 tag dominan)
   - Status won/approved (kontrak berhasil)
   - Preferensi scenario sama atau kompatibel
   - Margin di kisaran yang sehat

   Output: Recommendation dengan alasan berbasis data, bukan hanya
   "klien ini mirip". Agent bisa pakai ini untuk suggest penawaran
   ke sales rep.
   ============================================================ */

import { KnowledgeStore } from "./knowledge-store.js";
import { Recommendation, IndustryTag } from "./types.js";
import { detectIndustry } from "./industry.js";

/**
 * Cari kutipan yang mirip dengan profil industri target.
 */
export function findSimilarQuotes(
  store: KnowledgeStore,
  targetIndustryTags: IndustryTag[],
  preferredScenario: number | null,
  maxResults = 5,
): Array<{
    quote: { id: number; number: string; title: string; client_name: string; status: string; scenario: number };
    margin: number;
    monthlyValue: number;
    scenarioMatch: boolean;
    industryOverlap: string[];
    score: number;
  }> {
  const wonApproved = store.quotesByStatus("won").concat(store.quotesByStatus("approved"));

  if (wonApproved.length === 0) return [];

  const dominantTags = targetIndustryTags.filter((t) => t.confidence > 0.2).map((t) => t.label);
  if (dominantTags.length === 0) return [];

  const scored: Array<{
    quote: { id: number; number: string; title: string; client_name: string; status: string; scenario: number };
    margin: number;
    monthlyValue: number;
    scenarioMatch: boolean;
    industryOverlap: string[];
    score: number;
  }> = [];

  for (const q of wonApproved) {
    const profile = store.profileForQuote(q.id);
    if (!profile || profile.tags.length === 0) continue;

    // Hitung overlap tag
    const overlap = profile.tags.filter((t) => dominantTags.includes(t.label)).map((t) => t.label);
    if (overlap.length === 0) continue;

    // Cek kecocokan scenario
    const scenarioMatch = preferredScenario == null || profile.preferredScenario == null ||
      preferredScenario === profile.preferredScenario;

    // Skor: overlap strength × bonus scenario match × bonus margin sehat
    const avgProfileMargin = profile.avgMargin ?? 0;
    const marginScore = avgProfileMargin >= 0.15 && avgProfileMargin <= 0.35 ? 1.0 : 0.5;
    const industryScore = overlap.length / Math.max(dominantTags.length, 1);
    const score = (industryScore * 0.6 + (scenarioMatch ? 0.25 : 0) + marginScore * 0.15);

    // Hitung monthly value dari items
    let monthlyValue = 0;
    try {
      const items = JSON.parse(q.items) as Array<{ qty: number; rrp: number }>;
      if (Array.isArray(items)) {
        monthlyValue = items.reduce((s, it) => s + (it.qty * it.rrp), 0);
      }
    } catch {}

    scored.push({
      quote: {
        id: q.id,
        number: q.number,
        title: q.title,
        client_name: q.client_name ?? "Tanpa nama",
        status: q.status,
        scenario: q.scenario,
      },
      margin: avgProfileMargin,
      monthlyValue,
      scenarioMatch,
      industryOverlap: overlap,
      score,
    });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, maxResults);
}

/**
 * Generate rekomendasi untuk klien tertentu.
 * Dipanggil setelah sync dan setelah industry terdeteksi.
 */
export function generateRecommendation(
  store: KnowledgeStore,
  targetClientName: string,
  targetIndustryTags: IndustryTag[],
  preferredScenario: number | null,
  maxResults = 3,
): Recommendation | null {
  const similar = findSimilarQuotes(store, targetIndustryTags, preferredScenario, maxResults);

  if (similar.length === 0) return null;

  store.clearRecommendations(targetClientName);

  const top = similar[0];
  const reasons: string[] = [];

  reasons.push(`Klien di industri "${top.industryOverlap.join('", "')}" juga berhasil dengan kontrak sejenis.`);

  if (top.scenarioMatch) {
    reasons.push(`Skenario yang dipakai klien mirip (${top.quote.scenario === 0 ? "S1 Full Margin" : top.quote.scenario === 1 ? "S2 Cross Subsidise" : "S3 RRP Discount"}) cocok dengan preferensi target.`);
  } else {
    reasons.push(`Klien mirip menggunakan skenario berbeda — pertimbangkan coba skenario yang sama.`);
  }

  if (top.margin != null) {
    const marginPct = (top.margin * 100).toFixed(1);
    reasons.push(`Margin net yang berhasil diraih: ${marginPct}%.`);
  }

  if (top.monthlyValue > 0) {
    reasons.push(`Nilai bulanan rata-rata kontrak mirip: Rp ${Math.round(top.monthlyValue).toLocaleString("id-ID")}.`);
  }

  const rec: Recommendation = {
    clientName: targetClientName,
    similarQuote: top.quote,
    reasons,
    similarScenario: top.quote.scenario,
    similarMargin: top.margin,
    suggestedMonthlyValue: top.monthlyValue > 0 ? top.monthlyValue : null,
    confidence: Math.min(0.95, top.score),
  };

  store.saveRecommendation(rec);
  return rec;
}
