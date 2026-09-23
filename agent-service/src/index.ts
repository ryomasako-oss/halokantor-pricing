/* ============================================================
   Halokantor Pricing Agent — HTTP service entry point.

   Service terpisah dari app utama (pricing.salvator.co.id).
   Menyediakan:
   - GET  /health                    → health check
   - GET  /status                    → status agent (Gemini terkonfigurasi? knowledge store?)
   - POST /sync                     → trigger full sync dari halokantor API
   - GET  /quotes/similar           → cari kutipan mirip berdasarkan industri + scenario
   - POST /recommend                → generate rekomendasi untuk klien tertentu
   - GET  /industries/:clientId     → deteksi industri untuk klien
   - POST /webhook/gmail            → webhook incoming email (Gmail API push)
   ============================================================ */

import { createServer } from "node:http";
import { URL } from "node:url";
import { KnowledgeStore } from "./knowledge-store.js";
import { fullSync, type SyncReport } from "./sync.js";
import { industryProfileForClient } from "./industry.js";
import { generateRecommendation, findSimilarQuotes } from "./recommend.js";
import { GeminiClient, GEMINI_MODELS } from "./gemini.js";
import { GmailClient } from "./email.js";
import { IndustryTag } from "./types.js";

// ---- env ----

function envOr(name: string, fallback?: string): string {
  const v = process.env[name];
  return v ?? fallback ?? "";
}

const HALOKANTOR_API_BASE = envOr("HALOKANTOR_API_BASE", "https://pricing.salvator.co.id");
const HALOKANTOR_API_KEY = envOr("HALOKANTOR_API_KEY");
const GEMINI_API_KEY = envOr("GEMINI_API_KEY");
const AGENT_DB_PATH = envOr("AGENT_DB_PATH", "./data/agent-knowledge.db");
const GOOGLE_SA_EMAIL = envOr("GOOGLE_SERVICE_ACCOUNT_EMAIL");
const GOOGLE_PRIVATE_KEY = envOr("GOOGLE_PRIVATE_KEY");
const GOOGLE_SEND_AS = envOr("GOOGLE_SEND_AS_EMAIL");
const PORT = Number(envOr("AGENT_PORT", "8888")) || 8888;

// ---- dependencies ----

const store = new KnowledgeStore(AGENT_DB_PATH);
const gemini = GEMINI_API_KEY ? new GeminiClient(GEMINI_API_KEY) : null;
const gmail = (GOOGLE_SA_EMAIL && GOOGLE_PRIVATE_KEY && GOOGLE_SEND_AS)
  ? new GmailClient({ clientEmail: GOOGLE_SA_EMAIL, privateKeyPem: GOOGLE_PRIVATE_KEY, impersonatedUser: GOOGLE_SEND_AS })
  : null;

// ---- helpers ----

function sendJSON(res: { writeHead: (code: number, headers: Record<string, string>) => void; end: (body: string) => void }, code: number, data: unknown): void {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*" });
  res.end(JSON.stringify(data));
}

function sendError(res: { writeHead: (code: number, headers: Record<string, string>) => void; end: (body: string) => void }, code: number, message: string): void {
  sendJSON(res, code, { error: message });
}

function readBody(req: { on: (event: string, cb: (...args: any[]) => void) => void }): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
  });
}

// ---- server ----

