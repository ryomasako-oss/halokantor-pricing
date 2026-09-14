/* ============================================================
   Authentication for the Workers runtime.

   Password hashing uses WebCrypto PBKDF2 (native to Workers, sub-ms
   CPU cost) instead of bcrypt: bcryptjs's hashSync(..., 12) measured
   at ~300ms of CPU per call in this codebase, tens of times over the
   Workers CPU-time budget for a single request. Existing bcrypt
   hashes still verify correctly (bcryptjs itself runs fine, it's only
   fast enough for a one-off verify, not routine hashing) and are
   transparently re-hashed to PBKDF2 the next time that user logs in
   — no forced password reset.

   Iteration count is capped at 100,000: Workers' WebCrypto
   implementation rejects deriveBits() calls above that (OWASP's
   general PBKDF2-SHA256 recommendation is 210,000, but that figure
   assumes a runtime without this cap).

   Sessions are a JWT (via `jose`, Workers-compatible) in an httpOnly
   cookie, same shape as the Express version.
   ============================================================ */

import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { setCookie, getCookie, deleteCookie } from "hono/cookie";
import type { Context, Next } from "hono";
import { get, run } from "../db.d1";
import { hasPermission, type Permission } from "../../shared/permissions";
import type { User } from "../../shared/types";
import type { Env } from "./env";

const COOKIE = "hk_session";
const TOKEN_TTL_SECONDS = 12 * 60 * 60;
const PBKDF2_ITERATIONS = 100_000;

function toB64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromB64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function pbkdf2(plain: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(plain),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    keyMaterial,
    256,
  );
  return new Uint8Array(bits);
}

export async function hashPassword(plain: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(plain, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toB64(salt)}$${toB64(hash)}`;
}

/**
 * Verifies a password against either a PBKDF2 hash (current scheme) or a
 * legacy bcrypt hash. When a bcrypt hash verifies, `rehash` carries a
 * PBKDF2 replacement the caller should persist.
 */
export async function verifyPassword(
  plain: string,
  stored: string,
): Promise<{ ok: boolean; rehash?: string }> {
  if (stored.startsWith("pbkdf2$")) {
    const parts = stored.split("$");
    const iterations = Number(parts[1]);
    const salt = fromB64(parts[2]);
    const expected = fromB64(parts[3]);
    const actual = await pbkdf2(plain, salt, iterations);
    return { ok: timingSafeEqual(actual, expected) };
  }
  const ok = bcrypt.compareSync(plain, stored);
  if (!ok) return { ok: false };
  return { ok: true, rehash: await hashPassword(plain) };
}

function secretKey(env: Env["Bindings"]): Uint8Array {
  const s = env.JWT_SECRET;
  if (!s || s.length < 16) {
    throw new Error("JWT_SECRET is missing or too short. Set it with `wrangler secret put JWT_SECRET`.");
  }
  return new TextEncoder().encode(s);
}

export async function issueSession(c: Context<Env>, user: User): Promise<void> {
  const token = await new SignJWT({ role: user.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(user.id))
    .setExpirationTime(`${TOKEN_TTL_SECONDS}s`)
    .sign(secretKey(c.env));
  setCookie(c, COOKIE, token, {
    httpOnly: true,
    sameSite: "Lax",
    secure: c.env.NODE_ENV === "production",
    maxAge: TOKEN_TTL_SECONDS,
    path: "/",
  });
}

export function clearSession(c: Context<Env>): void {
  deleteCookie(c, COOKIE, { path: "/" });
}

/** Resolves the session cookie to a live, active user and stores it on the context. */
export async function loadUser(c: Context<Env>, next: Next): Promise<void> {
  const token = getCookie(c, COOKIE);
  if (token) {
    try {
      const { payload } = await jwtVerify(token, secretKey(c.env));
      const user = await get<User>(
        c.env.DB,
        "SELECT id, email, name, role, active, created_at FROM users WHERE id = ? AND active = 1",
        Number(payload.sub),
      );
      if (user) c.set("user", user);
    } catch {
      /* An expired or tampered token simply leaves the request anonymous. */
    }
  }
  await next();
}

export async function requireAuth(c: Context<Env>, next: Next): Promise<Response | void> {
  if (!c.get("user")) return c.json({ error: "Silakan masuk terlebih dahulu." }, 401);
  await next();
}

/** Gate a route behind a named permission (see shared/permissions.ts). */
export function requirePermission(permission: Permission) {
  return async (c: Context<Env>, next: Next): Promise<Response | void> => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Silakan masuk terlebih dahulu." }, 401);
    if (!hasPermission(user.role, permission)) return c.json({ error: "Akses ditolak untuk peran Anda." }, 403);
    await next();
  };
}
