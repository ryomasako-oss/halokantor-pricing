/* ============================================================
   First-run seed: one administrator account and the sample client.
   Safe to run repeatedly — it does nothing once users exist.
   ============================================================ */

import "./env.js";
import crypto from "node:crypto";
import { get, run } from "./db.js";
import { hashPassword } from "./auth.js";
import { audit } from "./audit.js";

export function ensureSeed(): void {
  const existing = get<{ n: number }>("SELECT COUNT(*) AS n FROM users");
  if (existing && existing.n > 0) return;

  const email = (process.env.ADMIN_EMAIL || "admin@salvator.co.id").toLowerCase();
  const name = process.env.ADMIN_NAME || "Administrator";
  // A generated password is printed once; it never lands in a file.
  const generated = crypto.randomBytes(9).toString("base64url");
  const password = process.env.ADMIN_PASSWORD || generated;

  run(
    "INSERT INTO users(email, name, password_hash, role) VALUES(?, ?, ?, 'admin')",
    email,
    name,
    hashPassword(password),
  );
  const id = Number(get<{ id: number }>("SELECT id FROM users WHERE email = ?", email)?.id ?? 0);
  audit(null, "user", id, "seeded", { email });

  if (!get("SELECT id FROM clients LIMIT 1")) {
    run(
      `INSERT INTO clients(name, code, address, contact_name, payment_terms, delivery_terms)
       VALUES(?, ?, ?, ?, ?, ?)`,
      "PT Agrinesia",
      "AGR",
      "Jakarta",
      "Procurement",
      "30 hari setelah invoice",
      "Franco Jakarta, jadwal mingguan",
    );
  }

  console.log("\n  ==============================================");
  console.log("   Akun administrator pertama dibuat");
  console.log(`   Email     : ${email}`);
  console.log(`   Kata sandi: ${password}`);
  if (!process.env.ADMIN_PASSWORD) {
    console.log("   (dibuat acak — simpan sekarang, tidak ditampilkan lagi)");
  }
  console.log("  ==============================================\n");
}

// Allow `npm run seed` to run this file directly.
if (process.argv[1] && process.argv[1].endsWith("seed.ts")) ensureSeed();
