import { Hono } from "hono";
import { z } from "zod";
import { all, get, run } from "../../db.d1";
import { audit } from "../audit";
import { clearSession, hashPassword, issueSession, requireAuth, requireRole, verifyPassword } from "../auth";
import type { User } from "../../../shared/types";
import { clientIp, type Env } from "../env";

export const authRouter = new Hono<Env>();

authRouter.post("/login", async (c) => {
  // Throttled per client IP: Workers isolates have no shared in-memory
  // counter, so brute-force protection goes through this edge binding.
  const { success } = await c.env.AUTH_LIMITER.limit({ key: clientIp(c) });
  if (!success) return c.json({ error: "Terlalu banyak percobaan masuk. Coba lagi sebentar lagi." }, 429);

  const parsed = z
    .object({ email: z.string().email(), password: z.string().min(1).max(200) })
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Email atau kata sandi tidak valid." }, 400);

  const row = await get<User & { password_hash: string }>(
    c.env.DB,
    "SELECT * FROM users WHERE lower(email) = lower(?)",
    parsed.data.email,
  );
  const verified = row && row.active ? await verifyPassword(parsed.data.password, row.password_hash) : null;
  // Same message either way, so the form cannot be used to enumerate accounts.
  if (!row || !row.active || !verified?.ok) {
    return c.json({ error: "Email atau kata sandi salah." }, 401);
  }
  if (verified.rehash) {
    await run(c.env.DB, "UPDATE users SET password_hash = ? WHERE id = ?", verified.rehash, row.id);
  }
  const user: User = {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    active: row.active,
    created_at: row.created_at,
  };
  await issueSession(c, user);
  await audit(c.env.DB, user.id, "user", user.id, "login");
  return c.json({ user });
});

authRouter.post("/logout", async (c) => {
  const user = c.get("user");
  if (user) await audit(c.env.DB, user.id, "user", user.id, "logout");
  clearSession(c);
  return c.json({ ok: true });
});

authRouter.get("/me", (c) => c.json({ user: c.get("user") ?? null }));

authRouter.post("/password", requireAuth, async (c) => {
  const user = c.get("user")!;
  const { success } = await c.env.AUTH_LIMITER.limit({ key: clientIp(c) });
  if (!success) return c.json({ error: "Terlalu banyak percobaan. Coba lagi sebentar lagi." }, 429);

  const parsed = z
    .object({ current: z.string().min(1), next: z.string().min(8).max(200) })
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Kata sandi baru minimal 8 karakter." }, 400);

  const row = await get<{ password_hash: string }>(
    c.env.DB,
    "SELECT password_hash FROM users WHERE id = ?",
    user.id,
  );
  const verified = row ? await verifyPassword(parsed.data.current, row.password_hash) : null;
  if (!row || !verified?.ok) return c.json({ error: "Kata sandi saat ini salah." }, 401);

  await run(c.env.DB, "UPDATE users SET password_hash = ? WHERE id = ?", await hashPassword(parsed.data.next), user.id);
  await audit(c.env.DB, user.id, "user", user.id, "password_changed");
  return c.json({ ok: true });
});

/* ---------------- user administration ---------------- */

authRouter.get("/users", requireRole("admin"), async (c) => {
  const users = await all<User>(
    c.env.DB,
    "SELECT id, email, name, role, active, created_at FROM users ORDER BY name",
  );
  return c.json({ users });
});

authRouter.post("/users", requireRole("admin"), async (c) => {
  const actor = c.get("user")!;
  const parsed = z
    .object({
      email: z.string().email(),
      name: z.string().min(1).max(120),
      password: z.string().min(8).max(200),
      role: z.enum(["rep", "manager", "admin"]),
    })
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: "Data pengguna tidak lengkap. Kata sandi minimal 8 karakter." }, 400);
  }
  const exists = await get(c.env.DB, "SELECT id FROM users WHERE lower(email) = lower(?)", parsed.data.email);
  if (exists) return c.json({ error: "Email itu sudah terdaftar." }, 409);

  const info = await run(
    c.env.DB,
    "INSERT INTO users(email, name, password_hash, role) VALUES(?, ?, ?, ?)",
    parsed.data.email.toLowerCase(),
    parsed.data.name,
    await hashPassword(parsed.data.password),
    parsed.data.role,
  );
  const id = Number(info.meta.last_row_id);
  await audit(c.env.DB, actor.id, "user", id, "created", { email: parsed.data.email, role: parsed.data.role });
  const user = await get<User>(c.env.DB, "SELECT id, email, name, role, active, created_at FROM users WHERE id = ?", id);
  return c.json({ user }, 201);
});

authRouter.patch("/users/:id", requireRole("admin"), async (c) => {
  const actor = c.get("user")!;
  const id = Number(c.req.param("id"));
  const parsed = z
    .object({
      name: z.string().min(1).max(120).optional(),
      role: z.enum(["rep", "manager", "admin"]).optional(),
      active: z.boolean().optional(),
      password: z.string().min(8).max(200).optional(),
    })
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Perubahan tidak valid." }, 400);

  const target = await get<User>(c.env.DB, "SELECT * FROM users WHERE id = ?", id);
  if (!target) return c.json({ error: "Pengguna tidak ditemukan." }, 404);

  // Guard against an admin locking themselves, and possibly everyone, out.
  if (id === actor.id && (parsed.data.active === false || parsed.data.role === "rep")) {
    return c.json({ error: "Anda tidak bisa menurunkan atau menonaktifkan akun sendiri." }, 400);
  }
  const d = parsed.data;
  if (d.name !== undefined) await run(c.env.DB, "UPDATE users SET name = ? WHERE id = ?", d.name, id);
  if (d.role !== undefined) await run(c.env.DB, "UPDATE users SET role = ? WHERE id = ?", d.role, id);
  if (d.active !== undefined) await run(c.env.DB, "UPDATE users SET active = ? WHERE id = ?", d.active ? 1 : 0, id);
  if (d.password !== undefined)
    await run(c.env.DB, "UPDATE users SET password_hash = ? WHERE id = ?", await hashPassword(d.password), id);
  await audit(c.env.DB, actor.id, "user", id, "updated", { ...d, password: d.password ? "(reset)" : undefined });
  const user = await get<User>(c.env.DB, "SELECT id, email, name, role, active, created_at FROM users WHERE id = ?", id);
  return c.json({ user });
});
