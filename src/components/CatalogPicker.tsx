/* Adds priced catalogue items to a quote. Cost comes from the imported
   inventory, and the ceiling defaults to the item master's list price. */

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { grp } from "@shared/format";
import type { CatalogItem, QuoteItem } from "@shared/types";
import { Modal } from "./Modal";
import { Icon } from "./Icon";

export function CatalogPicker({
  onClose,
  onAdd,
  existingCodes,
}: {
  onClose: () => void;
  onAdd: (items: QuoteItem[]) => void;
  existingCodes: Set<string>;
}) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [chosen, setChosen] = useState<Record<number, number>>({});
  const [onlyPriced, setOnlyPriced] = useState(true);

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

  const add = () => {
    const picked = selected
      .map(([id, qty]) => {
        const item = items.find((x) => x.id === Number(id));
        if (!item) return null;
        return {
          id: `cat-${item.id}-${Math.random().toString(36).slice(2, 7)}`,
          lineNo: 0,
          code: item.code,
          name: item.name,
          uom: item.uom || "Pcs",
          qty,
          cogs: Math.round(item.cogs),
          // The master's list price is the natural starting ceiling.
          rrp: Math.round(item.list_price || item.cogs * 1.4),
          role: "CORE" as const,
          estCogs: !(item.cogs > 0),
        };
      })
      .filter(Boolean) as QuoteItem[];
    onAdd(picked);
    onClose();
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
                <th>Qty/bln</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td className="l">
                    <div style={{ fontWeight: 550 }}>{item.name}</div>
                    <div className="muted small">
                      {item.code}
                      {item.category ? ` · ${item.category}` : ""}
                      {existingCodes.has(item.code) && (
                        <span className="badge amber" style={{ marginLeft: 6 }}>sudah ada</span>
                      )}
                    </div>
                  </td>
                  <td className="num">{item.cogs > 0 ? grp(item.cogs) : <span className="muted">—</span>}</td>
                  <td className="num">{item.list_price > 0 ? grp(item.list_price) : <span className="muted">—</span>}</td>
                  <td className="num muted">{grp(item.stock)}</td>
                  <td>
                    <input
                      className="cell"
                      type="number"
                      min="0"
                      placeholder="0"
                      value={chosen[item.id] ?? ""}
                      onChange={(e) =>
                        setChosen((c) => ({ ...c, [item.id]: Math.max(0, Number(e.target.value)) }))
                      }
                      aria-label={`Qty untuk ${item.name}`}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
