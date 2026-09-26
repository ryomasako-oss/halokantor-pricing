/* The quote's line-item grid. Editable in place; prices for all three
   scenarios recompute on every keystroke via the shared engine. */

import { useMemo, useState } from "react";
import { SCENARIOS } from "@shared/engine";
import { grp, pct } from "@shared/format";
import type { ComputedRow, EngineResult, ItemRole, QuoteItem, ScenarioIndex } from "@shared/types";
import { Icon } from "./Icon";
import { LineBadge } from "./pricing";

interface Props {
  engine: EngineResult;
  scenario: ScenarioIndex;
  readOnly?: boolean;
  onUpdate: (id: string, patch: Partial<QuoteItem>) => void;
  onRemove: (id: string) => void;
  onAdd: () => void;
  onOpenCatalog: () => void;
  /** Pushes a row's COGS/RRP back into the shared catalog master. Omit to hide the action. */
  onPushToCatalog?: (id: string) => void;
  /** Managed UOM list for the inline satuan picker; empty falls back to a plain label. */
  uomOptions?: string[];
}

type SortKey = "lineNo" | "name" | "qty" | "cogs" | "rrp" | "margin" | "value";

// Selects the whole value on focus so typing a new number replaces it
// instead of appending after a leading 0.
const selectOnFocus = (e: React.FocusEvent<HTMLInputElement>) => e.target.select();