const server = createServer(async (req, res) => {
  const reqUrl = req.url || "/";
  const url = new URL(reqUrl, `http://localhost`);
  const path = url.pathname;
  const method = req.method;

  try {
    // ---- health ----
    if (path === "/health" && method === "GET") {
      sendJSON(res, 200, { status: "ok", timestamp: new Date().toISOString() });
      return;
    }

    // ---- status ----
    if (path === "/status" && method === "GET") {
      sendJSON(res, 200, {
        gemini: gemini ? { configured: true, models: Object.values(GEMINI_MODELS) } : { configured: false },
        gmail: gmail ? { configured: true } : { configured: false },
        knowledgeStore: {
          quotes: store.allQuotes().length,
          clients: store.allClients().length,
          catalog: store.allCatalog().length,
        },
      });
      return;
    }

    // ---- sync ----
    if (path === "/sync" && method === "POST") {
      if (!HALOKANTOR_API_KEY) {
        sendError(res, 400, "HALOKANTOR_API_KEY wajib diisi di environment");
        return;
      }
      const pageSize = Math.min(200, Number(url.searchParams.get("pageSize") || "50"));
      const report = await fullSync(store, {
        apiBase: HALOKANTOR_API_BASE,
        apiKey: HALOKANTOR_API_KEY,
        pageSize,
      });
      sendJSON(res, 200, report);
      return;
    }

    // ---- quotes/similar ----
    if (path === "/quotes/similar" && method === "GET") {
      const clientName = url.searchParams.get("client");
      const scenarioStr = url.searchParams.get("scenario");
      const maxResults = Math.min(10, Number(url.searchParams.get("limit") || "5"));

      if (!clientName) {
        sendError(res, 400, "Parameter 'client' wajib diisi");
        return;
      }

      const targetQuotes = store.quotesByStatus("won").concat(store.quotesByStatus("approved"));
      const clientQuotes = targetQuotes.filter((q) => q.client_name === clientName);

      if (clientQuotes.length === 0) {
        sendJSON(res, 200, { quotes: [], message: "Tidak ada kutipan won/approved untuk klien ini di knowledge store" });
        return;
      }

      const profile = industryProfileForClient(clientQuotes, (quoteId) => {
        const q = store.quoteById(quoteId);
        if (!q) return null;
        try {
          return { items: q.items, assumptions: q.assumptions };
        } catch {
          return null;
        }
      });

      const preferredScenario = scenarioStr ? Number(scenarioStr) : null;

      const similar = findSimilarQuotes(store, profile.length > 0 ? profile : [{ label: "ATK Umum", evidence: [], confidence: 1 }], preferredScenario, maxResults);

      sendJSON(res, 200, {
        clientName,
        industryProfile: profile,
        preferredScenario,
        quotes: similar.map((s) => ({
          id: s.quote.id,
          number: s.quote.number,
          title: s.quote.title,
          client_name: s.quote.client_name,
          status: s.quote.status,
          scenario: s.quote.scenario,
          margin: s.margin,
          monthlyValue: s.monthlyValue,
          industryOverlap: s.industryOverlap,
          score: s.score,
        })),
      });
      return;
    }

    // ---- recommend ----
    if (path === "/recommend" && method === "POST") {
      const bodyText = await readBody(req);
      let input: Record<string, unknown>;
      try {
        input = JSON.parse(bodyText);
      } catch {
        sendError(res, 400, "Body harus JSON");
        return;
      }

      const clientName = String(input.client || "");
      const industryTags: IndustryTag[] = (input.industryTags || []) as IndustryTag[];
      const preferredScenario = input.preferredScenario != null ? Number(input.preferredScenario) : null;

      if (!clientName) {
        sendError(res, 400, "Field 'client' wajib diisi");
        return;
      }

      if (industryTags.length === 0) {
        const clientQuotes = store.quotesByStatus("won").concat(store.quotesByStatus("approved"))
          .filter((q) => q.client_name === clientName);
        if (clientQuotes.length > 0) {
          const tags = industryProfileForClient(clientQuotes, (quoteId) => {
            const q = store.quoteById(quoteId);
            if (!q) return null;
            try { return { items: q.items, assumptions: q.assumptions }; } catch { return null; }
          });
          if (tags.length > 0) {
            const rec = generateRecommendation(store, clientName, tags, preferredScenario, 3);
            if (rec) {
              sendJSON(res, 200, rec);
            } else {
              sendJSON(res, 200, { message: "Tidak ada kutipan cukup mirip untuk direkomendasikan" });
            }
            return;
          }
        }
        sendError(res, 400, "Industry tags wajib diisi atau ada kutipan untuk deteksi otomatis");
        return;
      }

      const rec = generateRecommendation(store, clientName, industryTags, preferredScenario, 3);
      if (rec) {
        sendJSON(res, 200, rec);
      } else {
        sendJSON(res, 200, { message: "Tidak ada kutipan cukup mirip untuk direkomendasikan" });
      }
      return;
    }

    // ---- industries/:clientId ----
    if (path.startsWith("/industries/") && method === "GET") {
      const clientId = path.split("/").pop();
      const client = store.clientById(Number(clientId));

      if (!client) {
        sendError(res, 404, "Klien tidak ditemukan");
        return;
      }

      const quotes = store.quotesByClient(Number(clientId)).filter((q) => q.status === "won" || q.status === "approved");
      const profile = industryProfileForClient(quotes, (quoteId) => {
        const q = store.quoteById(quoteId);
        if (!q) return null;
        try { return { items: q.items, assumptions: q.assumptions }; } catch { return null; }
      });

      sendJSON(res, 200, {
        client: { id: client.id, name: client.name, code: client.code },
        industryTags: profile,
      });
      return;
    }

    // ---- webhook/gmail ----
    if (path === "/webhook/gmail" && method === "POST") {
      if (!gmail) {
        sendError(res, 503, "Gmail tidak terkonfigurasi");
        return;
      }
      console.log("[webhook/gmail] incoming notification:", await readBody(req));
      sendJSON(res, 200, { received: true });
      return;
    }

    // ---- not found ----
    sendError(res, 404, `Route tidak ditemukan: ${method} ${path}`);
  } catch (err) {
    console.error("[agent] error:", err);
    sendError(res, 500, err instanceof Error ? err.message : "Internal server error");
  }
});

server.listen(PORT, () => {
  console.log(`Halokantor Pricing Agent listening on http://localhost:${PORT}`);
  console.log(`  Gemini:    ${gemini ? "terkonfigurasi" : "tidak (set GEMINI_API_KEY)"}`);
  console.log(`  Gmail:     ${gmail ? "terkonfigurasi" : "tidak (set GOOGLE_SERVICE_ACCOUNT_*)"}`);
  console.log(`  API base:  ${HALOKANTOR_API_BASE}`);
  console.log(`  API key:   ${HALOKANTOR_API_KEY ? "terkonfigurasi" : "tidak (set HALOKANTOR_API_KEY)"}`);
  console.log(`  DB path:   ${AGENT_DB_PATH}`);
});
