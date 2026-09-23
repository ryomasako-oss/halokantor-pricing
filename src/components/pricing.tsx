/* Presentational pieces shared by the quote editor and the dashboards. */

import { SCENARIOS } from "@shared/engine";
import { pct, rp, grp } from "@shared/format";
import type {
  Assumptions,
  ComputedRegion,
  EngineResult,
  LineStatus,
  PolicyBreach,
  QuoteStatus,
  ScenarioIndex,
} from "@shared/types";
import { Icon } from "./Icon";

/* ---------------- status ---------------- */

const STATUS_LABEL: Record<QuoteStatus, string> = {
  draft: "Draft",
  submitted: "Menunggu persetujuan",
  approved: "Disetujui",
  rejected: "Ditolak",
  sent: "Terkirim ke klien",
  won: "Menang",
  lost: "Kalah",
  completed: "Selesai",
};

export function StatusChip({ status }: { status: QuoteStatus }) {
  return <span className={`status-chip status-${status}`}>{STATUS_LABEL[status] ?? status}</span>;
}

export function LineBadge({ status }: { status: LineStatus }) {
  const map: Partial<Record<LineStatus, [string, string]>> = {
    "CAPPED AT RRP": ["Di plafon", "amber"],
    "FLOOR HIT": ["Margin min", "amber"],
    "BELOW COST": ["Rugi", "red"],
    MANUAL: ["Manual", "blue"],
    Subsidised: ["Leader", "blue"],
    Subsidiser: ["Profit", "green"],
  };
  const v = map[status];
  if (!v) return null;
  return <span className={`badge ${v[1]}`}>{v[0]}</span>;
}

/* ---------------- scenarios ---------------- */

export function ScenarioCards({
  engine,
  selected,
  onSelect,
}: {
  engine: EngineResult;
  selected: ScenarioIndex;
  onSelect?: (i: ScenarioIndex) => void;
}) {
  const bestMargin = engine.scen.reduce((b, s, i) => (s.margin > engine.scen[b].margin ? i : b), 0);
  const bestSave = engine.scen.reduce(
    (b, s, i) => (s.savingsPct > engine.scen[b].savingsPct ? i : b),
    0,
  );
  return (
    <div className="scen-grid">
      {SCENARIOS.map((sc, i) => {
        const s = engine.scen[i];
        const Tag = onSelect ? "button" : "div";
        return (
          <Tag
            key={sc.key}
            type={onSelect ? "button" : undefined}
            className={`scen-card ${onSelect ? "selectable" : ""} ${selected === i ? "on" : ""}`}
            style={{ ["--c" as string]: sc.color, ["--t" as string]: sc.tint }}
            onClick={onSelect ? () => onSelect(i as ScenarioIndex) : undefined}
            aria-pressed={onSelect ? selected === i : undefined}
            title={sc.rule}
          >
            <span className="name">
              <strong>{sc.key}</strong> {sc.name}
            </span>
            <span className="value num">{rp(s.revenue)}</span>
            <span className="meter" aria-hidden="true">
              <span style={{ width: `${Math.max(0, Math.min(100, (s.margin / 0.35) * 100))}%` }} />
            </span>
            <span className="meta">
              <span>
                Margin{" "}
                <b className={i === bestMargin ? "best num" : "num"}>{pct(s.margin)}</b>
              </span>
              <span>
                Hemat klien{" "}
                <b className={i === bestSave ? "best num" : "num"}>{pct(s.savingsPct)}</b>
              </span>
            </span>
          </Tag>
        );
      })}
    </div>
  );
}

