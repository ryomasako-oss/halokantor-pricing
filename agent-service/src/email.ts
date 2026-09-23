/* ============================================================
   Gmail / Google Workspace client — kirim notifikasi email via
   Gmail API dengan service account (impersonasi).

   Agent service punya file gmail.ts sendiri (berbeda dari app utama
   di server/gmail.ts); konfigurasi dan scope bisa berbeda.
   ============================================================ */

import { encodeMimeMessage, type ServiceAccountCredentials } from "./gmail.js";

const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL_SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/{user}/messages/send";

export interface GmailConfig {
  clientEmail: string;
  privateKeyPem: string;
  impersonatedUser: string;
}

export class GmailClient {
  constructor(private cfg: GmailConfig) {
    if (!cfg.clientEmail || !cfg.privateKeyPem || !cfg.impersonatedUser) {
      throw new Error("GmailConfig tidak lengkap: clientEmail, privateKeyPem, impersonatedUser wajib diisi");
    }
  }

  private accessToken: string | null = null;
  private accessTokenExpiry: number = 0;

  /**
   * Dapatkan access token OAuth2 (cached selama berlaku).
   */
  async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.accessTokenExpiry - 60_000) {
      return this.accessToken;
    }

    const jwt = await createSignedJwt(this.cfg);
    const res = await fetch(OAUTH_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: jwt,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Gmail token exchange gagal: HTTP ${res.status} — ${text.slice(0, 300)}`);
    }

    const json = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!json.access_token) throw new Error("Gmail token exchange tidak mengembalikan access_token");

    this.accessToken = json.access_token;
    this.accessTokenExpiry = Date.now() + (json.expires_in ?? 3600) * 1000 - 60_000;
    return this.accessToken;
  }

  /**
   * Kirim email HTML ke alamat tertentu.
   */
  async send(to: string, subject: string, html: string): Promise<void> {
    const token = await this.getAccessToken();

    // Encode MIME message ( From/To/Subject/Content-Type/HTML body)
    const encoded = await encodeMimeMessage(this.cfg.impersonatedUser, to, subject, html);

    const res = await fetch(GMAIL_SEND_URL.replace("{user}", this.cfg.impersonatedUser), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "message/rfc822",
      },
      body: encoded,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Gmail send gagal: HTTP ${res.status} — ${text.slice(0, 300)}`);
    }
  }
}

/**
 * Encode sebuah pesan email sederhana sebagai string MIME yang bisa
   dikirim via Gmail API's users.messages.send.
   (Mirror dari server/gmail.ts — sama persis.)
   */
export async function encodeMimeMessage(
  from: string,
  to: string,
  subject: string,
  html: string,
): Promise<string> {
  const encodedSubject = subject.includes("=\?") ? subject :
    `Subject: =?UTF-8?B?${Buffer.from(subject).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}?=`;

  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    encodedSubject,
    `Content-Type: text/html; charset="UTF-8"`,
    "MIME-Version: 1.0",
    "",
    html,
  ].join("\r\n");

  // Base64url-encode whole message (Gmail API accepts raw MIME as base64url)
  const bytes = new TextEncoder().encode(headers);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Kloning dari server/gmail.js — fungsi yang sama. */
import { createSignedJwt } from "./gmail.js";
