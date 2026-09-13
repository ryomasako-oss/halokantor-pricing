/* ============================================================
   One-off admin seeding for D1. Workers has no boot phase to run
   ensureSeed() automatically, so this generates the same PBKDF2 hash
   server/worker/auth.ts verifies with, writes it to a SQL file, and
   the caller applies it with `wrangler d1 execute`.

   Usage: tsx scripts/seed-admin.ts <email> <name> <password> <out.sql>
   ============================================================ */

// Must match server/worker/auth.ts: Workers' WebCrypto caps PBKDF2 at 100,000.
const PBKDF2_ITERATIONS = 100_000;

function toB64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

async function pbkdf2(plain: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey("raw", new TextEncoder().encode(plain), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations, hash: "SHA-256" }, keyMaterial, 256);
  return new Uint8Array(bits);
}

async function hashPassword(plain: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(plain, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toB64(salt)}$${toB64(hash)}`;
}

function sqlLiteral(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

async function main() {
  const [email, name, password, outFile] = process.argv.slice(2);
  if (!email || !name || !password || !outFile) {
    console.error("Usage: tsx scripts/seed-admin.ts <email> <name> <password> <out.sql>");
    process.exit(1);
  }
  const hash = await hashPassword(password);
  const sql = `INSERT INTO users(email, name, password_hash, role) VALUES(${sqlLiteral(email.toLowerCase())}, ${sqlLiteral(name)}, ${sqlLiteral(hash)}, 'admin');\nINSERT INTO clients(name, code, address, contact_name, payment_terms, delivery_terms) SELECT 'PT Agrinesia', 'AGR', 'Jakarta', 'Procurement', '30 hari setelah invoice', 'Franco Jakarta, jadwal mingguan' WHERE NOT EXISTS (SELECT 1 FROM clients LIMIT 1);\n`;
  const fs = await import("node:fs");
  fs.writeFileSync(outFile, sql);
  console.log(`Wrote ${outFile}`);
}

main();
