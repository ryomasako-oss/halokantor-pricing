import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { Icon } from "../components/Icon";
import { Modal } from "../components/Modal";
import { StatusChip } from "../components/pricing";
import { fmtDateTime, pct, rp } from "@shared/format";
import type { Client, QuoteStatus } from "@shared/types";

interface QuoteRow {
  id: number;
  number: string;
  title: string;
  client_name: string | null;
  status: QuoteStatus;
  scenario: number;
  rev_no: number;
  created_by_name: string;
  updated_at: string;
  item_count: number;
  monthly_value: number;
  net_margin: number;
}

const FILTERS: { key: string; label: string }[] = [
  { key: "all", label: "Semua" },
  { key: "draft", label: "Draft" },
  { key: "submitted", label: "Menunggu" },
  { key: "approved", label: "Disetujui" },
  { key: "sent", label: "Terkirim" },
  { key: "won", label: "Menang" },
  { key: "lost", label: "Kalah" },
];

export function DashboardPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
  const [quotes, setQuotes] = useState<QuoteRow[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [filter, setFilter] = useState("all");
  const [mine, setMine] = useState(false);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filter !== "all") params.set("status", filter);
    if (mine) params.set("mine", "1");
    api
      .get<{ quotes: QuoteRow[] }>(`/quotes?${params}`)
      .then((r) => setQuotes(r.quotes))
      .catch((e) => toast(e.message, "error"))
      .finally(() => setLoading(false));
  }, [filter, mine, toast]);

  useEffect(load, [load]);
  useEffect(() => {
    api
      .get<{ clients: Client[] }>("/clients")
      .then((r) => setClients(r.clients))
      .catch(() => undefined);
  }, []);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return quotes;
    return quotes.filter(
      (x) =>
        x.title.toLowerCase().includes(q) ||
        x.number.toLowerCase().includes(q) ||
        (x.client_name ?? "").toLowerCase().includes(q),
    );
  }, [quotes, query]);

  const kpi = useMemo(() => {
    const active = quotes.filter((q) => ["approved", "sent"].includes(q.status));
    const pipeline = active.reduce((s, q) => s + q.monthly_value, 0);
    const won = quotes.filter((q) => q.status === "won");
    const wonValue = won.reduce((s, q) => s + q.monthly_value, 0);
    const decided = quotes.filter((q) => q.status === "won" || q.status === "lost").length;
    const margins = quotes.filter((q) => q.monthly_value > 0).map((q) => q.net_margin);
    return {
      pipeline,
      wonValue,
      winRate: decided ? won.length / decided : 0,
      avgMargin: margins.length ? margins.reduce((a, b) => a + b, 0) / margins.length : 0,
      waiting: quotes.filter((q) => q.status === "submitted").length,
    };
  }, [quotes]);

  return (
    <main className="hk-main">
      <div className="hk-page-head">
        <div>
          <h1>Quotation</h1>
          <p>
            Selamat datang, {user?.name.split(" ")[0]}. {quotes.length} quotation terlihat oleh Anda.
          </p>
        </div>
        <button className="btn primary" onClick={() => setCreating(true)}>
          <Icon name="plus" size={16} />
          Quotation baru
        </button>
      </div>

      <div className="kpi-grid" style={{ marginBottom: 16 }}>
        <div className="kpi">
          <div className="label">Pipeline aktif per bulan</div>
          <div className="value num">{rp(kpi.pipeline)}</div>
          <div className="foot">Disetujui dan terkirim</div>
        </div>
        <div className="kpi">
          <div className="label">Nilai dimenangkan</div>
          <div className="value num">{rp(kpi.wonValue)}</div>
          <div className="foot">Per bulan</div>
        </div>
        <div className="kpi">
          <div className="label">Tingkat menang</div>
          <div className="value num">{pct(kpi.winRate, 0)}</div>
          <div className="foot">Dari yang sudah diputus</div>
        </div>
        <div className="kpi">
          <div className="label">Rata-rata net margin</div>
          <div className="value num">{pct(kpi.avgMargin)}</div>
          <div className="foot">Semua quotation terlihat</div>
        </div>
        <div className="kpi">
          <div className="label">Menunggu persetujuan</div>
          <div className="value num">{kpi.waiting}</div>
          <div className="foot">Tertahan di manajer</div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div className="tabs">
            {FILTERS.map((f) => (
              <button key={f.key} className={filter === f.key ? "on" : ""} onClick={() => setFilter(f.key)}>
                {f.label}
              </button>
            ))}
          </div>
          <div className="row-wrap">
            <label className="toggle">
              <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} />
              <span className="small">Punya saya</span>
            </label>
            <input
              className="input"
              style={{ maxWidth: 220, minWidth: 170 }}
              placeholder="Cari nomor, judul, klien"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Cari quotation"
            />
          </div>
        </div>

        {loading ? (
          <div className="card-body loading">
            <span className="dots"><i /><i /><i /></span> Memuat quotation…
          </div>
        ) : visible.length === 0 ? (
          <div className="card-body empty">
            <Icon name="quote" size={28} />
            <h3>Belum ada quotation di sini</h3>
            <p>Buat quotation baru, lalu isi itemnya dari katalog atau file Excel klien.</p>
            <button className="btn primary" onClick={() => setCreating(true)}>
              Quotation baru
            </button>
          </div>
        ) : (
          <div className="table-wrap" style={{ border: 0, borderRadius: 0 }}>
            <table className="table">
              <thead>
                <tr>
                  <th className="l">Nomor</th>
                  <th className="l">Judul</th>
                  <th className="l">Klien</th>
                  <th className="l">Status</th>
                  <th>Item</th>
                  <th>Nilai/bulan</th>
                  <th>Net margin</th>
                  <th className="l">Dibuat oleh</th>
                  <th className="l">Diubah</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((q) => (
                  <tr key={q.id} className="clickable" onClick={() => navigate(`/quotes/${q.id}`)}>
                    <td className="l num nowrap">
                      {q.number}
                      {q.rev_no > 1 && <span className="badge grey" style={{ marginLeft: 5 }}>rev {q.rev_no}</span>}
                    </td>
                    <td className="l">{q.title}</td>
                    <td className="l">{q.client_name ?? <span className="muted">—</span>}</td>
                    <td className="l"><StatusChip status={q.status} /></td>
                    <td className="num">{q.item_count}</td>
                    <td className="num">{rp(q.monthly_value)}</td>
                    <td className="num">
                      <span style={{ color: q.net_margin < 0.15 ? "var(--danger)" : undefined }}>
                        {pct(q.net_margin)}
                      </span>
                    </td>
                    <td className="l muted">{q.created_by_name}</td>
                    <td className="l muted nowrap">{fmtDateTime(q.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {creating && (
        <NewQuoteModal
          clients={clients}
          onClose={() => setCreating(false)}
          onCreated={(id) => navigate(`/quotes/${id}`)}
        />
      )}
    </main>
  );
}

function NewQuoteModal({
  clients,
  onClose,
  onCreated,
}: {
  clients: Client[];
  onClose: () => void;
  onCreated: (id: number) => void;
}) {
  const toast = useToast();
  const [title, setTitle] = useState("");
  const [clientId, setClientId] = useState<number | "">(clients[0]?.id ?? "");
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ quote: { id: number } }>("/quotes", {
        title: title.trim(),
        client_id: clientId === "" ? null : Number(clientId),
      });
      onCreated(r.quote.id);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Gagal membuat quotation.", "error");
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Quotation baru"
      sub="Nomor dibuat otomatis mengikuti urutan bulan berjalan."
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>Batal</button>
          <button className="btn primary" onClick={create} disabled={busy || !title.trim()}>
            {busy ? "Membuat…" : "Buat dan buka"}
          </button>
        </>
      }
    >
      <div className="col" style={{ gap: 12 }}>
        <label className="field">
          <span>Judul quotation</span>
          <input
            className="input"
            autoFocus
            placeholder="Kontrak ATK 2026"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Klien</span>
          <select
            className="select"
            value={clientId}
            onChange={(e) => setClientId(e.target.value === "" ? "" : Number(e.target.value))}
          >
            <option value="">Tanpa klien</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
        {clients.length === 0 && (
          <p className="notice info">
            Belum ada klien terdaftar. Anda bisa membuatnya nanti di menu Klien.
          </p>
        )}
      </div>
    </Modal>
  );
}
