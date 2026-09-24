/* Generates the client-facing quotation as a real PDF file, so a rep can
   attach it to an email without going through the browser print dialog. */

import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { SCENARIOS } from "@shared/engine";
import { fmtDate, grp, pct } from "@shared/format";
import type { Assumptions, EngineResult, QuoteMeta, ScenarioIndex } from "@shared/types";
import type { CompanyInfo } from "../components/QuotationDoc";

interface Input {
  engine: EngineResult;
  meta: QuoteMeta;
  assumptions: Assumptions;
  scenario: ScenarioIndex;
  company: CompanyInfo;
  clientName: string;
  clientAddress?: string;
  number: string;
  draft: boolean;
}

const NAVY: [number, number, number] = [31, 58, 95];
const MUTED: [number, number, number] = [102, 115, 132];

export function quotationPdf(input: Input): jsPDF {
  const { engine, meta, assumptions, scenario, company, clientName, number, draft } = input;
  const s = engine.scen[scenario];
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const M = 40;

  let headerBottom = 56;
  if (company.logo) {
    const format = company.logo.startsWith("data:image/png") ? "PNG" : company.logo.startsWith("data:image/webp") ? "WEBP" : "JPEG";
    const { width, height } = doc.getImageProperties(company.logo);
    const maxW = 140;
    const maxH = 40;
    const scale = Math.min(maxW / width, maxH / height, 1);
    const w = width * scale;
    const h = height * scale;
    doc.addImage(company.logo, format, M, 24, w, h);
    headerBottom = 24 + h;
  } else {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(20);
    doc.setTextColor(...NAVY);
    doc.text(company.brand, M, 56);
  }

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...MUTED);
  const companyLines = [
    company.name + (company.tagline ? `, ${company.tagline}` : ""),
    company.address,
    [company.phone, company.email].filter(Boolean).join(" · "),
  ].filter(Boolean);
  companyLines.forEach((line, i) => doc.text(line, M, headerBottom + 14 + i * 11));

  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(30, 37, 48);
  doc.text("PENAWARAN HARGA", W - M, 56, { align: "right" });
  if (draft) {
    doc.setFontSize(9);
    doc.setTextColor(180, 35, 24);
    doc.text("DRAFT — belum disetujui", W - M, 70, { align: "right" });
  }

  const top = headerBottom + 14 + companyLines.length * 11 + 14;
  doc.setDrawColor(220, 226, 232);
  doc.line(M, top, W - M, top);

  const validUntil = new Date(new Date(meta.date).getTime() + (meta.validity || 30) * 86400000);
  autoTable(doc, {
    startY: top + 12,
    theme: "plain",
    styles: { fontSize: 9, cellPadding: 2 },
    columnStyles: {
      0: { cellWidth: 78, textColor: MUTED },
      1: { cellWidth: 180, fontStyle: "bold" },
      2: { cellWidth: 78, textColor: MUTED },
      3: { fontStyle: "bold" },
    },
    body: [
      ["Kepada", clientName, "Nomor", number || meta.quoteNo],
      ["", input.clientAddress || "", "Tanggal", fmtDate(meta.date)],
      ["", "", "Berlaku sampai", fmtDate(validUntil)],
      ["", "", "Disiapkan oleh", meta.preparedBy || ""],
    ],
  });

  autoTable(doc, {
    startY: (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 14,
    head: [["No", "Item", "Satuan", "Qty", "Harga satuan", "Total per bulan"]],
    body: engine.rows.map((r) => [
      String(r.lineNo),
      r.code ? `${r.name}\n${r.code}` : r.name,
      r.uom,
      grp(r.qty),
      grp(r.prices[scenario]),
      grp(r.prices[scenario] * r.qty),
    ]),
    styles: { fontSize: 8.5, cellPadding: 4, lineColor: [238, 241, 244], lineWidth: 0.5 },
    headStyles: { fillColor: [246, 248, 250], textColor: [27, 37, 48], fontStyle: "bold" },
    columnStyles: {
      0: { halign: "center", cellWidth: 26 },
      2: { halign: "center", cellWidth: 48 },
      3: { halign: "right", cellWidth: 58 },
      4: { halign: "right", cellWidth: 76, fontStyle: "bold" },
      5: { halign: "right", cellWidth: 84 },
    },
    margin: { left: M, right: M },
  });

  const ppn = s.revenue * assumptions.ppn;
  autoTable(doc, {
    startY: (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10,
    // Keep the totals together: a subtotal stranded alone at the foot of a
    // page reads as a mistake on a document going to a client.
    pageBreak: "avoid",
    theme: "plain",
    styles: { fontSize: 9.5, cellPadding: 3 },
    columnStyles: { 0: { halign: "right", cellWidth: 260 }, 1: { halign: "right", cellWidth: 112, fontStyle: "bold" } },
    margin: { left: W - M - 372, right: M },
    body: [
      ["Subtotal per bulan", "Rp " + grp(s.revenue)],
      [`PPN ${pct(assumptions.ppn, 0)}`, "Rp " + grp(ppn)],
      ["Total per bulan", "Rp " + grp(s.revenue + ppn)],
      [`Nilai kontrak ${assumptions.months} bulan (belum PPN)`, "Rp " + grp(s.annual)],
    ],
    didParseCell: (data) => {
      if (data.row.index === 2) data.cell.styles.fontStyle = "bold";
    },
  });

  let y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 18;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  const terms = doc.splitTextToSize(
    `Harga dalam Rupiah per satuan dan belum termasuk PPN. Pembayaran ${meta.payment}. ` +
      `Pengiriman ${meta.delivery}. Penawaran berlaku ${meta.validity} hari sejak tanggal di atas.` +
      (company.bank ? ` Pembayaran ke ${company.bank}.` : "") +
      (company.npwp ? ` NPWP ${company.npwp}.` : ""),
    W - M * 2,
  ) as string[];
  doc.text(terms, M, y);
  y += terms.length * 10;

  if (meta.notes) {
    const notes = doc.splitTextToSize(meta.notes, W - M * 2) as string[];
    doc.text(notes, M, y + 6);
    y += notes.length * 10 + 6;
  }

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    doc.text(
      `${company.name} · ${number || meta.quoteNo} · ${SCENARIOS[scenario].key}`,
      M,
      doc.internal.pageSize.getHeight() - 22,
    );
    doc.text(
      `Halaman ${i} dari ${pages}`,
      W - M,
      doc.internal.pageSize.getHeight() - 22,
      { align: "right" },
    );
  }
  return doc;
}

export function downloadQuotationPdf(input: Input): void {
  const safe = (input.number || input.meta.quoteNo || "quotation").replace(/[^\w-]+/g, "-");
  quotationPdf(input).save(`${safe}.pdf`);
}
