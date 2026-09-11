/* ============================================================
   Authentication: bcrypt password hashes, a signed JWT carried in an
   httpOnly cookie, and role gates for the route layer.
   ============================================================ */

import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { NextFunction, Request, Response } from "express";
import { get } from "./db.js";
import type { Role, User } from "../shared/types.js";

const COOKIE = "hk_session";
const TOKEN_TTL = "12h";

function secret(): string {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 16) {
    throw new Error(
      "JWT_SECRET is missing or too short. Set it in .env (openssl rand -hex 32).",
    );
  }
  return s;
}

export const hashPassword = (plain: string): string => bcrypt.hashSync(plain, 12);
export const verifyPassword = (plain: string, hash: string): boolean =>
  bcrypt.compareSync(plain, hash);

export function issueSession(res: Response, user: User): void {
  const token = jwt.sign({ sub: String(user.id), role: user.role }, secret(), {
    expiresIn: TOKEN_TTL,
  });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 12 * 60 * 60 * 1000,
    path: "/",
  });
}

export function clearSession(res: Response): void {
  res.clearCookie(COOKIE, { path: "/" });
}

export interface AuthedRequest extends Request {
  user?: User;
}

/** Resolves the session cookie to a live, active user. */
export function loadUser(req: AuthedRequest, _res: Response, next: NextFunction): void {
  const token = req.cookies?.[COOKIE];
  if (!token) return next();
  try {
    const payload = jwt.verify(token, secret()) as { sub: string };
    const user = get<User>(
      "SELECT id, email, name, role, active, created_at FROM users WHERE id = ? AND active = 1",
      Number(payload.sub),
    );
    if (user) req.user = user;
  } catch {
    /* An expired or tampered token simply leaves the request anonymous. */
  }
  next();
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: "Silakan masuk terlebih dahulu." });
    return;
  }
  next();
}

const RANK: Record<Role, number> = { rep: 1, manager: 2, admin: 3 };

/** Gate a route at a minimum role. Admin outranks manager outranks rep. */
export function requireRole(min: Role) {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: "Silakan masuk terlebih dahulu." });
      return;
    }
    if (RANK[req.user.role] < RANK[min]) {
      res.status(403).json({ error: "Akses ditolak untuk peran Anda." });
      return;
    }
    next();
  };
}

export const atLeast = (role: Role, min: Role): boolean => RANK[role] >= RANK[min];
