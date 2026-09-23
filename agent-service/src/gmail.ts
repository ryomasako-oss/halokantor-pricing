/* ============================================================
   Gmail auth helpers untuk agent service.

   Pola: service account Google Workspace → buat JWT dengan scope
   gmail.send → tukar token → kirim email via users.messages.send.

   Ini versi standalone agent service; app utama punya file serupa
   di server/gmail.ts tapi skop dan konfigurasi bisa berbeda.
   ============================================================ */

import type { subtle } from "node:crypto";

export interface ServiceAccountCredentials {
  clientEmail: string;
  privateKeyPem: string;
  /** User yang di-impersonasi (biasanya noreply@domain atau user yang punya izin). */
  impersonatedUser: string;
}

const JWT_HEADER = { alg: "RS256", typ: "JWT" };
const JWT_AUD = "https://oauth2.googleapis.com/token";
const JWT_SCOPE = "https://www.googleapis.com/auth/gmail.send";
const JWT_LIFETIME_MS = 3600 * 1000;

/**
 * Buat signed JWT untuk OAuth2 client credentials flow (service account).
 */
export async function createSignedJwt(creds: ServiceAccountCredentials): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: creds.clientEmail,
    sub: creds.impersonatedUser,
    aud: JWT_AUD,
    scope: JWT_SCOPE,
    iat: now,
    exp: now + Math.floor(JWT_LIFETIME_MS / 1000),
  };

  const headerB64 = bufferToBase64Url(JSON.stringify(JWT_HEADER));
  const claimsB64 = bufferToBase64Url(JSON.stringify(claims));

  const pemClean = creds.privateKeyPem.replace(/-----BEGIN [A-Z ]* PRIVATE KEY-----/g, "")
    .replace(/-----END [A-Z ]* PRIVATE KEY-----/g, "")
    .replace(/\s/g, "");

  let der: Uint8Array;
  try {
    const binary = atob(pemClean);
    der = new Uint8Array([...binary].map((c) => c.charCodeAt(0)));
  } catch {
    throw new Error("Private key tidak valid (bukan PEM Base64)");
  }

  let cryptoKey;
  try {
    cryptoKey = await crypto.subtle.importKey(
      "pkcs8",
      der,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );
  } catch (err) {
    throw new Error(`Gagal import private key: ${(err as Error).message}`);
  }

  const sigBuf = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", cryptoKey, new TextEncoder().encode(`${headerB64}.${claimsB64}`));
  const sigB64 = bufferToBase64Url(sigBuf);

  return `${headerB64}.${claimsB64}.${sigB64}`;
}

function bufferToBase64Url(buf: BufferSource): string {
  const bytes = Uint8Array.from(buf);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Encode pesan MIME untuk dikirim via Gmail API.
 */
export function encodeMimeMessage(from: string, to: string, subject: string, html: string): string {
  const encodedSubject = encodeRFC2047Subject(subject);

  const msg = [
    `From: ${from}`,
    `To: ${to}`,
    encodedSubject,
    `Content-Type: text/html; charset="UTF-8"`,
    "MIME-Version: 1.0",
    "",
    html,
  ].join("\r\n");

  return bufferToBase64Url(new TextEncoder().encode(msg));
}

function encodeRFC2047Subject(subject: string): string {
  // If already encoded, return as-is
  if (subject.includes("=?UTF")) return subject;
  const encoded = Buffer.from(subject, "utf-8").toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `Subject: =?UTF-8?B?${encoded}?=`;
}
