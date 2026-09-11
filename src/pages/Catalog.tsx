import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { Icon } from "../components/Icon";
import { Modal } from "../components/Modal";
import { ImportDialog } from "../components/ImportDialog";
import { fmtDateTime, grp } from "@shared/format";
import type { CatalogItem } from "@shared/types";

interface Stats {
  total: number;
  priced: number;
  withList: number;
  updated: string | null;
}

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
  const [modal, setModal] = useState<null | "inventory" | "master" | "full">(null);
  const [editing, setEditing] = useState<CatalogItem | null>(null);
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

  const toggleSort = (field: "name" | "stock" | "cogs" | "list_price") => {
    setPage(0);
    setSortDir(sortBy === field && sortDir === "asc" ? "desc" : "asc");
    setSortBy(field);
  };

  useEffect(() => {
    const t = setTimeout(load, 220);
    return () => clearTimeout(t);
  }, [load]);

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
        {can("manager") && (
          <div className="row-wrap">
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
            {can("admin") && (
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
                    <th>Satuan</th>
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
                    {can("manager") && <th aria-label="Aksi" />}
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id} className={item.cogs > 0 ? "" : "flagged"}>
                      <td className="l muted num">{item.code}</td>
                      <td className="l">{item.name}</td>
                      <td className="l muted small">{item.category || "—"}</td>
                      <td className="c muted">{item.uom}</td>
                      <td className="num">
                        {item.cogs > 0 ? grp(item.cogs) : <span className="badge amber">kosong</span>}
                      </td>
                      <td className="num">{item.list_price > 0 ? grp(item.list_price) : "—"}</td>
                      <td className="num muted">{grp(item.stock)}</td>
                      {can("manager") && (
                        <td>
                          <button className="btn small ghost" onClick={() => setEditing(item)}>Ubah</button>
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
          title="Ubah data barang"
          sub={editing.code}
          onClose={() => setEditing(null)}
          footer={
            <>
              <button className="btn ghost" onClick={() => setEditing(null)}>Batal</button>
              <button
                className="btn primary"
                onClick={async () => {
                  try {
                    await api.put(`/catalog/${editing.id}`, {
                      name: editing.name,
                      uom: editing.uom,
                      cogs: Number(editing.cogs),
                      list_price: Number(editing.list_price),
                      category: editing.category,
                    });
                    setEditing(null);
                    load();
                    toast("Barang diperbarui.", "success");
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
                <span>Satuan</span>
                <input
                  className="input"
                  value={editing.uom}
                  onChange={(e) => setEditing({ ...editing, uom: e.target.value })}
                />
              </label>
              <label className="field">
                <span>COGS per unit</span>
                <input
                  className="input"
                  type="number"
                  min="0"
                  value={editing.cogs}
                  onChange={(e) => setEditing({ ...editing, cogs: Number(e.target.value) })}
                />
              </label>
              <label className="field">
                <span>Harga jual acuan</span>
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
          </div>
        </Modal>
      )}
    </main>
  );
}