export function CompareTable({ engine }: { engine: EngineResult }) {
  const rows: [string, (s: EngineResult["scen"][number]) => string, string | null][] = [
    ["Revenue per bulan", (s) => rp(s.revenue), "revenue"],
    ["Net profit per bulan", (s) => rp(s.profit), "profit"],
    ["Net margin", (s) => pct(s.margin), "margin"],
    ["Nilai kontrak", (s) => rp(s.annual), "annual"],
    ["Hemat klien vs RRP", (s) => pct(s.savingsPct), "savingsPct"],
    ["Hemat item headline", (s) => pct(s.leaderSavingsPct), "leaderSavingsPct"],
    ["Item di harga plafon", (s) => `${s.atCeiling} dari ${engine.rows.length}`, null],
    ["Margin item terendah", (s) => pct(s.lowestMargin), null],
    ["Item di bawah modal", (s) => String(s.belowCost), null],
  ];
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th className="l">Metrik</th>
            {SCENARIOS.map((s) => (
              <th key={s.key} style={{ color: s.color }}>
                {s.key} {s.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, fn, key]) => {
            const best = key
              ? engine.scen.reduce(
                  (b, s, i) =>
                    (s as unknown as Record<string, number>)[key] >
                    (engine.scen[b] as unknown as Record<string, number>)[key]
                      ? i
                      : b,
                  0,
                )
              : -1;
            return (
              <tr key={label}>
                <td className="l">{label}</td>
                {engine.scen.map((s, i) => (
                  <td key={i} className="num">
                    {best === i ? <mark className="mark">{fn(s)}</mark> : fn(s)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="muted small" style={{ padding: "8px 10px", margin: 0 }}>
        Sorotan kuning menandai skenario terbaik untuk metrik itu. Subsidi S2 diberikan{" "}
        {rp(engine.subsidy.given)} dan ditutup {rp(engine.subsidy.recovered)} per bulan (
        {pct(engine.subsidy.coverage)}).
      </p>
    </div>
  );
}

/* ---------------- levers ---------------- */

export interface LeverDef {
  key: keyof Assumptions;
  label: string;
  hint: string;
  min: number;
  max: number;
  step: number;
  color?: string;
}

export const LEVERS: LeverDef[] = [
  { key: "opex", label: "Opex", hint: "Handling, gudang, admin dari COGS", min: 0, max: 0.3, step: 0.005 },
  { key: "targetMargin", label: "Target margin", hint: "Dipakai S1 dan item core", min: 0, max: 0.5, step: 0.005 },
  { key: "leaderMargin", label: "Margin item leader", hint: "S2: item yang dibandingkan klien", min: 0, max: 0.4, step: 0.005, color: SCENARIOS[1].color },
  { key: "profitDiscount", label: "Diskon item profit", hint: "S2: 0% berarti di harga plafon", min: 0, max: 0.3, step: 0.005, color: SCENARIOS[1].color },
  { key: "rrpDiscount", label: "Diskon dari RRP", hint: "S3: berlaku ke semua item", min: 0, max: 0.4, step: 0.005, color: SCENARIOS[2].color },
  { key: "marginFloor", label: "Margin minimum", hint: "S3: harga tidak boleh di bawah ini", min: 0, max: 0.3, step: 0.005, color: SCENARIOS[2].color },
];

export function Lever({
  lever,
  value,
  onChange,
  disabled,
}: {
  lever: LeverDef;
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <label className="lever">
      <span className="lever-top">
        <span>{lever.label}</span>
        <span className="num">{pct(value)}</span>
      </span>
      <input
        type="range"
        min={lever.min}
        max={lever.max}
        step={lever.step}
        value={value}
        disabled={disabled}
        style={{
          ["--fill" as string]: `${((value - lever.min) / (lever.max - lever.min)) * 100}%`,
          ["--c" as string]: lever.color || "#1F3A5F",
        }}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="lever-hint">{lever.hint}</span>
    </label>
  );
}

/* ---------------- policy ---------------- */

export function BreachList({ breaches }: { breaches: PolicyBreach[] }) {
  if (!breaches.length) {
    return (
      <p className="notice ok">
        <Icon name="check" size={14} /> Semua angka di dalam batas kebijakan harga.
      </p>
    );
  }
  return (
    <ul className="breach-list">
      {breaches.map((b, i) => (
        <li key={i} className={`breach ${b.severity}`}>
          <Icon name={b.severity === "block" ? "alert" : "clock"} size={15} />
          <span>
            {b.message}
            {b.lines?.length ? (
              <span className="muted"> (baris {b.lines.slice(0, 12).join(", ")}{b.lines.length > 12 ? ", …" : ""})</span>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

/* ---------------- delivery ---------------- */

export function DeliveryTable({
  regions,
  shareTotal,
  onChange,
  onAdd,
  onRemove,
  readOnly,
}: {
  regions: ComputedRegion[];
  shareTotal: number;
  onChange: (index: number, field: string, value: string | number) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
  readOnly?: boolean;
}) {
  return (
    <>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th className="l">Region</th>
              <th>Share order</th>
              <th>Kirim/bln</th>
              <th>Biaya/kirim</th>
              <th>Biaya/bln</th>
              <th>Modifier</th>
              {!readOnly && <th aria-label="Aksi" />}
            </tr>
          </thead>
          <tbody>
            {regions.map((r, i) => (
              <tr key={r.id}>
                <td className="l">
                  <input
                    className="cell l"
                    value={r.name}
                    disabled={readOnly}
                    onChange={(e) => onChange(i, "name", e.target.value)}
                    aria-label="Nama region"
                  />
                </td>
                <td>
                  <input
                    className="cell"
                    type="number"
                    min="0"
                    max="100"
                    value={Math.round(r.share * 100)}
                    disabled={readOnly}
                    onChange={(e) => onChange(i, "share", Math.max(0, Number(e.target.value)) / 100)}
                    aria-label={`Share ${r.name} persen`}
                  />
                </td>
                <td>
                  <input
                    className="cell"
                    type="number"
                    min="0"
                    value={r.deliveries}
                    disabled={readOnly}
                    onChange={(e) => onChange(i, "deliveries", Math.max(0, Number(e.target.value)))}
                    aria-label={`Pengiriman ${r.name}`}
                  />
                </td>
                <td>
                  <input
                    className="cell"
                    type="number"
                    min="0"
                    value={r.cost}
                    disabled={readOnly}
                    onChange={(e) => onChange(i, "cost", Math.max(0, Number(e.target.value)))}
                    aria-label={`Biaya ${r.name}`}
                  />
                </td>
                <td className="num">{grp(r.monthlyCost)}</td>
                <td className="num">
                  <strong>{pct(r.modifier)}</strong>
                </td>
                {!readOnly && (
                  <td>
                    <button
                      className="icon-btn"
                      onClick={() => onRemove(i)}
                      aria-label={`Hapus ${r.name}`}
                      disabled={regions.length <= 1}
                    >
                      <Icon name="trash" size={15} />
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!readOnly && (
        <button className="btn small ghost" style={{ marginTop: 10 }} onClick={onAdd}>
          <Icon name="plus" size={14} /> Tambah lokasi
        </button>
      )}
      {Math.abs(shareTotal - 1) > 0.0001 && (
        <p className="notice warn" style={{ marginTop: 10 }}>
          Total share order {pct(shareTotal, 0)}. Ubah sampai 100% supaya modifier akurat.
        </p>
      )}
      <p className="muted small" style={{ marginTop: 8 }}>
        Modifier = (kirim per bulan × biaya per kirim) ÷ (nilai order @COGS × share region).
      </p>
    </>
  );
}
