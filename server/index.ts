/* ============================================================
   Halokantor Pricing — API server.
   In production it also serves the built single-page client, so the
   whole product runs as one Node process behind one port.
   ============================================================ */

import "./env.js";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { loadUser } from "./auth.js";
import { authRouter } from "./routes/auth.js";
import { clientsRouter } from "./routes/clients.js";
import { catalogRouter } from "./routes/catalog.js";
import { quotesRouter } from "./routes/quotes.js";
import { approvalsRouter } from "./routes/approvals.js";
import { assistantRouter, assistantEnabled } from "./routes/assistant.js";
import { settingsRouter } from "./routes/settings.js";
import { ensureSeed } from "./seed.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const isProd = process.env.NODE_ENV === "production";
const port = Number(process.env.PORT || 8787);

const app = express();
app.set("trust proxy", 1);

app.use(
  helmet({
    // The client is a single bundle with no inline scripts; fonts come from Google.
    contentSecurityPolicy: isProd
      ? {
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
            imgSrc: ["'self'", "data:", "blob:"],
            connectSrc: ["'self'"],
            objectSrc: ["'none'"],
            frameAncestors: ["'none'"],
          },
        }
      : false,
    crossOriginEmbedderPolicy: false,
  }),
);

if (!isProd) {
  app.use(cors({ origin: "http://localhost:5173", credentials: true }));
}

app.use(express.json({ limit: "12mb" }));
app.use(cookieParser());
app.use(loadUser);

app.use(
  "/api",
  rateLimit({
    windowMs: 60 * 1000,
    limit: 600,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Terlalu banyak permintaan. Coba lagi sebentar." },
  }),
);

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, ai: assistantEnabled(), version: "1.0.0" });
});

app.use("/api/auth", authRouter);
app.use("/api/clients", clientsRouter);
app.use("/api/catalog", catalogRouter);
app.use("/api/quotes", quotesRouter);
app.use("/api/approvals", approvalsRouter);
app.use("/api/assistant", assistantRouter);
app.use("/api/settings", settingsRouter);

app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Endpoint tidak ditemukan." });
});

if (isProd) {
  // dist/server/server/index.js -> dist/client
  const candidates = [
    path.resolve(here, "../../client"),
    path.resolve(here, "../client"),
    path.resolve(process.cwd(), "dist/client"),
  ];
  const clientDir = candidates.find((p) => fs.existsSync(path.join(p, "index.html")));
  if (clientDir) {
    app.use(express.static(clientDir, { maxAge: "1h", index: false }));
    app.get("*", (_req, res) => res.sendFile(path.join(clientDir, "index.html")));
  } else {
    console.warn("[server] Built client not found. Run `npm run build` first.");
  }
}

// Central error handler: never leak a stack trace to the browser.
app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    console.error("[server] unhandled:", err);
    if (res.headersSent) return;
    res.status(500).json({ error: "Terjadi kesalahan di server." });
  },
);

ensureSeed();

app.listen(port, () => {
  console.log(`\n  Halokantor Pricing`);
  console.log(`  API      http://localhost:${port}/api`);
  console.log(`  Mode     ${isProd ? "production" : "development"}`);
  console.log(`  Asisten  ${assistantEnabled() ? "aktif" : "nonaktif (ANTHROPIC_API_KEY kosong)"}`);
  if (!isProd) console.log(`  Web      http://localhost:5173\n`);
  else console.log(`  Web      http://localhost:${port}\n`);
});
