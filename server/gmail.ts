/* ============================================================
   Send email via the Gmail API, authenticated as a Workspace
   service account with domain-wide delegation (JWT Bearer flow —
   RFC 7523). Pure WebCrypto + fetch, no Node-only APIs and no SDK,
   so this one file runs unmodified from both the Express backend
   (server/notify.ts) and the Cloudflare Worker (server/worker/notify.ts).
   ============================================================ */

export interface ServiceAccountCredentials {
  /** The service account's client_email, e.g. name@project.iam.gserviceaccount.com */
  clientEmail: string;
  /** The service account's PKCS8 PEM private_key. Literal "\n" sequences are unescaped. */
  privateKeyPem: string;
  /** Real Workspace mailbox to send as, e.g. noreply@salvator.co.id. Must be authorized
   *  for the gmail.send scope via domain-wide delegation in the Workspace admin console. */
  impersonatedUser: string;
}

const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function stringToBase64Url(s: string): string {
  return toBase64Url(new TextEncoder().encode(s));
}

async function importPrivateKey(pem: string) {
  const normalized = pem.replace(/\\n/g, "\n");
  const body = normalized
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
}

/** Builds and signs the RS256 JWT assertion Google exchanges for an access token. */
export async function createSignedJwt(creds: ServiceAccountCredentials): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: creds.clientEmail,
    sub: creds.impersonatedUser,
    scope: GMAIL_SEND_SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${stringToBase64Url(JSON.stringify(header))}.${stringToBase64Url(JSON.stringify(claims))}`;
  const key = await importPrivateKey(creds.privateKeyPem);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  return `${unsigned}.${toBase64Url(new Uint8Array(signature))}`;
}

async function fetchAccessToken(creds: ServiceAccountCredentials): Promise<string> {
  const assertion = await createSignedJwt(creds);
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!res.ok) throw new Error(`gmail token exchange failed: ${res.status} ${await res.text().catch(() => "")}`);
  const json = (await res.json()) as { access_token: string };
  return json.access_token;
}

/** Encodes an RFC 2822 message with a UTF-8 subject and HTML body. */
export function encodeMimeMessage(from: string, to: string, subject: string, html: string): string {
  const encodedSubject = `=?UTF-8?B?${toBase64(new TextEncoder().encode(subject))}?=`;
  return [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodedSubject}`,
    "MIME-Version: 1.0",
    'Content-Type: text/html; charset="UTF-8"',
    "",
    html,
  ].join("\r\n");
}

/** Sends one HTML email as `creds.impersonatedUser`. Throws on any failure — callers own retry/no-op policy. */
export async function sendGmail(creds: ServiceAccountCredentials, to: string, subject: string, html: string): Promise<void> {
  const token = await fetchAccessToken(creds);
  const raw = stringToBase64Url(encodeMimeMessage(creds.impersonatedUser, to, subject, html));
  const res = await fetch(SEND_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ raw }),
  });
  if (!res.ok) throw new Error(`gmail send failed: ${res.status} ${await res.text().catch(() => "")}`);
}
