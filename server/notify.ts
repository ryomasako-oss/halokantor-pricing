/* ============================================================
   Best-effort approval-workflow notifications: email (Gmail API,
   Workspace service account) and WhatsApp (Twilio). Both are
   optional — silently no-op when their env vars aren't configured,
   same pattern as the AI assistant's ANTHROPIC_API_KEY gate. Never
   throws: a notification failure must never block the submit/decide
   transaction it's attached to.
   ============================================================ */

import { sendGmail } from "./gmail.js";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/[^\d+]/g, "");
  if (!digits) return null;
  return digits.startsWith("+") ? digits : `+${digits}`;
}

function appUrl(): string {
  return (process.env.APP_URL || "http://localhost:5173").replace(/\/$/, "");
}

async function notifyEmail(to: string, subject: string, html: string): Promise<void> {
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKeyPem = process.env.GOOGLE_PRIVATE_KEY;
  const impersonatedUser = process.env.GOOGLE_SEND_AS_EMAIL;
  if (!clientEmail || !privateKeyPem || !impersonatedUser || !to) return;
  try {
    await sendGmail({ clientEmail, privateKeyPem, impersonatedUser }, to, subject, html);
  } catch (err) {
    console.error("[notify] email error:", err);
  }
}

async function notifyWhatsApp(to: string, body: string): Promise<void> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_WHATSAPP_FROM;
  const number = to ? normalizePhone(to) : null;
  if (!sid || !token || !from || !number) return;
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ From: `whatsapp:${from}`, To: `whatsapp:${number}`, Body: body }),
    });
    if (!res.ok) console.error("[notify] whatsapp failed:", res.status, await res.text().catch(() => ""));
  } catch (err) {
    console.error("[notify] whatsapp error:", err);
  }
}

interface Recipient {
  name: string;
  email: string;
  phone: string;
}

/** A quote just went to "submitted" (pending) — tell everyone who can decide it. */
export async function notifyQuoteSubmitted(params: {
  recipients: Recipient[];
  quoteNumber: string;
  quoteTitle: string;
  submittedBy: string;
  quoteId: number;
}): Promise<void> {
  const link = `${appUrl()}/quotes/${params.quoteId}`;
  const number = escapeHtml(params.quoteNumber);
  const title = escapeHtml(params.quoteTitle);
  const by = escapeHtml(params.submittedBy);
  const subject = `Menunggu persetujuan: ${params.quoteNumber}`;
  const html =
    `<p>${by} mengajukan quotation <strong>${number}</strong> (${title}) yang perlu persetujuan Anda.</p>` +
    `<p><a href="${link}">Buka quotation</a></p>`;
  const wa = `Quotation ${params.quoteNumber} (${params.quoteTitle}) diajukan ${params.submittedBy}, menunggu persetujuan Anda.\n${link}`;
  await Promise.all(
    params.recipients.flatMap((r) => [notifyEmail(r.email, subject, html), notifyWhatsApp(r.phone, wa)]),
  );
}

/** A quote was approved or rejected — tell the rep who submitted it. */
export async function notifyQuoteDecided(params: {
  recipient: Recipient;
  quoteNumber: string;
  quoteTitle: string;
  decision: "approved" | "rejected";
  decidedBy: string;
  note: string;
  quoteId: number;
}): Promise<void> {
  const link = `${appUrl()}/quotes/${params.quoteId}`;
  const verb = params.decision === "approved" ? "disetujui" : "ditolak";
  const number = escapeHtml(params.quoteNumber);
  const title = escapeHtml(params.quoteTitle);
  const by = escapeHtml(params.decidedBy);
  const note = escapeHtml(params.note);
  const subject = `Quotation ${params.quoteNumber} ${verb}`;
  const html =
    `<p>Quotation <strong>${number}</strong> (${title}) telah <strong>${verb}</strong> oleh ${by}.</p>` +
    (note ? `<p>Catatan: ${note}</p>` : "") +
    `<p><a href="${link}">Buka quotation</a></p>`;
  const wa =
    `Quotation ${params.quoteNumber} (${params.quoteTitle}) ${verb} oleh ${params.decidedBy}.` +
    (params.note ? ` Catatan: ${params.note}` : "") +
    `\n${link}`;
  await Promise.all([notifyEmail(params.recipient.email, subject, html), notifyWhatsApp(params.recipient.phone, wa)]);
}

/** A quote was handed to a different user — tell the new owner. */
export async function notifyQuoteReassigned(params: {
  recipient: Recipient;
  quoteNumber: string;
  quoteTitle: string;
  reassignedBy: string;
  note: string;
  quoteId: number;
}): Promise<void> {
  const link = `${appUrl()}/quotes/${params.quoteId}`;
  const number = escapeHtml(params.quoteNumber);
  const title = escapeHtml(params.quoteTitle);
  const by = escapeHtml(params.reassignedBy);
  const note = escapeHtml(params.note);
  const subject = `Quotation ${params.quoteNumber} dialihkan ke Anda`;
  const html =
    `<p>Quotation <strong>${number}</strong> (${title}) telah dialihkan ke Anda oleh ${by}.</p>` +
    (note ? `<p>Catatan: ${note}</p>` : "") +
    `<p><a href="${link}">Buka quotation</a></p>`;
  const wa =
    `Quotation ${params.quoteNumber} (${params.quoteTitle}) dialihkan ke Anda oleh ${params.reassignedBy}.` +
    (params.note ? ` Catatan: ${params.note}` : "") +
    `\n${link}`;
  await Promise.all([notifyEmail(params.recipient.email, subject, html), notifyWhatsApp(params.recipient.phone, wa)]);
}
