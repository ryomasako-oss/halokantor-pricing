import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { useToast } from "../context/ToastContext";
import { Icon } from "../components/Icon";
import { BreachList } from "../components/pricing";
import { fmtDateTime, pct, rp } from "@shared/format";
import type { PolicyBreach } from "@shared/types";

interface ApprovalRow {
  id: number;
  quote_id: number;
  quote_number: string;
  quote_title: string;
  quote_status: string;
  client_name: string | null;
  decision: "pending" | "approved" | "rejected";
  note: string | null;
  requested_at: string;
  decided_at: string | null;
  requested_by_name: string;
  decided_by_name: string | null;
  breaches: PolicyBreach[];
  monthly_value: number;
  net_margin: number;
}

export function ApprovalsPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [rows, setRows] = useState<ApprovalRow[]>([]);
  const [filter, setFilter] = useState<"pending" | "approved" | "rejected" | "all">("pending");
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    api
      .get<{ approvals: ApprovalRow[] }>(`/approvals?decision=${filter}`)
      .then((r) => setRows(r.approvals))
      .catch((e) => toast(e.message, "error"))
      .finally(() => setLoading(false));
  }, [filter, toast]);

  useEffect(load, [load]);

  const pendingValue = rows
    .filter((r) => r.decision === "pending")
    .reduce((s, r) => s + r.monthly_value, 0);

  return (
    <main className="hk-main">
      <div className="hk-page-head">
        <div>
          <h1>Persetujuan harga</h1>
          <p>
            Quotation yang melanggar kebijakan tertahan di sini sampai seorang manajer memutuskan.
          </p>
        </div>
        {filter === "pending" && rows.length > 0 && (
          <div className="kpi" style={{ minWidth: 200 }}>
            <div className="label">Nilai tertahan</div>
            <div className="value num">{rp(pendingValue)}</div>
            <div className="foot">{rows.length} quotation menunggu</div>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-head">
          <div className="tabs">
            {([
              ["pending", "Menunggu"],
              ["approved", "Disetujui"],
              ["rejected", "Ditolak"],
              ["all", "Semua"],
            ] as const).map(([key, label]) => (
              <button key={key} className={filter === key ? "on" : ""} onClick={() => setFilter(key)}>
                {label}
              </button>
            ))}
          </div>
          <button className="link-btn" onClick={load}>Muat ulang</button>
        </div>

        <div className="card-body">
          {loading ? (
            <div className="loading"><span className="dots"><i /><i /><i /></span> Memuat…</div>
          ) : rows.length === 0 ? (
            <div className="empty">
              <Icon name="check" size={28} />
              <h3>Tidak ada yang menunggu</h3>
              <p>Semua quotation sudah diputuskan. Antrean bersih.</p>
            </div>
          ) : (
            <ul className="list" style={{ gap: 10 }}>
              {rows.map((r) => (
                <li key={r.id}>
                  <div className="card" style={{ boxShadow: "none" }}>
                    <div className="card-head">
                      <div>
                        <strong>{r.quote_title}</strong>
                        <div className="muted small num">
                          {r.quote_number} · {r.client_name ?? "tanpa klien"} · diajukan{" "}
                          {r.requested_by_name} {fmtDateTime(r.requested_at)}
                        </div>
                      </div>
                      <div className="row">
                        <span
                          className={`badge ${
                            r.decision === "approved" ? "green" : r.decision === "rejected" ? "red" : "amber"
                          }`}
                        >
                          {r.decision === "approved" ? "Disetujui" : r.decision === "rejected" ? "Ditolak" : "Menunggu"}
                        </span>
                        <button className="btn small primary" onClick={() => navigate(`/quotes/${r.quote_id}`)}>
                          Buka dan putuskan
                        </button>
                      </div>
                    </div>
                    <div className="card-body tight">
                      <div className="row-wrap" style={{ marginBottom: 10 }}>
                        <span className="pill num">{rp(r.monthly_value)} per bulan</span>
                        <span className="pill num">Net margin {pct(r.net_margin)}</span>
                      </div>
                      <BreachList breaches={r.breaches} />
                      {r.note && (
                        <p className="muted small" style={{ marginTop: 8, marginBottom: 0 }}>
                          Catatan {r.decided_by_name}: <em>{r.note}</em>
                        </p>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </main>
  );
}
