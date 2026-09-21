import { describe, expect, it } from "vitest";
import { createSignedJwt, encodeMimeMessage } from "./gmail.js";
import type { ServiceAccountCredentials } from "./gmail.js";

function base64UrlToBytes(s: string): Uint8Array {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(s.length + ((4 - (s.length % 4)) % 4), "=");
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

function base64UrlToJson(s: string): unknown {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(s)));
}

async function generateTestKeyPair() {
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const pkcs8 = await crypto.subtle.exportKey("pkcs8", pair.privateKey);
  const der = new Uint8Array(pkcs8);
  let binary = "";
  for (const b of der) binary += String.fromCharCode(b);
  const b64 = btoa(binary);
  const lines = b64.match(/.{1,64}/g) ?? [];
  const pem = `-----BEGIN PRIVATE KEY-----\n${lines.join("\n")}\n-----END PRIVATE KEY-----\n`;
  return { publicKey: pair.publicKey, pem };
}

describe("createSignedJwt", () => {
  it("produces a three-part JWT with the expected header and claims", async () => {
    const { pem } = await generateTestKeyPair();
    const creds: ServiceAccountCredentials = {
      clientEmail: "svc@test-project.iam.gserviceaccount.com",
      privateKeyPem: pem,
      impersonatedUser: "noreply@salvator.co.id",
    };
    const jwt = await createSignedJwt(creds);
    const parts = jwt.split(".");
    expect(parts).toHaveLength(3);

    const header = base64UrlToJson(parts[0]) as { alg: string; typ: string };
    expect(header).toEqual({ alg: "RS256", typ: "JWT" });

    const claims = base64UrlToJson(parts[1]) as Record<string, unknown>;
    expect(claims.iss).toBe(creds.clientEmail);
    expect(claims.sub).toBe(creds.impersonatedUser);
    expect(claims.scope).toBe("https://www.googleapis.com/auth/gmail.send");
    expect(claims.aud).toBe("https://oauth2.googleapis.com/token");
    expect(typeof claims.iat).toBe("number");
    expect((claims.exp as number) - (claims.iat as number)).toBe(3600);
  });

  it("produces a signature that verifies against the matching public key", async () => {
    const { publicKey, pem } = await generateTestKeyPair();
    const creds: ServiceAccountCredentials = {
      clientEmail: "svc@test-project.iam.gserviceaccount.com",
      privateKeyPem: pem,
      impersonatedUser: "noreply@salvator.co.id",
    };
    const jwt = await createSignedJwt(creds);
    const [headerB64, claimsB64, sigB64] = jwt.split(".");
    const signedInput = new TextEncoder().encode(`${headerB64}.${claimsB64}`);
    const signature = base64UrlToBytes(sigB64);

    const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", publicKey, signature, signedInput);
    expect(valid).toBe(true);
  });

  it("unescapes literal \\n sequences in the PEM before importing", async () => {
    const { pem } = await generateTestKeyPair();
    const escaped = pem.replace(/\n/g, "\\n");
    const creds: ServiceAccountCredentials = {
      clientEmail: "svc@test-project.iam.gserviceaccount.com",
      privateKeyPem: escaped,
      impersonatedUser: "noreply@salvator.co.id",
    };
    // Would throw during crypto.subtle.importKey if the escaped \n survived into the DER bytes.
    await expect(createSignedJwt(creds)).resolves.toEqual(expect.any(String));
  });

  it("rejects a malformed private key instead of hanging or returning garbage", async () => {
    const creds: ServiceAccountCredentials = {
      clientEmail: "svc@test-project.iam.gserviceaccount.com",
      privateKeyPem: "-----BEGIN PRIVATE KEY-----\nnot-real-key-data\n-----END PRIVATE KEY-----",
      impersonatedUser: "noreply@salvator.co.id",
    };
    await expect(createSignedJwt(creds)).rejects.toBeTruthy();
  });
});

describe("encodeMimeMessage", () => {
  it("includes From/To/Subject/Content-Type headers and the HTML body", () => {
    const msg = encodeMimeMessage("noreply@salvator.co.id", "rep@salvator.co.id", "Menunggu persetujuan", "<p>Hi</p>");
    expect(msg).toContain("From: noreply@salvator.co.id");
    expect(msg).toContain("To: rep@salvator.co.id");
    expect(msg).toContain('Content-Type: text/html; charset="UTF-8"');
    expect(msg).toContain("MIME-Version: 1.0");
    expect(msg).toContain("<p>Hi</p>");
  });

  it("RFC 2047-encodes a non-ASCII subject so it round-trips as UTF-8", () => {
    const subject = "Persetujuan quotation — café ☕";
    const msg = encodeMimeMessage("noreply@salvator.co.id", "rep@salvator.co.id", subject, "<p>Hi</p>");
    const match = msg.match(/Subject: =\?UTF-8\?B\?(.+)\?=/);
    expect(match).not.toBeNull();
    const decoded = new TextDecoder().decode(Uint8Array.from(atob(match![1]), (c) => c.charCodeAt(0)));
    expect(decoded).toBe(subject);
  });

  it("separates headers from the body with exactly one blank line", () => {
    const msg = encodeMimeMessage("a@x.com", "b@x.com", "S", "<p>B</p>");
    const [headerBlock, body] = msg.split("\r\n\r\n");
    expect(headerBlock.split("\r\n")).toHaveLength(5);
    expect(body).toBe("<p>B</p>");
  });
});
