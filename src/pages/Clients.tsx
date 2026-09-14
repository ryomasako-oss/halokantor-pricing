import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { Icon } from "../components/Icon";
import { Modal, ConfirmModal } from "../components/Modal";
import type { Client } from "@shared/types";

const EMPTY = {
  name: "", code: "", address: "", contact_name: "", contact_email: "",
  contact_phone: "", payment_terms: "30 hari setelah invoice",
  delivery_terms: "Franco Jakarta, jadwal mingguan",
};

export function ClientsPage() {
  const toast = useToast();
  const { can } = useAuth();
  const [clients, setClients] = useState<(Client & { quote_count?: number })[]>([]);
  const [editing, setEditing] = useState<(typeof EMPTY & { id?: number }) | null>(null);
  const [deleting, setDeleting] = useState<Client | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    api
      .get<{ clients: Client[] }>("/clients")
      .then((r) => setClients(r.clients))
      .catch((e) => toast(e.message, "error"))
      .finally(() => setLoading(false));
  }, [toast]);

  useEffect(load, [load]);

  const save = async () => {
    if (!editing) return;
    try {
      const body = { ...EMPTY, ...editing };
      if (editing.id) await api.put(`/clients/${editing.id}`, body);
      else await api.post("/clients", body);
      setEditing(null);
      load();
      toast("Klien tersimpan.", "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Gagal menyimpan klien.", "error");
    }
  };

  return (
    <main className="hk-main">
      <div className="hk-page-head">
        <div>
          <h1>Klien</h1>
          <p>Data klien mengisi otomatis termin dan alamat di setiap quotation baru.</p>
        </div>
        <button className="btn primary" onClick={() => setEditing({ ...EMPTY })}>
          <Icon name="plus" size={16} /> Klien baru
        </button>
      </div>

      <div className="card">
        {loading ? (
          <div className="card-body loading"><span className="dots"><i /><i /><i /></span> Memuat…</div>
        ) : clients.length === 0 ? (
          <div className="card-body empty">
            <Icon name="building" size={28} />
            <h3>Belum ada klien</h3>
            <p>Tambahkan klien pertama supaya quotation langsung terisi alamat dan terminnya.</p>
          </div>
        ) : (
          <div className="table-wrap" style={{ border: 0 }}>
            <table className="table">
              <thead>
                <tr>
                  <th className="l">Nama</th>
                  <th className="l">Kode</th>
                  <th className="l">Kontak</th>
                  <th className="l">Termin</th>
                  <th>Quotation</th>
                  <th aria-label="Aksi" />
                </tr>
              </thead>
              <tbody>
                {clients.map((c) => (
                  <tr key={c.id}>
                    <td className="l">
                      <strong>{c.name}</strong>
                      {c.address && <div className="muted small">{c.address}</div>}
                    </td>
                    <td className="l muted">{c.code || "—"}</td>
                    <td className="l">
                      {c.contact_name || "—"}
                      {c.contact_email && <div className="muted small">{c.contact_email}</div>}
                    </td>
                    <td className="l muted small">{c.payment_terms}</td>
                    <td className="num">{c.quote_count ?? 0}</td>
                    <td>
                      <div className="row" style={{ justifyContent: "flex-end" }}>
                        <button className="btn small ghost" onClick={() => setEditing({ ...c })}>
                          Ubah
                        </button>
                        {can("delete_clients") && (
                          <button className="icon-btn" onClick={() => setDeleting(c)} aria-label={`Hapus ${c.name}`}>
                            <Icon name="trash" size={15} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing && (
        <Modal
          title={editing.id ? "Ubah klien" : "Klien baru"}
          onClose={() => setEditing(null)}
          footer={
            <>
              <button className="btn ghost" onClick={() => setEditing(null)}>Batal</button>
              <button className="btn primary" onClick={save} disabled={!editing.name.trim()}>
                Simpan
              </button>
            </>
          }
        >
          <div className="field-grid">
            {([
              ["name", "Nama perusahaan"],
              ["code", "Kode klien"],
              ["contact_name", "Nama kontak"],
              ["contact_email", "Email kontak"],
              ["contact_phone", "Telepon"],
              ["payment_terms", "Termin pembayaran"],
              ["delivery_terms", "Ketentuan pengiriman"],
            ] as const).map(([key, label]) => (
              <label className="field" key={key}>
                <span>{label}</span>
                <input
                  className="input"
                  value={(editing as unknown as Record<string, string>)[key] ?? ""}
                  onChange={(e) => setEditing({ ...editing, [key]: e.target.value })}
                />
              </label>
            ))}
          </div>
          <label className="field" style={{ marginTop: 12 }}>
            <span>Alamat</span>
            <textarea
              className="textarea"
              rows={2}
              value={editing.address}
              onChange={(e) => setEditing({ ...editing, address: e.target.value })}
            />
          </label>
        </Modal>
      )}

      {deleting && (
        <ConfirmModal
          title={`Hapus ${deleting.name}?`}
          message="Klien yang masih dipakai quotation tidak bisa dihapus."
          confirmLabel="Hapus klien"
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            try {
              await api.del(`/clients/${deleting.id}`);
              setDeleting(null);
              load();
              toast("Klien dihapus.", "success");
            } catch (e) {
              toast(e instanceof Error ? e.message : "Gagal menghapus.", "error");
            }
          }}
        />
      )}
    </main>
  );
}
