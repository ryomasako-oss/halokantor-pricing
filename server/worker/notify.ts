/* ============================================================
   Best-effort approval-workflow notifications: email (Resend) and
   WhatsApp (Twilio). Async D1/Workers version of server/notify.ts —
   env is passed in explicitly (Workers bindings, not process.env).
   Both channels are optional — silently no-op when their vars
   aren't configured. Never throws: a notification failure must
   never block the submit/decide transaction it's attached to.
   ============================================================ */

import type { Bindings } from "./env";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/[^\d+]/g, "");
  if (!digits) return null;
  return digits.startsWith("+") ? digits : `+${digits}`;
}

function appUrl(env: Bindings): string {
  return (env.APP_URL || "http://localhost:5173").replace(/\/$/, "");
}

async function notifyEmail(env: Bindings, to: string, subject: string, html: string): Promise<void> {
  const apiKey = env.RESEND_API_KEY;
  const from = env.RESEND_FROM_EMAIL;
  if (!apiKey || !from || !to) return;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from, to, subject, html }),
    });
    if (!res.ok) console.error("[notify] email failed:", res.status, await res.text().catch(() => ""));
  } catch (err) {
    console.error("[notify] email error:", err);
  }
}

async function notifyWhatsApp(env: Bindings, to: string, body: string): Promise<void> {
  const sid = env.TWILIO_ACCOUNT_SID;
  const token = env.TWILIO_AUTH_TOKEN;
  const from = env.TWILIO_WHATSAPP_FROM;
  const number = to ? normalizePhone(to) : null;
  if (!sid || !token || !from || !number) return;
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${sid}:${token}`)}`,
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
export async function notifyQuoteSubmitted(
  env: Bindings,
  params: {
    recipients: Recipient[];
    quoteNumber: string;
    quoteTitle: string;
    submittedBy: string;
    quoteId: number;
  },
): Promise<void> {
  const link = `${appUrl(env)}/quotes/${params.quoteId}`;
  const number = escapeHtml(params.quoteNumber);
  const title = escapeHtml(params.quoteTitle);
  const by = escapeHtml(params.submittedBy);
  const subject = `Menunggu persetujuan: ${params.quoteNumber}`;
  const html =
    `<p>${by} mengajukan quotation <strong>${number}</strong> (${title}) yang perlu persetujuan Anda.</p>` +
    `<p><a href="${link}">Buka quotation</a></p>`;
  const wa = `Quotation ${params.quoteNumber} (${params.quoteTitle}) diajukan ${params.submittedBy}, menunggu persetujuan Anda.\n${link}`;
  await Promise.all(
    params.recipients.flatMap((r) => [
      notifyEmail(env, r.email, subject, html),
      notifyWhatsApp(env, r.phone, wa),
    ]),
  );
}

/** A quote was approved or rejected — tell the rep who submitted it. */
export async function notifyQuoteDecided(
  env: Bindings,
  params: {
    recipient: Recipient;
    quoteNumber: string;
    quoteTitle: string;
    decision: "approved" | "rejected";
    decidedBy: string;
    note: string;
    quoteId: number;
  },
): Promise<void> {
  const link = `${appUrl(env)}/quotes/${params.quoteId}`;
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
  await Promise.all([
    notifyEmail(env, params.recipient.email, subject, html),
    notifyWhatsApp(env, params.recipient.phone, wa),
  ]);
}
