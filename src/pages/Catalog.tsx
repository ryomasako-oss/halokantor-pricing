import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { Icon } from "../components/Icon";
import { Modal } from "../components/Modal";
import { ImportDialog } from "../components/ImportDialog";
import { fmtDateTime, grp } from "@shared/format";
import type { CatalogItem, UnitFactor } from "@shared/types";
import { cleanUnits, sameUom } from "@shared/uom";

interface Stats {
  total: number;
  priced: number;
  withList: number;
  updated: string | null;
}

const EMPTY_ITEM = {
  code: "", name: "", uom: "Pcs", cogs: 0, list_price: 0, category: "", units: [] as UnitFactor[],
};
type EditingItem = typeof EMPTY_ITEM & { id?: number };

export function CatalogPage() {
  const toast = useToast();
  const { can } = useAuth();
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<Stats | null>(null);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [sortBy, setSortBy] = useState<"name" | "stock" | "cogs" | "list_price">("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<null | "inventory" | "master" | "full" | "fullMerge">(null);
  const [editing, setEditing] = useState<EditingItem | null>(null);
  const [uomOptions, setUomOptions] = useState<string[]>([]);
  const [addingUom, setAddingUom] = useState(false);
  const [newUom, setNewUom] = useState("");
  // The base unit when the form opened: ratios are relative to it.
  const [baseAtOpen, setBaseAtOpen] = useState("");
  const PAGE = 50;

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({
      q: query.trim(),
      limit: String(PAGE),
      offset: String(page * PAGE),
      sortBy,
      sortDir,
    });
    api
      .get<{ items: CatalogItem[]; total: number }>(`/catalog?${params}`)
      .then((r) => {
        setItems(r.items);
        setTotal(r.total);
      })
      .catch((e) => toast(e.message, "error"))
      .finally(() => setLoading(false));
    api.get<{ stats: Stats }>("/catalog/stats").then((r) => setStats(r.stats)).catch(() => undefined);
  }, [query, page, sortBy, sortDir, toast]);

  const openEditing = (item: EditingItem) => {
    setAddingUom(false);
    setNewUom("");
    setBaseAtOpen(item.uom);
    setEditing(item);
  };
  const closeEditing = () => {
    setAddingUom(false);
    setNewUom("");
    setEditing(null);
  };

  const toggleSort = (field: "name" | "stock" | "cogs" | "list_price") => {
    setPage(0);
    setSortDir(sortBy === field && sortDir === "asc" ? "desc" : "asc");
    setSortBy(field);
  };

  useEffect(() => {
    const t = setTimeout(load, 220);
    return () => clearTimeout(t);
  }, [load]);

  const loadUom = useCallback(() => {
    api
      .get<{ options: { id: number; name: string }[] }>("/catalog/uom")
      .then((r) => setUomOptions(r.options.map((o) => o.name)))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    loadUom();
  }, [loadUom]);

  const pages = Math.ceil(total / PAGE);

  return (
    <main className="hk-main">
      <div className="hk-page-head">
        <div>
          <h1>Katalog barang</h1>
          <p>
            Harga pokok berasal dari laporan Nilai Persediaan, harga jual acuan dari Daftar Barang
            dan Jasa. Keduanya diekspor dari Accurate.
          </p>
        </div>
        {can("import_catalog") && (
          <div className="row-wrap">
            <button className="btn" onClick={() => openEditing({ ...EMPTY_ITEM })}>
              <Icon name="plus" size={15} /> Tambah barang
            </button>
            <button
              className="btn ghost"
              onClick={() => {
                void import("../import/parsers").then((m) => m.downloadFullCatalogTemplate());
              }}
            >
              <Icon name="download" size={15} /> Unduh template katalog
            </button>
            <button className="btn" onClick={() => setModal("inventory")}>
              <Icon name="box" size={15} /> Impor inventory (COGS)
            </button>
            <button className="btn" onClick={() => setModal("master")}>
              <Icon name="table" size={15} /> Impor daftar barang (harga jual)
            </button>
            <button className="btn" onClick={() => setModal("fullMerge")}>
              <Icon name="table" size={15} /> Impor katalog lengkap (gabung)
            </button>
            {can("delete_catalog") && (
              <button
                className="btn danger"
                onClick={() => {
                  if (window.confirm("Seluruh isi katalog saat ini akan dihapus dan diganti. Lanjutkan?")) {
                    setModal("full");
                  }
                }}
              >
                <Icon name="upload" size={15} /> Impor katalog lengkap (ganti semua)
              </button>
            )}
          </div>
        )}
      </div>

      {stats && (
        <div className="kpi-grid" style={{ marginBottom: 16 }}>
          <div className="kpi">
            <div className="label">Item di katalog</div>
            <div className="value num">{grp(stats.total)}</div>
          </div>
          <div className="kpi">
            <div className="label">Punya harga pokok</div>
            <div className="value num">{grp(stats.priced)}</div>
            <div className="foot">
              {stats.total ? Math.round((stats.priced / stats.total) * 100) : 0}% dari katalog
            </div>
          </div>
          <div className="kpi">
            <div className="label">Punya harga jual acuan</div>
            <div className="value num">{grp(stats.withList)}</div>
          </div>
          <div className="kpi">
            <div className="label">Terakhir diperbarui</div>
            <div className="value" style={{ fontSize: 15 }}>
              {stats.updated ? fmtDateTime(stats.updated) : "—"}
            </div>
          </div>
        </div>
      )}

      {stats && stats.total > 0 && stats.priced / stats.total < 0.6 && (
        <p className="notice warn" style={{ marginBottom: 12 }}>
          <Icon name="alert" size={14} /> Hanya {Math.round((stats.priced / stats.total) * 100)}%
          item punya harga pokok. Barang tanpa mutasi dan tanpa nilai di laporan persediaan memang
          tidak bisa dihitung COGS-nya — isi manual untuk item yang benar-benar dijual.
        </p>
      )}

      <div className="card">
        <div className="card-head">
          <input
            className="input"
            style={{ maxWidth: 320 }}
            placeholder="Cari nama atau kode barang"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
            aria-label="Cari katalog"
          />
          <span className="muted small">{grp(total)} item cocok</span>
        </div>

        {loading ? (
          <div className="card-body loading"><span className="dots"><i /><i /><i /></span> Memuat…</div>
        ) : items.length === 0 ? (
          <div className="card-body empty">
            <Icon name="box" size={28} />
            <h3>Katalog masih kosong</h3>
            <p>
              Impor laporan Nilai Persediaan untuk harga pokok, lalu Daftar Barang dan Jasa untuk
              harga jual acuan.
            </p>
          </div>
        ) : (
          <>
            <div className="table-wrap" style={{ border: 0 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th className="l">Kode</th>
                    <th className="l">Nama barang</th>
                    <th className="l">Kategori</th>
                    <th className="l">Satuan</th>
                    <th className="l">Konversi</th>
                    <th
                      role="button"
                      tabIndex={0}
                      onClick={() => toggleSort("cogs")}
                      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && toggleSort("cogs")}
                      style={{ cursor: "pointer", userSelect: "none" }}
                      title="Urutkan berdasarkan COGS"
                    >
                      COGS{sortBy === "cogs" && (sortDir === "asc" ? " ▲" : " ▼")}
                    </th>
                    <th
                      role="button"
                      tabIndex={0}
                      onClick={() => toggleSort("list_price")}
                      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && toggleSort("list_price")}
                      style={{ cursor: "pointer", userSelect: "none" }}
                      title="Urutkan berdasarkan harga jual"
                    >
                      Harga jual{sortBy === "list_price" && (sortDir === "asc" ? " ▲" : " ▼")}
                    </th>
                    <th
                      role="button"
                      tabIndex={0}
                      onClick={() => toggleSort("stock")}
                      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && toggleSort("stock")}
                      style={{ cursor: "pointer", userSelect: "none" }}
                      title="Urutkan berdasarkan stok"
                    >
                      Stok{sortBy === "stock" && (sortDir === "asc" ? " ▲" : " ▼")}
                    </th>
                    {can("edit_catalog") && <th aria-label="Aksi" />}
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id} className={item.cogs > 0 ? "" : "flagged"}>
                      <td className="l muted num">{item.code}</td>
                      <td className="l">{item.name}</td>
                      <td className="l muted small">{item.category || "—"}</td>
                      <td className="l muted">{item.uom}</td>
                      <td className="l">
                        {item.units?.length ? (
                          <div className="row-wrap" style={{ gap: 4 }}>
                            {item.units.map((u) => (
                              <span key={u.uom} className="badge grey num">
                                1 {u.uom} = {grp(u.factor)} {item.uom}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td className="num">
                        {item.cogs > 0 ? grp(item.cogs) : <span className="badge amber">kosong</span>}
                      </td>
                      <td className="num">{item.list_price > 0 ? grp(item.list_price) : "—"}</td>
                      <td className="num muted">{grp(item.stock)}</td>
                      {can("edit_catalog") && (
                        <td>
                          <button className="btn small ghost" onClick={() => openEditing({ ...item, units: item.units ?? [] })}>Ubah</button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {pages > 1 && (
              <div className="card-body row" style={{ justifyContent: "center" }}>
                <button className="btn small" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                  Sebelumnya
                </button>
                <span className="muted small">Halaman {page + 1} dari {pages}</span>
                <button className="btn small" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>
                  Berikutnya
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {modal === "inventory" && (
        <ImportDialog
          title="Impor laporan Nilai Persediaan"
          description='Export Accurate "Nilai Persediaan". COGS per unit dihitung dari nilai barang masuk dibagi kuantitasnya.'
          onClose={() => {
            setModal(null);
            load();
          }}
          onFile={async (file) => {
            const { parseInventory } = await import("../import/parsers");
            const { rows, report } = await parseInventory(file);
            const r = await api.post<{ inserted: number; updated: number }>("/catalog/import", {
              rows,
              source: file.name,
              mode: "merge",
            });
            return {
              report,
              summary: `${report.count} barang terbaca. ${r.inserted} baru ditambahkan, ${r.updated} diperbarui.`,
            };
          }}
        />
      )}

      {modal === "full" && (
        <ImportDialog
          title="Impor katalog lengkap"
          description={
            <>
              <strong style={{ color: "var(--danger)" }}>
                Ini menghapus seluruh isi katalog lalu menggantinya dengan isi file ini.
              </strong>{" "}
              Pakai template "Unduh template katalog". Kolom Kode Barang dan Nama Barang wajib diisi.
            </>
          }
          onClose={() => {
            setModal(null);
            load();
          }}
          onFile={async (file) => {
            const { parseFullCatalog } = await import("../import/parsers");
            const { rows, report } = await parseFullCatalog(file);
            const r = await api.post<{ inserted: number; updated: number; total: number }>("/catalog/import", {
              rows,
              source: file.name,
              mode: "replace",
            });
            return {
              report,
              summary: `Katalog diganti. ${r.total} barang dari file, ${r.inserted} ditambahkan.`,
            };
          }}
        />
      )}

      {modal === "fullMerge" && (
        <ImportDialog
          title="Impor katalog lengkap (gabung)"
          description='Sama seperti template katalog lengkap (Kode Barang, Nama Barang, COGS, Harga Jual sekaligus), tapi digabung ke katalog yang ada — barang lama tidak dihapus. Kode yang sudah ada diperbarui, kode baru ditambahkan.'
          onClose={() => {
            setModal(null);
            load();
          }}
          onFile={async (file) => {
            const { parseFullCatalog } = await import("../import/parsers");
            const { rows, report } = await parseFullCatalog(file);
            const r = await api.post<{ inserted: number; updated: number; total: number }>("/catalog/import", {
              rows,
              source: file.name,
              mode: "merge",
            });
            return {
              report,
              summary: `${r.total} barang dari file: ${r.inserted} ditambahkan, ${r.updated} diperbarui.`,
            };
          }}
        />
      )}

      {modal === "master" && (
        <ImportDialog
          title="Impor Daftar Barang dan Jasa"
          description='Export Accurate "Daftar Barang dan Jasa". Harga jual default dipakai sebagai plafon awal saat item ditambahkan ke quotation.'
          onClose={() => {
            setModal(null);
            load();
          }}
          onFile={async (file) => {
            const { parseItemMaster } = await import("../import/parsers");
            const { rows, report } = await parseItemMaster(file);
            const r = await api.post<{ inserted: number; updated: number }>("/catalog/import", {
              rows,
              source: file.name,
              mode: "merge",
            });
            return {
              report,
              summary: `${report.count} barang terbaca. ${r.inserted} baru ditambahkan, ${r.updated} diperbarui.`,
            };
          }}
        />
      )}

      {editing && (
        <Modal
          title={editing.id ? "Ubah data barang" : "Tambah barang"}
          sub={editing.id ? editing.code : undefined}
          onClose={closeEditing}
          footer={
            <>
              <button className="btn ghost" onClick={closeEditing}>Batal</button>
              <button
                className="btn primary"
                disabled={!editing.name.trim() || (!editing.id && !editing.code.trim())}
                onClick={async () => {
                  try {
                    if (editing.id) {
                      await api.put(`/catalog/${editing.id}`, {
                        name: editing.name,
                        uom: editing.uom,
                        cogs: Number(editing.cogs),
                        list_price: Number(editing.list_price),
                        category: editing.category,
                        units: cleanUnits(editing.uom, editing.units),
                      });
                      toast("Barang diperbarui.", "success");
                    } else {
                      await api.post("/catalog/import", {
                        rows: [
                          {
                            code: editing.code.trim(),
                            name: editing.name,
                            uom: editing.uom,
                            cogs: Number(editing.cogs),
                            list_price: Number(editing.list_price),
                            category: editing.category,
                            units: cleanUnits(editing.uom, editing.units),
                          },
                        ],
                        source: "manual",
                        mode: "merge",
                      });
                      toast("Barang ditambahkan.", "success");
                    }
                    closeEditing();
                    load();
                  } catch (e) {
                    toast(e instanceof Error ? e.message : "Gagal menyimpan.", "error");
                  }
                }}
              >
                Simpan
              </button>
            </>
          }
        >
          <div className="col" style={{ gap: 12 }}>
            {!editing.id && (
              <label className="field">
                <span>Kode barang</span>
                <input
                  className="input"
                  value={editing.code}
                  onChange={(e) => setEditing({ ...editing, code: e.target.value })}
                  placeholder="Kode unik, misal ATK-0001"
                />
              </label>
            )}
            <label className="field">
              <span>Nama barang</span>
              <input
                className="input"
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              />
            </label>
            <div className="field-grid">
              <label className="field">
                <span>Satuan dasar</span>
                {addingUom ? (
                  <div className="row-wrap" style={{ gap: 6 }}>
                    <input
                      className="input"
                      autoFocus
                      placeholder="Satuan baru, misal Dus"
                      value={newUom}
                      onChange={(e) => setNewUom(e.target.value)}
                    />
                    <button
                      type="button"
                      className="btn small"
                      disabled={!newUom.trim()}
                      onClick={async () => {
                        try {
                          const name = newUom.trim();
                          await api.post("/catalog/uom", { name });
                          loadUom();
                          setEditing({ ...editing, uom: name });
                          setNewUom("");
                          setAddingUom(false);
                        } catch (e) {
                          toast(e instanceof Error ? e.message : "Gagal menambah satuan.", "error");
                        }
                      }}
                    >
                      Tambah
                    </button>
                    <button type="button" className="btn small ghost" onClick={() => { setAddingUom(false); setNewUom(""); }}>
                      Batal
                    </button>
                  </div>
                ) : (
                  <select
                    className="select"
                    value={editing.uom}
                    onChange={(e) => {
                      if (e.target.value === "__new__") { setAddingUom(true); return; }
                      setEditing({ ...editing, uom: e.target.value });
                    }}
                  >
                    {!uomOptions.includes(editing.uom) && editing.uom && (
                      <option value={editing.uom}>{editing.uom}</option>
                    )}
                    {uomOptions.map((u) => (
                      <option key={u} value={u}>{u}</option>
                    ))}
                    <option value="__new__">+ Tambah satuan baru…</option>
                  </select>
                )}
              </label>
              <label className="field">
                <span>COGS per {editing.uom || "satuan"}</span>
                <input
                  className="input"
                  type="number"
                  min="0"
                  value={editing.cogs}
                  onChange={(e) => setEditing({ ...editing, cogs: Number(e.target.value) })}
                />
              </label>
              <label className="field">
                <span>Harga jual acuan per {editing.uom || "satuan"}</span>
                <input
                  className="input"
                  type="number"
                  min="0"
                  value={editing.list_price}
                  onChange={(e) => setEditing({ ...editing, list_price: Number(e.target.value) })}
                />
              </label>
              <label className="field">
                <span>Kategori</span>
                <input
                  className="input"
                  value={editing.category}
                  onChange={(e) => setEditing({ ...editing, category: e.target.value })}
                />
              </label>
            </div>
            {!!editing.id && editing.units.length > 0 && !sameUom(editing.uom, baseAtOpen) && (
              <p className="notice warn">
                Satuan dasar diganti dari {baseAtOpen} ke {editing.uom}. Isi konversi di bawah sekarang
                dihitung dalam {editing.uom}, cek ulang angkanya sebelum simpan.
              </p>
            )}
            <UnitsEditor
              baseUom={editing.uom}
              units={editing.units}
              options={uomOptions}
              onChange={(units) => setEditing({ ...editing, units })}
            />
          </div>
        </Modal>
      )}
    </main>
  );
}

/* Extra units for one item and how many base units each holds, laid out as
   a small data-entry table (same cells as the quote's items table). The
   quote editor uses these to rescale COGS/RRP when a line's unit changes. */
function UnitsEditor({
  baseUom,
  units,
  options,
  onChange,
}: {
  baseUom: string;
  units: UnitFactor[];
  options: string[];
  onChange: (units: UnitFactor[]) => void;
}) {
  const set = (i: number, patch: Partial<UnitFactor>) =>
    onChange(units.map((u, k) => (k === i ? { ...u, ...patch } : u)));
  const free = (keep?: string) =>
    options.filter(
      (o) => (keep && sameUom(o, keep)) || (!sameUom(o, baseUom) && !units.some((u) => sameUom(u.uom, o))),
    );
  const unused = free();
  const base = baseUom || "satuan dasar";
  return (
    <div className="field">
      <span>Konversi satuan</span>
      <div className="table-wrap" style={{ borderRadius: 12 }}>
        <table className="table">
          <thead>
            <tr>
              <th className="l">Satuan</th>
              <th>Isi ({base})</th>
              <th aria-label="Aksi" />
            </tr>
          </thead>
          <tbody>
            {units.length === 0 ? (
              <tr>
                <td className="l muted small" colSpan={3}>
                  Belum ada. Tanpa konversi, mengganti satuan di quotation tidak mengubah COGS/RRP.
                </td>
              </tr>
            ) : (
              units.map((u, i) => (
                <tr key={i}>
                  <td className="l">
                    <select
                      className="cell"
                      value={u.uom}
                      onChange={(e) => set(i, { uom: e.target.value })}
                      aria-label={`Satuan konversi ${i + 1}`}
                    >
                      {!options.some((o) => sameUom(o, u.uom)) && <option value={u.uom}>{u.uom}</option>}
                      {free(u.uom).map((o) => (
                        <option key={o} value={o}>{o}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      className="cell"
                      type="number"
                      min="0"
                      step="any"
                      value={u.factor || ""}
                      placeholder="0"
                      onChange={(e) => set(i, { factor: Number(e.target.value) })}
                      aria-label={`Rasio ${u.uom}`}
                    />
                  </td>
                  <td style={{ width: 36 }}>
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => onChange(units.filter((_, k) => k !== i))}
                      aria-label={`Hapus satuan ${u.uom}`}
                      title="Hapus"
                    >
                      <Icon name="trash" size={15} />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className="row-wrap" style={{ justifyContent: "space-between" }}>
        <span className="muted small">
          {units[0]?.factor > 0
            ? `Contoh: 1 ${units[0].uom} = ${units[0].factor} ${base}.`
            : `Isi = berapa ${base} dalam 1 satuan itu.`}
        </span>
        {unused.length > 0 && units.length < 10 && (
          <button
            type="button"
            className="btn small"
            onClick={() => onChange([...units, { uom: unused[0], factor: 0 }])}
          >
            <Icon name="plus" size={14} />
            Tambah satuan
          </button>
        )}
      </div>
    </div>
  );
}
