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
  requirePermission,
  verifyPassword,
} from "../auth.js";
import { hasPermission, rolesWith } from "../../shared/permissions.js";
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

authRouter.post("/forgot-password", loginLimiter, (req, res) => {
  const parsed = z.object({ email: z.string().email() }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Masukkan email yang valid." });
    return;
  }
  const account = get<{ id: number }>(
    "SELECT id FROM users WHERE lower(email) = lower(?) AND active = 1",
    parsed.data.email,
  );
  // Only queue a request for a real, active account — but the response is
  // identical either way, so the form can't be used to enumerate accounts.
  if (account) {
    run("INSERT INTO password_reset_requests(email) VALUES(?)", parsed.data.email.toLowerCase());
  }
  res.json({ ok: true });
});

authRouter.get("/password-reset-requests", requirePermission("manage_users"), (_req, res) => {
  res.json({
    requests: all(
      "SELECT id, email, created_at FROM password_reset_requests ORDER BY created_at DESC",
    ),
  });
});

authRouter.delete("/password-reset-requests/:id", requirePermission("manage_users"), (req, res) => {
  run("DELETE FROM password_reset_requests WHERE id = ?", Number(req.params.id));
  res.json({ ok: true });
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

authRouter.get("/users", requirePermission("manage_users"), (_req, res) => {
  res.json({
    users: all<User>(
      "SELECT id, email, name, role, active, created_at FROM users ORDER BY name",
    ),
  });
});

authRouter.post("/users", requirePermission("manage_users"), (req: AuthedRequest, res) => {
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

authRouter.patch("/users/:id", requirePermission("manage_users"), (req: AuthedRequest, res) => {
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
  // Guard against removing the last user who can manage users, even by someone else.
  const losesManageUsers =
    hasPermission(target.role, "manage_users") &&
    (parsed.data.active === false ||
      (parsed.data.role !== undefined && !hasPermission(parsed.data.role, "manage_users")));
  if (losesManageUsers) {
    const roles = rolesWith("manage_users");
    const placeholders = roles.map(() => "?").join(",");
    const remaining = get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM users WHERE role IN (${placeholders}) AND active = 1 AND id != ?`,
      ...roles,
      id,
    );
    if (!remaining || remaining.n < 1) {
      res.status(400).json({ error: "Tidak bisa menghapus admin terakhir yang bisa mengelola pengguna." });
      return;
    }
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
