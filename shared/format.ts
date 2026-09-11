/* Formatting helpers shared by the UI, exports, and AI prompts. */

export const grp = (n: number): string =>
  Math.round(Number(n) || 0)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");

export const rp = (n: number): string =>
  (n < 0 ? "−Rp " : "Rp ") + grp(Math.abs(Number(n) || 0));

export const pct = (x: number, d = 1): string =>
  ((Number(x) || 0) * 100).toFixed(d).replace(".", ",") + "%";

export const jt = (n: number): string =>
  "Rp " + ((Number(n) || 0) / 1e6).toFixed(2).replace(".", ",") + " jt";

export const uid = (): string => Math.random().toString(36).slice(2, 10);

export const uniq = <T,>(arr: T[]): T[] => [...new Set(arr.filter(Boolean))];

export const fmtDate = (d: string | number | Date): string => {
  try {
    return new Date(d).toLocaleDateString("id-ID", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  } catch {
    return String(d);
  }
};

export const fmtDateTime = (d: string | number | Date): string => {
  try {
    return new Date(d).toLocaleString("id-ID", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return String(d);
  }
};

/** Parses Indonesian- and English-formatted numbers out of spreadsheet cells. */
export function toNum(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : NaN;
  let s = String(v ?? "")
    .trim()
    .replace(/rp/i, "")
    .replace(/\s/g, "");
  if (!s) return NaN;
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, "");
  else s = s.replace(",", ".");
  const n = parseFloat(s);
  return Number.isNaN(n) ? NaN : n;
}
