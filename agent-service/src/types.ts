/* ============================================================
   Tipe yang dipakai agent service — mirrors shared/types.ts dari
   app utama, plus tambahan khusus agent.
   ============================================================ */

/** Baris kutipan yang sudah di-capture dari API halokantor. */
export interface CapturedQuote {
  id: number;
  number: string;
  title: string;
  client_id: number | null;
  client_name: string | null;
  status: string;
  scenario: number;
  rev_no: number;
  assumptions: string;
  items: string;
  regions: string;
  meta: string;
  created_by: number;
  created_by_name: string;
  approved_by: number | null;
  approved_by_name: string | null;
  approved_at: string | null;
  decision_note: string | null;
  created_at: string;
  updated_at: string;
  /** Timestamp capture terakhir di knowledge store agent. */
  synced_at: string;
}

/** Klien yang di-capture dari API. */
export interface CapturedClient {
  id: number;
  name: string;
  code: string;
  address: string;
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  payment_terms: string;
  delivery_terms: string;
  created_at: string;
  synced_at: string;
}

/** Item katalog yang di-capture. */
export interface CapturedCatalogItem {
  id: number;
  code: string;
  name: string;
  uom: string;
  cogs: number;
  list_price: number;
  stock: number;
  category: string;
  source: string;
  updated_at: string;
  synced_at: string;
}

/** Hasil deteksi industri dari item mix. */
export interface IndustryTag {
  /** Label industri, mis. "Kontraktor & Konstruksi", "Manufaktur", "F&B". */
  label: string;
  /** Item-item yang memberi sinyal ini. */
  evidence: string[];
  /** Confidence 0..1. */
  confidence: number;
}

/** Profil industri yang terbentuk dari satu kutipan. */
export interface IndustryProfile {
  /** Kombinasi tag dominan. */
  tags: IndustryTag[];
  /** Porsi nilai tiap tag (jumlahkan ke 1). */
  tagShares: Record<string, number>;
  /** Scenario yang paling sering dipilih klien ini. */
  preferredScenario: number | null;
  /** Margin net rata-rata yang berhasil (approved/won). */
  avgMargin: number | null;
  /** Nilai bulanan rata-rata. */
  avgMonthlyValue: number | null;
}

/** Rekomendasi yang dihasilkan agent. */
export interface Recommendation {
  /** Klien target yang direkomendasikan. */
  clientName: string;
  /** Kutipan yang mirip (id + nomor). */
  similarQuote: { id: number; number: string; client_name: string };
  /** Alasan kemiripan, poin-poin. */
  reasons: string[];
  /** Skenario yang berhasil dipakai klien mirip. */
  similarScenario: number | null;
  /** Margin yang dicapai klien mirip. */
  similarMargin: number | null;
  /** Estimasi nilai bulanan berbasis item yang disarankan. */
  suggestedMonthlyValue: number | null;
  /** Confidence rekomendasi ini. */
  confidence: number;
}
