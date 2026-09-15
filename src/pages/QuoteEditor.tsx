import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { computeEngine, SCENARIOS } from "@shared/engine";
import { evaluatePolicy, isWithinPolicy } from "@shared/policy";
import { fmtDateTime, pct, rp, uid } from "@shared/format";
import type {
  Client,
  PolicyBreach,
  PricingPolicy,
  Quote,
  QuoteItem,
  QuoteSnapshot,
  Region,
  ScenarioIndex,
} from "@shared/types";
import { Icon } from "../components/Icon";
import { Modal, ConfirmModal } from "../components/Modal";
import { Rich } from "../components/Rich";
import { ItemsTable } from "../components/ItemsTable";
import { QuotationDoc, type CompanyInfo } from "../components/QuotationDoc";
import { CatalogPicker } from "../components/CatalogPicker";
import { ImportDialog } from "../components/ImportDialog";
import { AssistantPanel, applyActions, type AssistantAction } from "../components/AssistantPanel";
import {
  BreachList, CompareTable, DeliveryTable, LEVERS, Lever, ScenarioCards, StatusChip,
} from "../components/pricing";

interface Revision {
  id: number;
  rev_no: number;
  note: string;
  created_at: string;
  created_by_name: string;
}
interface ApprovalRow {
  id: number;
  decision: string;
  note: string | null;
  requested_at: string;
  decided_at: string | null;
  requested_by_name: string;
  decided_by_name: string | null;
  breaches: PolicyBreach[];
  monthly_value: number;
  net_margin: number;
}
interface AuditRow {
  id: number;
  actor_name: string;
  action: string;
  detail: string;
  created_at: string;
}
interface QuoteDetail {
  quote: Quote;
  revisions: Revision[];
  approvals: ApprovalRow[];
  audit: AuditRow[];
  canEdit: boolean;
}

const ACTION_LABEL: Record<string, string> = {
  created: "Dibuat",
  submitted: "Diajukan untuk persetujuan",
  auto_approved: "Disetujui otomatis (dalam kebijakan)",
  approved: "Disetujui",
  rejected: "Ditolak",
  reopened: "Dibuka kembali sebagai revisi baru",
  restored: "Dipulihkan dari revisi",
  revision_saved: "Snapshot revisi disimpan",
  status_sent: "Ditandai terkirim ke klien",
  status_won: "Ditandai menang",
  status_lost: "Ditandai kalah",
  deleted: "Dihapus",
};

