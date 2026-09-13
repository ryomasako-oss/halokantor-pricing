/* ============================================================
   Halokantor Pricing — Cloudflare Workers entry point.
   The built SPA is served by Workers Assets (see wrangler.toml);
   this Worker only ever sees /api/* (via `run_worker_first`).
   ============================================================ */

import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { loadUser } from "./auth";
import { authRouter } from "./routes/auth";
import { clientsRouter } from "./routes/clients";
import { catalogRouter } from "./routes/catalog";
import { quotesRouter } from "./routes/quotes";
import { approvalsRouter } from "./routes/approvals";
import { assistantRouter, assistantEnabled } from "./routes/assistant";
import { settingsRouter } from "./routes/settings";
import type { Env } from "./env";

const app = new Hono<Env>();

app.use(
  secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
    crossOriginEmbedderPolicy: false,
  }),
);

app.use(loadUser);

app.get("/api/health", (c) => c.json({ ok: true, ai: assistantEnabled(c.env.ANTHROPIC_API_KEY), version: "1.0.0" }));

app.route("/api/auth", authRouter);
app.route("/api/clients", clientsRouter);
app.route("/api/catalog", catalogRouter);
app.route("/api/quotes", quotesRouter);
app.route("/api/approvals", approvalsRouter);
app.route("/api/assistant", assistantRouter);
app.route("/api/settings", settingsRouter);

app.notFound((c) => c.json({ error: "Endpoint tidak ditemukan." }, 404));

app.onError((err, c) => {
  console.error("[worker] unhandled:", err);
  return c.json({ error: "Terjadi kesalahan di server." }, 500);
});

export default app;