export function ItemsTable({
  engine,
  scenario,
  readOnly,
  onUpdate,
  onRemove,
  onAdd,
  onOpenCatalog,
  onPushToCatalog,
  uomOptions = [],
}: Props) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "lineNo", dir: 1 });
  const [onlyFlagged, setOnlyFlagged] = useState(false);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = engine.rows.filter(
      (r) => !q || r.name.toLowerCase().includes(q) || r.code.toLowerCase().includes(q),
    );
    if (onlyFlagged) {
      list = list.filter(
        (r) =>
          r.margins[scenario] < 0 ||
          r.status[scenario] === "CAPPED AT RRP" ||
          r.status[scenario] === "FLOOR HIT" ||
          r.estCogs,
      );
    }
    const val = (r: ComputedRow): number | string => {
      switch (sort.key) {
        case "name": return r.name.toLowerCase();
        case "qty": return r.qty;
        case "cogs": return r.cogs;
        case "rrp": return r.rrp;
        case "margin": return r.margins[scenario];
        case "value": return r.qty * r.prices[scenario];
        default: return r.lineNo;
      }
    };
    return [...list].sort((a, b) => {
      const x = val(a);
      const y = val(b);
      if (x === y) return 0;
      return (x > y ? 1 : -1) * sort.dir;
    });
  }, [engine.rows, query, sort, onlyFlagged, scenario]);

  const head = (key: SortKey, label: string, className = "", minWidth?: number) => (
    <th
      className={className}
      style={{ cursor: "pointer", minWidth }}
      onClick={() => setSort((s) => ({ key, dir: s.key === key && s.dir === 1 ? -1 : 1 }))}
      title="Klik untuk mengurutkan"
    >
      {label}
      {sort.key === key ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
    </th>
  );

  return (
    <div>
      <div className="search-bar" style={{ marginBottom: 10 }}>
        <input
          className="input"
          placeholder="Cari item atau kode"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Cari item"
        />
        <label className="toggle">
          <input
            type="checkbox"
            checked={onlyFlagged}
            onChange={(e) => setOnlyFlagged(e.target.checked)}
          />
          <span>Hanya item bermasalah</span>
        </label>
        <span className="grow" />
        <span className="muted small">
          {rows.length} dari {engine.rows.length} item
        </span>
        {!readOnly && (
          <>
            <button className="btn small" onClick={onOpenCatalog}>
              <Icon name="search" size={14} />
              Dari katalog
            </button>
            <button className="btn small" onClick={onAdd}>
              <Icon name="plus" size={14} />
              Baris kosong
            </button>
          </>
        )}
      </div>

      {engine.rows.length === 0 ? (
        <div className="empty">
          <Icon name="table" size={28} />
          <h3>Belum ada item</h3>
          <p>Tambahkan dari katalog, impor file Excel klien, atau buat baris kosong.</p>
          {!readOnly && (
            <div className="row" style={{ justifyContent: "center" }}>
              <button className="btn primary" onClick={onOpenCatalog}>
                Pilih dari katalog
              </button>
              <button className="btn" onClick={onAdd}>
                Baris kosong
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="table-wrap" style={{ maxHeight: "62vh" }}>
          <table className="table">
            <thead>
              <tr>
                {head("lineNo", "No", "c")}
                {head("name", "Item", "l", 230)}
                {head("qty", "Qty")}
                <th>UOM</th>
                {head("cogs", "COGS")}
                {head("rrp", "RRP")}
                <th>Role S2</th>
                {SCENARIOS.map((s, i) => (
                  <th
                    key={s.key}
                    className={i === scenario ? "col-selected" : ""}
                    style={{ color: s.color, ["--c" as string]: s.color }}
                  >
                    {s.key}
                  </th>
                ))}
                {head("value", "Nilai/bln")}
                {!readOnly && <th aria-label="Aksi" />}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const flagged =
                  r.margins[scenario] < 0 || r.estCogs || r.status[scenario] === "BELOW COST";
                return (
                  <tr key={r.id} className={flagged ? "flagged" : ""}>
                    <td className="c muted">{r.lineNo}</td>
                    <td className="l">
                      {readOnly ? (
                        <div style={{ fontWeight: 550 }}>{r.name}</div>
                      ) : (
                        <input
                          className="cell l"
                          value={r.name}
                          onChange={(e) => onUpdate(r.id, { name: e.target.value })}
                          aria-label={`Nama item baris ${r.lineNo}`}
                        />
                      )}
                      {(r.code || r.estCogs) && (
                        <div className="muted small">
                          {[r.code, r.estCogs ? "COGS estimasi" : ""].filter(Boolean).join(" · ")}
                        </div>
                      )}
                    </td>
                    <td>
                      <input
                        className="cell"
                        type="number"
                        min="0"
                        value={r.qty}
                        disabled={readOnly}
                        onChange={(e) => onUpdate(r.id, { qty: Math.max(0, Number(e.target.value)) })}
                        onFocus={selectOnFocus}
                        aria-label={`Qty ${r.name}`}
                      />
                    </td>
                    <td>
                      {readOnly || uomOptions.length === 0 ? (
                        <div className="nowrap">{r.uom}</div>
                      ) : (
                        <select
                          className="cell uom"
                          value={r.uom}
                          onChange={(e) => onUpdate(r.id, { uom: e.target.value })}
                          aria-label={`Satuan ${r.name}`}
                        >
                          {!uomOptions.includes(r.uom) && r.uom && <option value={r.uom}>{r.uom}</option>}
                          {uomOptions.map((u) => (
                            <option key={u} value={u}>{u}</option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td>
                      <input
                        className={`cell ${r.estCogs ? "est" : ""}`}
                        type="number"
                        min="0"
                        value={r.cogs}
                        disabled={readOnly}
                        onChange={(e) =>
                          onUpdate(r.id, { cogs: Math.max(0, Number(e.target.value)), estCogs: false })
                        }
                        onFocus={selectOnFocus}
                        aria-label={`COGS ${r.name}`}
                      />
                    </td>
                    <td>
                      <input
                        className="cell"
                        type="number"
                        min="0"
                        value={r.rrp}
                        disabled={readOnly}
                        onChange={(e) => onUpdate(r.id, { rrp: Math.max(0, Number(e.target.value)) })}
                        onFocus={selectOnFocus}
                        aria-label={`RRP ${r.name}`}
                      />
                    </td>
                    <td>
                      <select
                        className="cell"
                        value={r.role}
                        disabled={readOnly}
                        onChange={(e) => onUpdate(r.id, { role: e.target.value as ItemRole })}
                        aria-label={`Role ${r.name}`}
                      >
                        <option>LEADER</option>
                        <option>CORE</option>
                        <option>PROFIT</option>
                      </select>
                    </td>
                    {[0, 1, 2].map((k) => (
                      <td
                        key={k}
                        className={k === scenario ? "col-selected" : ""}
                        style={k === scenario ? { ["--c" as string]: SCENARIOS[k].color } : undefined}
                      >
                        {k === scenario && !readOnly ? (
                          <input
                            className={`cell ${r.overridden[k] ? "manual" : ""}`}
                            type="number"
                            min="0"
                            value={Math.round(r.prices[k])}
                            title="Ubah untuk mengunci harga manual pada skenario ini"
                            onChange={(e) => {
                              const v = Number(e.target.value);
                              const next = [...(r.manualPrice ?? [null, null, null])];
                              next[k] = v > 0 ? v : null;
                              onUpdate(r.id, { manualPrice: next });
                            }}
                            onFocus={selectOnFocus}
                            aria-label={`Harga ${SCENARIOS[k].key} untuk ${r.name}`}
                          />
                        ) : (
                          <div className="num" style={{ fontWeight: k === scenario ? 650 : 400 }}>
                            {grp(r.prices[k])}
                          </div>
                        )}
                        <div className="small muted nowrap">
                          {pct(r.margins[k])} <LineBadge status={r.status[k]} />
                        </div>
                      </td>
                    ))}
                    <td className="num">{grp(r.qty * r.prices[scenario])}</td>
                    {!readOnly && (
                      <td>
                        <div className="row" style={{ justifyContent: "flex-end" }}>
                          {onPushToCatalog && r.code && (
                            <button
                              className="icon-btn"
                              onClick={() => onPushToCatalog(r.id)}
                              aria-label={`Simpan COGS/RRP ${r.name} ke katalog`}
                              title="Simpan COGS/RRP baris ini ke katalog master"
                            >
                              <Icon name="upload" size={15} />
                            </button>
                          )}
                          <button
                            className="icon-btn"
                            onClick={() => onRemove(r.id)}
                            aria-label={`Hapus ${r.name}`}
                            title="Hapus baris"
                          >
                            <Icon name="trash" size={15} />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {!readOnly && engine.rows.length > 0 && (
        <p className="muted small" style={{ marginTop: 8 }}>
          Kolom skenario terpilih bisa diketik langsung untuk mengunci harga manual. Kosongkan
          (isi 0) untuk kembali ke harga hitungan engine. Harga manual tetap dibatasi RRP.
        </p>
      )}
    </div>
  );
}