export function QuoteEditorPage() {
  const { id } = useParams();
  const quoteId = Number(id);
  const navigate = useNavigate();
  const toast = useToast();
  const { user, can } = useAuth();

  const [detail, setDetail] = useState<QuoteDetail | null>(null);
  const [snapshot, setSnapshot] = useState<QuoteSnapshot | null>(null);
  const [policy, setPolicy] = useState<PricingPolicy | null>(null);
  const [company, setCompany] = useState<CompanyInfo | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"items" | "assumptions" | "delivery" | "document" | "history">("items");
  const [modal, setModal] = useState<null | { kind: string; payload?: unknown }>(null);
  const saved = useRef<string>("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api.get<QuoteDetail>(`/quotes/${quoteId}`);
      setDetail(d);
      const snap: QuoteSnapshot = {
        assumptions: d.quote.assumptions,
        items: d.quote.items,
        regions: d.quote.regions,
        meta: d.quote.meta,
        scenario: d.quote.scenario,
      };
      setSnapshot(snap);
      saved.current = JSON.stringify(snap);
      setDirty(false);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Gagal memuat quotation.", "error");
      navigate("/quotes");
    } finally {
      setLoading(false);
    }
  }, [quoteId, navigate, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    api
      .get<{ policy: PricingPolicy; company: CompanyInfo }>("/settings")
      .then((r) => {
        setPolicy(r.policy);
        setCompany(r.company);
      })
      .catch(() => undefined);
    api.get<{ clients: Client[] }>("/clients").then((r) => setClients(r.clients)).catch(() => undefined);
  }, []);

  // Warn before leaving with unsaved edits.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const update = useCallback((patch: Partial<QuoteSnapshot>) => {
    setSnapshot((s) => {
      if (!s) return s;
      const next = { ...s, ...patch };
      setDirty(JSON.stringify(next) !== saved.current);
      return next;
    });
  }, []);

  const engine = useMemo(
    () =>
      snapshot
        ? computeEngine(snapshot.assumptions, snapshot.items, snapshot.regions)
        : null,
    [snapshot],
  );

  const breaches = useMemo(
    () => (engine && snapshot && policy ? evaluatePolicy(engine, snapshot.scenario, policy) : []),
    [engine, snapshot, policy],
  );

  const readOnly = !detail?.canEdit;

  const save = useCallback(async () => {
    if (!snapshot || !detail) return;
    setSaving(true);
    try {
      await api.put(`/quotes/${quoteId}`, { snapshot, client_id: detail.quote.client_id });
      saved.current = JSON.stringify(snapshot);
      setDirty(false);
      toast("Tersimpan", "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Gagal menyimpan.", "error");
    } finally {
      setSaving(false);
    }
  }, [snapshot, detail, quoteId, toast]);

  // Ctrl/Cmd+S saves, the way a spreadsheet would.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (dirty && !readOnly) void save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dirty, readOnly, save]);

  if (loading || !detail || !snapshot || !engine) {
    return (
      <main className="hk-main">
        <div className="loading"><span className="dots"><i /><i /><i /></span> Memuat quotation…</div>
      </main>
    );
  }

  const quote = detail.quote;
  const clientName = quote.client_name ?? "Klien belum dipilih";
  const clientRecord = clients.find((c) => c.id === quote.client_id);
  const scenario = snapshot.scenario;

  /* ---------------- item editing ---------------- */

  const renumber = (items: QuoteItem[]) => items.map((it, i) => ({ ...it, lineNo: i + 1 }));

  const updateItem = (itemId: string, patch: Partial<QuoteItem>) =>
    update({ items: snapshot.items.map((it) => (it.id === itemId ? { ...it, ...patch } : it)) });

  const removeItem = (itemId: string) =>
    update({ items: renumber(snapshot.items.filter((it) => it.id !== itemId)) });

  const addBlank = () =>
    update({
      items: renumber([
        ...snapshot.items,
        {
          id: uid(), lineNo: 0, code: "", name: "Item baru", uom: "Pcs",
          qty: 1, cogs: 0, rrp: 0, role: "CORE", estCogs: true,
        },
      ]),
    });

  const addItems = (items: QuoteItem[]) =>
    update({ items: renumber([...snapshot.items, ...items]) });

  // Pushes one item's corrected COGS/RRP back into the shared catalog master
  // (matched by code). Explicit and per-row, so a one-off deal price never
  // silently becomes every other quote's reference price.
  const pushToCatalog = async (itemId: string) => {
    const item = snapshot.items.find((it) => it.id === itemId);
    if (!item?.code.trim()) return;
    try {
      const r = await api.post<{ inserted: number; updated: number }>("/catalog/import", {
        rows: [
          {
            code: item.code.trim(),
            name: item.name,
            uom: item.uom,
            cogs: item.cogs,
            list_price: item.rrp,
          },
        ],
        source: `quote:${quote.number}`,
        mode: "merge",
      });
      toast(
        r.updated ? `Katalog "${item.name}" diperbarui.` : `"${item.name}" ditambahkan ke katalog.`,
        "success",
      );
    } catch (e) {
      toast(e instanceof Error ? e.message : "Gagal menyimpan ke katalog.", "error");
    }
  };

  const updateRegion = (index: number, field: string, value: string | number) =>
    update({
      regions: snapshot.regions.map((r, i) =>
        i === index ? ({ ...r, [field]: value } as Region) : r,
      ),
    });

  const addRegion = () =>
    update({
      regions: [
        ...snapshot.regions,
        { id: uid(), name: "Lokasi baru", share: 0, deliveries: 1, cost: 0 },
      ],
    });

  const removeRegion = (index: number) =>
    update({ regions: snapshot.regions.filter((_, i) => i !== index) });

  /* ---------------- workflow ---------------- */

  const act = async (fn: () => Promise<unknown>, message: string) => {
    try {
      // load() below replaces the local snapshot with the server's copy -
      // save first or any unsaved edit (e.g. manual COGS/RRP) is silently lost.
      if (dirty) await save();
      await fn();
      await load();
      toast(message, "success");
      setModal(null);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Aksi gagal.", "error");
    }
  };

  const submit = async () => {
    if (dirty) await save();
    await act(async () => {
      const r = await api.post<{ autoApproved: boolean }>(`/quotes/${quoteId}/submit`);
      return r;
    }, "Quotation diajukan.");
  };

  const blocked = breaches.filter((b) => b.severity === "block");

  /* ---------------- exports ---------------- */

  const exportInput = {
    engine, meta: snapshot.meta, assumptions: snapshot.assumptions, scenario,
    number: quote.number, title: quote.title, clientName,
  };

  return (
    <main className="hk-main wide">
      <div className="hk-page-head">
        <div>
          <button
            className="link-btn"
            onClick={() => {
              if (dirty && !window.confirm("Ada perubahan yang belum disimpan. Tinggalkan halaman ini?")) return;
              navigate("/quotes");
            }}
          >
            <Icon name="back" size={14} /> Semua quotation
          </button>
          <h1 style={{ marginTop: 4 }}>{quote.title}</h1>
          <div className="status-bar" style={{ marginTop: 6 }}>
            <span className="num muted">{quote.number}</span>
            {quote.rev_no > 1 && <span className="badge grey">revisi {quote.rev_no}</span>}
            <StatusChip status={quote.status} />
            <span className="muted small">
              {clientName} · {snapshot.items.length} item · dibuat {quote.created_by_name}
            </span>
            {dirty && <span className="badge amber">Belum disimpan</span>}
          </div>
        </div>

        <div className="row-wrap">
          {!readOnly && (
            <button className="btn primary" onClick={() => void save()} disabled={!dirty || saving}>
              {saving ? "Menyimpan…" : dirty ? "Simpan" : "Tersimpan"}
            </button>
          )}
          <button className="btn" onClick={() => setModal({ kind: "export" })}>
            <Icon name="download" size={15} /> Ekspor
          </button>
          <WorkflowButtons
            quote={quote}
            canManage={can("decide_quotes")}
            isOwner={quote.created_by === user?.id}
            blocked={blocked.length}
            onSubmit={() => setModal({ kind: "submit" })}
            onDecide={() => setModal({ kind: "decide" })}
            onReopen={() => setModal({ kind: "reopen" })}
            onStatus={(s) => void act(() => api.post(`/quotes/${quoteId}/status`, { status: s }), "Status diperbarui.")}
          />
        </div>
      </div>

      {quote.status === "rejected" && quote.decision_note && (
        <p className="notice error" style={{ marginBottom: 12 }}>
          <strong>Ditolak{quote.approved_by_name ? ` oleh ${quote.approved_by_name}` : ""}:</strong>{" "}
          {quote.decision_note} — buka kembali sebagai revisi baru untuk memperbaikinya.
        </p>
      )}
      {readOnly && quote.status !== "rejected" && (
        <p className="notice info" style={{ marginBottom: 12 }}>
          <Icon name="shield" size={13} /> Quotation berstatus{" "}
          <strong>{quote.status}</strong> terkunci agar angka yang sudah disetujui tidak berubah
          diam-diam. Gunakan <strong>Buka revisi baru</strong> untuk mengubahnya.
        </p>
      )}

      <div className="editor">
        <div className="editor-main">
          <div className="card">
            <div className="card-head">
              <div className="tabs">
                {([
                  ["items", "Item"],
                  ["assumptions", "Asumsi"],
                  ["delivery", "Logistik"],
                  ["document", "Dokumen"],
                  ["history", "Riwayat"],
                ] as const).map(([key, label]) => (
                  <button key={key} className={tab === key ? "on" : ""} onClick={() => setTab(key)}>
                    {label}
                  </button>
                ))}
              </div>
              {tab === "items" && !readOnly && (
                <button className="btn small" onClick={() => setModal({ kind: "import" })}>
                  <Icon name="upload" size={14} /> Impor daftar klien
                </button>
              )}
            </div>

            <div className="card-body">
              {tab === "items" && (
                <ItemsTable
                  engine={engine}
                  scenario={scenario}
                  readOnly={readOnly}
                  onUpdate={updateItem}
                  onRemove={removeItem}
                  onAdd={addBlank}
                  onOpenCatalog={() => setModal({ kind: "catalog" })}
                  onPushToCatalog={can("edit_catalog") ? pushToCatalog : undefined}
                />
              )}

              {tab === "assumptions" && (
                <div className="col" style={{ gap: 18 }}>
                  <div className="lever-grid">
                    {LEVERS.map((l) => (
                      <Lever
                        key={l.key}
                        lever={l}
                        value={snapshot.assumptions[l.key] as number}
                        disabled={readOnly}
                        onChange={(v) =>
                          update({ assumptions: { ...snapshot.assumptions, [l.key]: v } })
                        }
                      />
                    ))}
                  </div>
                  <div className="field-grid">
                    <label className="field">
                      <span>Pembulatan harga (Rp)</span>
                      <input
                        className="input" type="number" min="1" disabled={readOnly}
                        value={snapshot.assumptions.step}
                        onChange={(e) =>
                          update({ assumptions: { ...snapshot.assumptions, step: Math.max(1, Number(e.target.value)) } })
                        }
                      />
                    </label>
                    <label className="field">
                      <span>PPN (%)</span>
                      <input
                        className="input" type="number" min="0" max="20" step="0.5" disabled={readOnly}
                        value={+(snapshot.assumptions.ppn * 100).toFixed(2)}
                        onChange={(e) =>
                          update({ assumptions: { ...snapshot.assumptions, ppn: Math.max(0, Number(e.target.value)) / 100 } })
                        }
                      />
                    </label>
                    <label className="field">
                      <span>Durasi kontrak (bulan)</span>
                      <input
                        className="input" type="number" min="1" max="60" disabled={readOnly}
                        value={snapshot.assumptions.months}
                        onChange={(e) =>
                          update({ assumptions: { ...snapshot.assumptions, months: Math.max(1, Number(e.target.value)) } })
                        }
                      />
                    </label>
                  </div>
                </div>
              )}

              {tab === "delivery" && (
                <div>
                  <label className="toggle" style={{ marginBottom: 12 }}>
                    <input
                      type="checkbox"
                      disabled={readOnly}
                      checked={snapshot.assumptions.includeLogistics}
                      onChange={(e) =>
                        update({ assumptions: { ...snapshot.assumptions, includeLogistics: e.target.checked } })
                      }
                    />
                    <span>
                      Masukkan biaya logistik ke harga per unit (blended {pct(engine.blended)})
                    </span>
                  </label>
                  <DeliveryTable
                    regions={engine.regions}
                    shareTotal={engine.shareTotal}
                    onChange={updateRegion}
                    onAdd={addRegion}
                    onRemove={removeRegion}
                    readOnly={readOnly}
                  />
                </div>
              )}

              {tab === "document" && (
                <div className="col" style={{ gap: 14 }}>
                  <div className="field-grid no-print">
                    <label className="field">
                      <span>Klien</span>
                      <select
                        className="select"
                        disabled={readOnly}
                        value={quote.client_id ?? ""}
                        onChange={async (e) => {
                          const value = e.target.value === "" ? null : Number(e.target.value);
                          setDetail({ ...detail, quote: { ...quote, client_id: value } });
                          try {
                            await api.put(`/quotes/${quoteId}`, { snapshot, client_id: value });
                            await load();
                          } catch (err) {
                            toast(err instanceof Error ? err.message : "Gagal mengubah klien.", "error");
                          }
                        }}
                      >
                        <option value="">Tanpa klien</option>
                        {clients.map((c) => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      <span>Tanggal</span>
                      <input
                        className="input" type="date" disabled={readOnly}
                        value={snapshot.meta.date}
                        onChange={(e) => update({ meta: { ...snapshot.meta, date: e.target.value } })}
                      />
                    </label>
                    <label className="field">
                      <span>Masa berlaku (hari)</span>
                      <input
                        className="input" type="number" min="1" max="365" disabled={readOnly}
                        value={snapshot.meta.validity}
                        onChange={(e) =>
                          update({ meta: { ...snapshot.meta, validity: Math.max(1, Number(e.target.value)) } })
                        }
                      />
                    </label>
                    <label className="field">
                      <span>Termin pembayaran</span>
                      <input
                        className="input" disabled={readOnly}
                        value={snapshot.meta.payment}
                        onChange={(e) => update({ meta: { ...snapshot.meta, payment: e.target.value } })}
                      />
                    </label>
                    <label className="field">
                      <span>Pengiriman</span>
                      <input
                        className="input" disabled={readOnly}
                        value={snapshot.meta.delivery}
                        onChange={(e) => update({ meta: { ...snapshot.meta, delivery: e.target.value } })}
                      />
                    </label>
                  </div>
                  <label className="field no-print">
                    <span>Catatan tambahan di penawaran</span>
                    <textarea
                      className="textarea" rows={2} disabled={readOnly}
                      value={snapshot.meta.notes}
                      onChange={(e) => update({ meta: { ...snapshot.meta, notes: e.target.value } })}
                    />
                  </label>

                  {company && (
                    <QuotationDoc
                      engine={engine}
                      meta={snapshot.meta}
                      assumptions={snapshot.assumptions}
                      scenario={scenario}
                      company={company}
                      clientName={clientName}
                      clientAddress={clientRecord?.address}
                      number={quote.number}
                      draft={quote.status !== "approved" && quote.status !== "sent" && quote.status !== "won"}
                    />
                  )}
                </div>
              )}

              {tab === "history" && (
                <HistoryTab
                  detail={detail}
                  onRestore={(revisionId) =>
                    void act(
                      () => api.post(`/quotes/${quoteId}/restore/${revisionId}`),
                      "Revisi dipulihkan.",
                    )
                  }
                  canRestore={!readOnly}
                />
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-head"><h2>Perbandingan skenario</h2></div>
            <div className="card-body"><CompareTable engine={engine} /></div>
          </div>
        </div>

        <aside className="editor-side">
          <div className="card">
            <div className="card-head">
              <h2>Skenario</h2>
              <span className="muted small">Klik untuk memilih</span>
            </div>
            <div className="card-body tight">
              <ScenarioCards
                engine={engine}
                selected={scenario}
                onSelect={readOnly ? undefined : (i: ScenarioIndex) => update({ scenario: i })}
              />
              <p className="muted small" style={{ margin: "10px 2px 0" }}>
                {SCENARIOS[scenario].rule}
              </p>
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <h2>Kepatuhan harga</h2>
              {blocked.length > 0 ? (
                <span className="badge red">{blocked.length} blokir</span>
              ) : (
                <span className="badge green">Lolos</span>
              )}
            </div>
            <div className="card-body tight">
              <BreachList breaches={breaches} />
              {policy && (
                <p className="muted small" style={{ marginTop: 10, marginBottom: 0 }}>
                  Batas: net margin {pct(policy.minNetMargin)}, diskon basket {pct(policy.maxBasketDiscount)},
                  nilai wajib persetujuan {rp(policy.approvalValueThreshold)}.
                </p>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <h2><Icon name="spark" size={14} /> Asisten harga</h2>
            </div>
            <AssistantPanel
              snapshot={snapshot}
              number={quote.number}
              title={quote.title}
              status={quote.status}
              clientName={clientName}
              readOnly={readOnly}
              onApply={(actions: AssistantAction[]) => {
                const { snapshot: next, labels } = applyActions(actions, snapshot);
                if (!labels.length) {
                  toast("Tidak ada perubahan yang bisa diterapkan.", "error");
                  return;
                }
                update(next);
              }}
            />
          </div>
        </aside>
      </div>

      {/* ---------------- modals ---------------- */}

      {modal?.kind === "catalog" && (
        <CatalogPicker
          onClose={() => setModal(null)}
          onAdd={addItems}
          existingCodes={new Set(snapshot.items.map((i) => i.code).filter(Boolean))}
        />
      )}

      {modal?.kind === "import" && (
        <ImportDialog
          title="Impor daftar item klien"
          description="Excel atau CSV berisi nama item, qty, dan plafon harga. Kalau plafon ditulis per kota, yang dipakai harga terendah."
          onClose={() => setModal(null)}
          onFile={async (file) => {
            if (
              snapshot.items.length > 0 &&
              !window.confirm(
                `Ini akan mengganti semua ${snapshot.items.length} item yang sudah ada di quotation ini ` +
                  "(termasuk COGS/RRP yang sudah kamu isi manual) dengan isi file yang baru. Lanjutkan?",
              )
            ) {
              throw new Error("Impor dibatalkan.");
            }
            // Loaded on demand: the spreadsheet parser is a large dependency.
            const { parseClientList } = await import("../import/parsers");
            const { items, report } = await parseClientList(file);
            update({ items: renumber(items) });
            return {
              report,
              summary: `${report.count} item terbaca dari sheet "${report.sheetName}". Jangan lupa simpan.`,
            };
          }}
        />
      )}

      {modal?.kind === "export" && (
        <Modal title="Ekspor quotation" onClose={() => setModal(null)}>
          <div className="list">
            <button
              className="list-row"
              onClick={async () => {
                if (!company) return;
                const { downloadQuotationPdf } = await import("../export/pdf");
                downloadQuotationPdf({
                  ...exportInput, company, clientAddress: clientRecord?.address,
                  draft: quote.status !== "approved" && quote.status !== "sent" && quote.status !== "won",
                });
                setModal(null);
              }}
            >
              <Icon name="file" />
              <span>
                <strong>PDF penawaran</strong>
                <small className="muted"> Dokumen siap kirim ke klien, tanpa angka internal.</small>
              </span>
            </button>
            <button
              className="list-row"
              onClick={async () => {
                const { downloadQuoteWorkbook } = await import("../export/xlsx");
                downloadQuoteWorkbook(exportInput);
                setModal(null);
              }}
            >
              <Icon name="table" />
              <span>
                <strong>Excel kerja</strong>
                <small className="muted"> Penawaran, analisis margin internal, perbandingan, dan asumsi.</small>
              </span>
            </button>
            <button
              className="list-row"
              onClick={() => {
                setModal(null);
                setTab("document");
                setTimeout(() => window.print(), 350);
              }}
            >
              <Icon name="print" />
              <span>
                <strong>Cetak</strong>
                <small className="muted"> Membuka dialog cetak browser untuk dokumen penawaran.</small>
              </span>
            </button>
          </div>
        </Modal>
      )}

      {modal?.kind === "submit" && (
        <Modal
          title="Ajukan quotation"
          sub={`${quote.number} · ${rp(engine.scen[scenario].revenue)} per bulan`}
          onClose={() => setModal(null)}
          footer={
            <>
              <button className="btn ghost" onClick={() => setModal(null)}>Batal</button>
              <button className="btn primary" onClick={() => void submit()}>
                {blocked.length ? "Ajukan ke manajer" : "Ajukan"}
              </button>
            </>
          }
        >
          <BreachList breaches={breaches} />
          <p className="muted small" style={{ marginTop: 12 }}>
            {blocked.length
              ? "Karena ada pelanggaran kebijakan, quotation ini wajib disetujui manajer sebelum bisa dikirim."
              : can("decide_quotes")
                ? "Semua angka di dalam kebijakan, jadi quotation langsung disetujui atas nama Anda."
                : "Semua angka di dalam kebijakan. Quotation tetap masuk antrean manajer untuk dicek."}
          </p>
        </Modal>
      )}

      {modal?.kind === "decide" && (
        <DecideModal
          quote={quote}
          breaches={breaches}
          engine={engine}
          onClose={() => setModal(null)}
          onDecide={(decision, note) =>
            void act(
              () => api.post(`/quotes/${quoteId}/decide`, { decision, note }),
              decision === "approved" ? "Quotation disetujui." : "Quotation ditolak.",
            )
          }
        />
      )}

      {modal?.kind === "reopen" && (
        <ConfirmModal
          title="Buka revisi baru"
          tone="primary"
          confirmLabel={`Buka sebagai revisi ${quote.rev_no + 1}`}
          message={
            <>
              <p>
                Versi {quote.rev_no} yang sudah diputuskan tetap tersimpan di riwayat. Quotation
                kembali ke status draft dan harus diajukan ulang setelah diubah.
              </p>
            </>
          }
          onClose={() => setModal(null)}
          onConfirm={() => void act(() => api.post(`/quotes/${quoteId}/reopen`), "Revisi baru dibuka.")}
        />
      )}
    </main>
  );
}

/* ---------------- workflow buttons ---------------- */

function WorkflowButtons({
  quote, canManage, isOwner, blocked, onSubmit, onDecide, onReopen, onStatus,
}: {
  quote: Quote;
  canManage: boolean;
  isOwner: boolean;
  blocked: number;
  onSubmit: () => void;
  onDecide: () => void;
  onReopen: () => void;
  onStatus: (s: string) => void;
}) {
  const mine = isOwner || canManage;
  switch (quote.status) {
    case "draft":
    case "rejected":
      return mine ? (
        <button className="btn success" onClick={onSubmit}>
          <Icon name="check" size={15} />
          {blocked ? "Ajukan ke manajer" : "Ajukan"}
        </button>
      ) : null;
    case "submitted":
      return canManage ? (
        <button className="btn success" onClick={onDecide}>
          <Icon name="shield" size={15} /> Putuskan
        </button>
      ) : (
        <span className="pill warn"><Icon name="clock" size={13} /> Menunggu manajer</span>
      );
    case "approved":
      return mine ? (
        <>
          <button className="btn" onClick={() => onStatus("sent")}>
            <Icon name="send" size={15} /> Tandai terkirim
          </button>
          <button className="btn ghost" onClick={onReopen}>Buka revisi baru</button>
        </>
      ) : null;
    case "sent":
      return mine ? (
        <>
          <button className="btn success" onClick={() => onStatus("won")}>Menang</button>
          <button className="btn" onClick={() => onStatus("lost")}>Kalah</button>
          <button className="btn ghost" onClick={onReopen}>Buka revisi baru</button>
        </>
      ) : null;
    default:
      return mine ? (
        <button className="btn ghost" onClick={onReopen}>Buka revisi baru</button>
      ) : null;
  }
}

/* ---------------- decision modal ---------------- */

function DecideModal({
  quote, breaches, engine, onClose, onDecide,
}: {
  quote: Quote;
  breaches: PolicyBreach[];
  engine: ReturnType<typeof computeEngine>;
  onClose: () => void;
  onDecide: (decision: "approved" | "rejected", note: string) => void;
}) {
  const [note, setNote] = useState("");
  const s = engine.scen[quote.scenario];
  const clean = isWithinPolicy(breaches);

  return (
    <Modal
      title="Putuskan quotation"
      sub={`${quote.number} · diajukan ${quote.created_by_name}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>Batal</button>
          <button
            className="btn danger"
            onClick={() => onDecide("rejected", note)}
            disabled={!note.trim()}
            title={!note.trim() ? "Penolakan wajib disertai alasan" : undefined}
          >
            Tolak
          </button>
          <button className="btn success" onClick={() => onDecide("approved", note)}>
            Setujui
          </button>
        </>
      }
    >
      <div className="kpi-grid" style={{ marginBottom: 14 }}>
        <div className="kpi">
          <div className="label">Nilai per bulan</div>
          <div className="value num">{rp(s.revenue)}</div>
        </div>
        <div className="kpi">
          <div className="label">Net margin</div>
          <div className="value num">{pct(s.margin)}</div>
        </div>
        <div className="kpi">
          <div className="label">Hemat klien</div>
          <div className="value num">{pct(s.savingsPct)}</div>
        </div>
      </div>

      <BreachList breaches={breaches} />

      <label className="field" style={{ marginTop: 14 }}>
        <span>Catatan keputusan {clean ? "(opsional)" : "(wajib jika menolak)"}</span>
        <textarea
          className="textarea"
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Misal: margin tipis tapi volume kontrak sepadan, atau minta naikkan harga item leader."
        />
      </label>
    </Modal>
  );
}

/* ---------------- history ---------------- */

function HistoryTab({
  detail, onRestore, canRestore,
}: {
  detail: QuoteDetail;
  onRestore: (revisionId: number) => void;
  canRestore: boolean;
}) {
  return (
    <div className="col" style={{ gap: 20 }}>
      <section>
        <h3 style={{ margin: "0 0 8px", fontSize: 13.5 }}>Persetujuan</h3>
        {detail.approvals.length === 0 ? (
          <p className="muted small">Belum pernah diajukan.</p>
        ) : (
          <ul className="list">
            {detail.approvals.map((a) => (
              <li key={a.id}>
                <div className="list-row" style={{ cursor: "default", alignItems: "flex-start" }}>
                  <span
                    className={`badge ${a.decision === "approved" ? "green" : a.decision === "rejected" ? "red" : "amber"}`}
                  >
                    {a.decision === "approved" ? "Disetujui" : a.decision === "rejected" ? "Ditolak" : "Menunggu"}
                  </span>
                  <span className="col" style={{ gap: 2, flex: 1 }}>
                    <span className="small">
                      Diajukan {a.requested_by_name} · {fmtDateTime(a.requested_at)}
                      {a.decided_at && ` · diputus ${a.decided_by_name} ${fmtDateTime(a.decided_at)}`}
                    </span>
                    <span className="small num muted">
                      {rp(a.monthly_value)} per bulan, margin {pct(a.net_margin)}
                      {a.breaches.length ? ` · ${a.breaches.length} catatan kebijakan` : ""}
                    </span>
                    {a.note && <span className="small"><em>{a.note}</em></span>}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 style={{ margin: "0 0 8px", fontSize: 13.5 }}>Revisi tersimpan</h3>
        <ul className="list">
          {detail.revisions.map((r) => (
            <li key={r.id}>
              <div className="list-row" style={{ cursor: "default" }}>
                <Icon name="history" size={16} />
                <span className="col" style={{ gap: 1, flex: 1 }}>
                  <strong className="small">Revisi {r.rev_no} — {r.note}</strong>
                  <span className="muted small">{r.created_by_name} · {fmtDateTime(r.created_at)}</span>
                </span>
                {canRestore && (
                  <button className="btn small ghost" onClick={() => onRestore(r.id)}>
                    Pulihkan
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3 style={{ margin: "0 0 8px", fontSize: 13.5 }}>Jejak audit</h3>
        <ul className="timeline">
          {detail.audit.map((a) => (
            <li key={a.id}>
              <span className="when">{fmtDateTime(a.created_at)}</span>
              <span>
                <strong>{a.actor_name}</strong> — {ACTION_LABEL[a.action] ?? a.action}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
