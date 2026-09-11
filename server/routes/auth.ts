import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { all, get, run } from "../db.js";
import { audit } from "../audit.js";
import {
  type AuthedRequest,
  clearSession,
  hashPassword,
  issueSession,
  requireAuth,
  requireRole,
  verifyPassword,
} from "../auth.js";
import type { User } from "../../shared/types.js";

export const authRouter = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Terlalu banyak percobaan masuk. Coba lagi dalam 15 menit." },
});

authRouter.post("/login", loginLimiter, (req, res) => {
  const parsed = z
    .object({ email: z.string().email(), password: z.string().min(1).max(200) })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Email atau kata sandi tidak valid." });
    return;
  }
  const row = get<User & { password_hash: string }>(
    "SELECT * FROM users WHERE lower(email) = lower(?)",
    parsed.data.email,
  );
  // Same message either way, so the form cannot be used to enumerate accounts.
  if (!row || !row.active || !verifyPassword(parsed.data.password, row.password_hash)) {
    res.status(401).json({ error: "Email atau kata sandi salah." });
    return;
  }
  const user: User = {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    active: row.active,
    created_at: row.created_at,
  };
  issueSession(res, user);
  audit(user.id, "user", user.id, "login");
  res.json({ user });
});

authRouter.post("/logout", (req: AuthedRequest, res) => {
  if (req.user) audit(req.user.id, "user", req.user.id, "logout");
  clearSession(res);
  res.json({ ok: true });
});

authRouter.get("/me", (req: AuthedRequest, res) => {
  res.json({ user: req.user ?? null });
});

authRouter.post("/password", requireAuth, (req: AuthedRequest, res) => {
  const parsed = z
    .object({ current: z.string().min(1), next: z.string().min(8).max(200) })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Kata sandi baru minimal 8 karakter." });
    return;
  }
  const row = get<{ password_hash: string }>(
    "SELECT password_hash FROM users WHERE id = ?",
    req.user!.id,
  );
  if (!row || !verifyPassword(parsed.data.current, row.password_hash)) {
    res.status(401).json({ error: "Kata sandi saat ini salah." });
    return;
  }
  run("UPDATE users SET password_hash = ? WHERE id = ?", hashPassword(parsed.data.next), req.user!.id);
  audit(req.user!.id, "user", req.user!.id, "password_changed");
  res.json({ ok: true });
});

/* ---------------- user administration ---------------- */

authRouter.get("/users", requireRole("admin"), (_req, res) => {
  res.json({
    users: all<User>(
      "SELECT id, email, name, role, active, created_at FROM users ORDER BY name",
    ),
  });
});

authRouter.post("/users", requireRole("admin"), (req: AuthedRequest, res) => {
  const parsed = z
    .object({
      email: z.string().email(),
      name: z.string().min(1).max(120),
      password: z.string().min(8).max(200),
      role: z.enum(["rep", "manager", "admin"]),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Data pengguna tidak lengkap. Kata sandi minimal 8 karakter." });
    return;
  }
  const exists = get("SELECT id FROM users WHERE lower(email) = lower(?)", parsed.data.email);
  if (exists) {
    res.status(409).json({ error: "Email itu sudah terdaftar." });
    return;
  }
  const info = run(
    "INSERT INTO users(email, name, password_hash, role) VALUES(?, ?, ?, ?)",
    parsed.data.email.toLowerCase(),
    parsed.data.name,
    hashPassword(parsed.data.password),
    parsed.data.role,
  );
  const id = Number(info.lastInsertRowid);
  audit(req.user!.id, "user", id, "created", { email: parsed.data.email, role: parsed.data.role });
  res.status(201).json({
    user: get<User>("SELECT id, email, name, role, active, created_at FROM users WHERE id = ?", id),
  });
});

authRouter.patch("/users/:id", requireRole("admin"), (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const parsed = z
    .object({
      name: z.string().min(1).max(120).optional(),
      role: z.enum(["rep", "manager", "admin"]).optional(),
      active: z.boolean().optional(),
      password: z.string().min(8).max(200).optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Perubahan tidak valid." });
    return;
  }
  const target = get<User>("SELECT * FROM users WHERE id = ?", id);
  if (!target) {
    res.status(404).json({ error: "Pengguna tidak ditemukan." });
    return;
  }
  // Guard against an admin locking themselves, and possibly everyone, out.
  if (id === req.user!.id && (parsed.data.active === false || parsed.data.role === "rep")) {
    res.status(400).json({ error: "Anda tidak bisa menurunkan atau menonaktifkan akun sendiri." });
    return;
  }
  const d = parsed.data;
  if (d.name !== undefined) run("UPDATE users SET name = ? WHERE id = ?", d.name, id);
  if (d.role !== undefined) run("UPDATE users SET role = ? WHERE id = ?", d.role, id);
  if (d.active !== undefined) run("UPDATE users SET active = ? WHERE id = ?", d.active ? 1 : 0, id);
  if (d.password !== undefined)
    run("UPDATE users SET password_hash = ? WHERE id = ?", hashPassword(d.password), id);
  audit(req.user!.id, "user", id, "updated", { ...d, password: d.password ? "(reset)" : undefined });
  res.json({
    user: get<User>("SELECT id, email, name, role, active, created_at FROM users WHERE id = ?", id),
  });
});
