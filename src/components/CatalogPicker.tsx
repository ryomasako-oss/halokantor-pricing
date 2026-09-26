/* Adds priced catalogue items to a quote. Cost comes from the imported
   inventory, and the ceiling defaults to the item master's list price. */

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { grp } from "@shared/format";
import { normalizeCode } from "@shared/duplicates";
import type { CatalogItem, QuoteItem } from "@shared/types";
import { changeLineUom, uomChoices, uomWarning } from "@shared/uom";
import { Modal } from "./Modal";
import { Icon } from "./Icon";
import { UomCell } from "./UomCell";

export function CatalogPicker({
  onClose,
  onAdd,
  existingCodes,
}: {
  onClose: () => void;
  /** Receives the picks; the parent closes (or replaces) this dialog. */
  onAdd: (items: QuoteItem[]) => void;
  /** Codes already on the quote, normalized with `normalizeCode`. */
  existingCodes: Set<string>;
}) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [chosen, setChosen] = useState<Record<number, number>>({});
  // Items stay picked across searches, but a later search replaces `items` and
  // drops earlier matches from it. Cache the full row here so add() doesn't
  // need the item to still be in the current search results.
  const [pickedItems, setPickedItems] = useState<Record<number, CatalogItem>>({});
  const [onlyPriced, setOnlyPriced] = useState(true);
  // Managed satuan list. A row's UOM can be switched at pick time (e.g. an
  // item mastered in Pcs but ordered per Lusin); COGS/RRP are rescaled with
  // the item's ratio, and the override only applies to the quote line, never
  // to the catalog master.
  const [uomOptions, setUomOptions] = useState<string[]>([]);
  const [uomOverride, setUomOverride] = useState<Record<number, string>>({});

  useEffect(() => {
    api
      .get<{ options: { id: number; name: string }[] }>("/catalog/uom")
      .then((r) => setUomOptions(r.options.map((o) => o.name)))
      .catch(() => setUomOptions([]));
  }, []);

  const search = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ q: query.trim(), limit: "60" });
    if (onlyPriced) params.set("withCogs", "1");
    api
      .get<{ items: CatalogItem[]; total: number }>(`/catalog?${params}`)
      .then((r) => {
        setItems(r.items);
        setTotal(r.total);
      })
      .finally(() => setLoading(false));
  }, [query, onlyPriced]);

  useEffect(() => {
    const t = setTimeout(search, 220);
    return () => clearTimeout(t);
  }, [search]);

  const selected = useMemo(
    () => Object.entries(chosen).filter(([, qty]) => qty > 0),
    [chosen],
  );

  /** The quote line for an item, built in its base unit, then converted to the chosen unit. */
  const lineFor = (item: CatalogItem, qty: number): QuoteItem => {
    const baseUom = item.uom || "Pcs";
    const base: QuoteItem = {
      id: `cat-${item.id}-${Math.random().toString(36).slice(2, 7)}`,
      lineNo: 0,
      code: item.code,
      name: item.name,
      uom: baseUom,
      qty,
      cogs: Math.round(item.cogs),
      // The master's list price is the natural starting ceiling.
      rrp: Math.round(item.list_price || item.cogs * 1.4),
      role: "CORE",
      estCogs: !(item.cogs > 0),
    };
    const to = uomOverride[item.id];
    return to ? changeLineUom(base, to, { baseUom, units: item.units ?? [] }) : base;
  };

  const add = () => {
    const picked = selected
      .map(([id, qty]) => {
        const item = pickedItems[Number(id)];
        return item ? lineFor(item, qty) : null;
      })
      .filter(Boolean) as QuoteItem[];
    onAdd(picked);
  };

  return (
    <Modal
      title="Tambah item dari katalog"
      sub={`${total} item cocok. COGS berasal dari inventory, plafon awal dari harga jual master.`}
      size="wide"
      onClose={onClose}
      footer={
        <>
          <span className="grow muted small">{selected.length} item dipilih</span>
          <button className="btn ghost" onClick={onClose}>Batal</button>
          <button className="btn primary" onClick={add} disabled={!selected.length}>
            Tambahkan {selected.length || ""}
          </button>
        </>
      }
    >
      <div className="search-bar" style={{ marginBottom: 10 }}>
        <input
          className="input"
          autoFocus
          placeholder="Cari nama atau kode barang"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Cari katalog"
        />
        <label className="toggle">
          <input type="checkbox" checked={onlyPriced} onChange={(e) => setOnlyPriced(e.target.checked)} />
          <span className="small">Hanya yang punya COGS</span>
        </label>
      </div>

      {loading ? (
        <div className="loading"><span className="dots"><i /><i /><i /></span> Mencari…</div>
      ) : items.length === 0 ? (
        <div className="empty">
          <Icon name="box" size={26} />
          <h3>Tidak ada yang cocok</h3>
          <p>
            Kalau katalog masih kosong, impor file inventory dan daftar barang di menu Katalog
            terlebih dahulu.
          </p>
        </div>
      ) : (
        <div className="table-wrap" style={{ maxHeight: "52vh" }}>
          <table className="table">
            <thead>
              <tr>
                <th className="l">Item</th>
                <th>COGS</th>
                <th>Harga jual</th>
                <th>Stok</th>
                <th className="l">Satuan</th>
                <th>Qty</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const line = lineFor(item, 0);
                const warn = uomWarning(line);
                return (
                <tr key={item.id}>
                  <td className="l">
                    <div style={{ fontWeight: 550 }}>{item.name}</div>
                    <div className="muted small">
                      {item.code}
                      {item.category ? ` · ${item.category}` : ""}
                      {existingCodes.has(normalizeCode(item.code)) && (
                        <span className="badge amber" style={{ marginLeft: 6 }}>sudah ada</span>
                      )}
                    </div>
                  </td>
                  <td className="num">{item.cogs > 0 ? grp(line.cogs) : <span className="muted">—</span>}</td>
                  <td className="num">{item.list_price > 0 ? grp(line.rrp) : <span className="muted">—</span>}</td>
                  <td className="num muted">{grp(item.stock)}</td>
                  <td className="l">
                    <UomCell
                      value={line.uom}
                      choices={uomOptions.length ? uomChoices(uomOptions, { baseUom: item.uom || "Pcs", units: item.units ?? [] }, line.uom) : []}
                      label={`Satuan ${item.name}`}
                      warning={warn}
                      onChange={(u) => setUomOverride((o) => ({ ...o, [item.id]: u }))}
                    />
                  </td>
                  <td>
                    <input
                      className="cell"
                      type="number"
                      min="0"
                      placeholder="0"
                      value={chosen[item.id] ?? ""}
                      onChange={(e) => {
                        setChosen((c) => ({ ...c, [item.id]: Math.max(0, Number(e.target.value)) }));
                        setPickedItems((p) => ({ ...p, [item.id]: item }));
                      }}
                      aria-label={`Qty untuk ${item.name}`}
                    />
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
