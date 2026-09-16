/* The client-facing document. Everything inside .print-area is what a
   browser print or PDF export reproduces; internal margin analysis sits
   outside it and is marked no-print. */

import { SCENARIOS } from "@shared/engine";
import { fmtDate, grp, pct, rp } from "@shared/format";
import type { Assumptions, EngineResult, QuoteMeta, ScenarioIndex } from "@shared/types";

export interface CompanyInfo {
  name: string;
  brand: string;
  tagline: string;
  address: string;
  phone: string;
  email: string;
  npwp: string;
  bank: string;
  logo?: string;
}

interface Props {
  engine: EngineResult;
  meta: QuoteMeta;
  assumptions: Assumptions;
  scenario: ScenarioIndex;
  company: CompanyInfo;
  clientName: string;
  clientAddress?: string;
  number: string;
  showInternal?: boolean;
  draft?: boolean;
}

export function QuotationDoc({
  engine,
  meta,
  assumptions,
  scenario,
  company,
  clientName,
  clientAddress,
  number,
  showInternal = true,
  draft,
}: Props) {
  const s = engine.scen[scenario];
  const sc = SCENARIOS[scenario];
  const ppn = s.revenue * assumptions.ppn;
  const validUntil = new Date(
    new Date(meta.date).getTime() + (meta.validity || 30) * 86400000,
  );

  return (
    <div className="quote-doc print-area" style={{ ["--c" as string]: sc.color }}>
      <div className="quote-top">
        <div>
          {company.logo ? (
            <img src={company.logo} alt={company.brand} className="quote-logo" />
          ) : (
            <div className="wordmark">{company.brand}</div>
          )}
          <div className="muted small">
            {company.name}
            {company.tagline ? `, ${company.tagline}` : ""}
          </div>
          {company.address && <div className="muted small">{company.address}</div>}
          {(company.phone || company.email) && (
            <div className="muted small">
              {[company.phone, company.email].filter(Boolean).join(" · ")}
            </div>
          )}
        </div>
        <div>
          <div className="quote-title">Penawaran Harga</div>
          {draft && (
            <div className="small right" style={{ color: "#B42318", fontWeight: 600 }}>
              Draft — belum disetujui
            </div>
          )}
        </div>
      </div>

      <div className="quote-meta">
        <div>
          <span>Kepada</span>
          <strong>{clientName}</strong>
          {clientAddress && <span>{clientAddress}</span>}
        </div>
        <div>
          <span>Nomor</span>
          <strong>{number || meta.quoteNo}</strong>
        </div>
        <div>
          <span>Tanggal</span>
          <strong>{fmtDate(meta.date)}</strong>
        </div>
        <div>
          <span>Berlaku sampai</span>
          <strong>{fmtDate(validUntil)}</strong>
        </div>
        {meta.preparedBy && (
          <div>
            <span>Disiapkan oleh</span>
            <strong>{meta.preparedBy}</strong>
          </div>
        )}
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>No</th>
              <th className="l">Item</th>
              <th>Satuan</th>
              <th>Qty/bln</th>
              <th>Harga satuan</th>
              <th>Total per bulan</th>
            </tr>
          </thead>
          <tbody>
            {engine.rows.map((r) => (
              <tr key={r.id}>
                <td className="c">{r.lineNo}</td>
                <td className="l">
                  {r.name}
                  {r.code && <div className="muted small">{r.code}</div>}
                </td>
                <td className="c">{r.uom}</td>
                <td className="num">{grp(r.qty)}</td>
                <td className="num">
                  <strong>{grp(r.prices[scenario])}</strong>
                </td>
                <td className="num">{grp(r.prices[scenario] * r.qty)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="quote-totals">
        <div>
          <span>Subtotal per bulan</span>
          <span className="num">{rp(s.revenue)}</span>
        </div>
        <div>
          <span>PPN {pct(assumptions.ppn, 0)}</span>
          <span className="num">{rp(ppn)}</span>
        </div>
        <div className="grand">
          <span>Total per bulan</span>
          <span className="num">{rp(s.revenue + ppn)}</span>
        </div>
        <div>
          <span>Nilai kontrak {assumptions.months} bulan (belum PPN)</span>
          <span className="num">{rp(s.annual)}</span>
        </div>
      </div>

      <p className="small muted">
        Harga dalam Rupiah per satuan dan belum termasuk PPN. Pembayaran {meta.payment}.
        Pengiriman {meta.delivery}. Penawaran berlaku {meta.validity} hari sejak tanggal di atas.
        {company.bank ? ` Pembayaran ke ${company.bank}.` : ""}
        {company.npwp ? ` NPWP ${company.npwp}.` : ""}
      </p>
      {meta.notes && <p className="small">{meta.notes}</p>}

      {showInternal && (
        <div className="internal no-print">
          <strong>Analisis internal — jangan dikirim ke klien.</strong> Skenario {sc.key} {sc.name}.
          Net margin {pct(s.margin)}, profit {rp(s.profit)} per bulan, klien hemat{" "}
          {pct(s.savingsPct)} dari RRP, {s.atCeiling} dari {engine.rows.length} item berada di harga
          plafon{s.belowCost ? `, ${s.belowCost} item di bawah modal` : ""}.
        </div>
      )}
    </div>
  );
}
