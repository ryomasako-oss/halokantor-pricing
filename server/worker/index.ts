/* ============================================================
   Pricing Engine Salvator — Cloudflare Workers entry point.
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
import { clientIp, type Env } from "./env";

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

// Blanket throttle across the whole /api/* surface — the per-route
// AUTH_LIMITER/ASSISTANT_LIMITER stay stricter for their own endpoints;
// this just stops any one client from hammering D1 unchecked elsewhere.
app.use("/api/*", async (c, next) => {
  const { success } = await c.env.API_LIMITER.limit({ key: clientIp(c) });
  if (!success) return c.json({ error: "Terlalu banyak permintaan. Coba lagi sebentar." }, 429);
  await next();
});

app.get("/api/health", (c) => c.json({ ok: true, ai: assistantEnabled(c.env.ANTHROPIC_API_KEY), version: "1.0.0" }));

app.route("/api/auth", authRouter);
app.route("/api/clients", clientsRouter);
app.route("/api/catalog", catalogRouter);
app.route("/api/quotes", quotesRouter);
app.route("/api/approvals", approvalsRouter);
app.route("/api/assistant", assistantRouter);
app.route("/api/settings", settingsRouter);

// Non-API paths reach here because run_worker_first now covers every
// request (not just /api/*) — see wrangler.toml. Hand those to the static
// asset binding so the SPA still serves, while keeping secureHeaders applied
// (it runs before this point in the middleware chain, so the response it
// produces still carries CSP/HSTS/etc).
app.notFound(async (c) => {
  if (c.req.path.startsWith("/api/")) return c.json({ error: "Endpoint tidak ditemukan." }, 404);
  // ASSETS.fetch() returns a Response with immutable headers; secureHeaders
  // mutates c.res after this handler returns, so re-wrap it in a fresh
  // Response whose Headers object is a normal mutable copy.
  const asset = await c.env.ASSETS.fetch(c.req.raw);
  return new Response(asset.body, asset);
});

app.onError((err, c) => {
  console.error("[worker] unhandled:", err);
  return c.json({ error: "Terjadi kesalahan di server." }, 500);
});

export default app;
