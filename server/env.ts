/* Minimal .env loader — avoids a dependency and runs before any other import. */

import fs from "node:fs";
import path from "node:path";

const file = path.resolve(process.cwd(), ".env");
if (fs.existsSync(file)) {
  for (const rawLine of fs.readFileSync(file, "utf8").split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

if (!process.env.JWT_SECRET && process.env.NODE_ENV !== "production") {
  // Development convenience only; production refuses to start without a real secret.
  process.env.JWT_SECRET = "dev-only-insecure-secret-change-me-0123456789";
  console.warn("[env] JWT_SECRET not set — using an insecure development secret.");
}
