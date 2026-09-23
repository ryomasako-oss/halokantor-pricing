#!/usr/bin/env node
/* ============================================================
   CLI entry point untuk Halokantor Pricing Agent.

   Perintah:
   - sync              → jalankan full sync dari halokantor API ke knowledge store
   - recommend <nama>  → generate rekomendasi untuk klien tertentu
   - detect-industry <nama> → deteksi industri untuk klien berdasarkan kutipan
   - server           → mulai HTTP server (default)
   ============================================================ */

import { fullSync } from "./sync.js";
import { detectIndustry, industryProfileForClient } from "./industry.js";
import { generateRecommendation } from "./recommend.js";
import { KnowledgeStore } from "./knowledge-store.js";
import { CapturedQuote } from "./types.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ---- env ----
function envOr(name: string, fallback?: string): string {
  const v = process.env[name];
  return v ?? fallback ?? "";
}

const HALOKANTOR_API_BASE = envOr("HALOKANTOR_API_BASE", "https://pricing.salvator.co.id");
const HALOKANTOR_API_KEY = envOr("HALOKANTOR_API_KEY");
const AGENT_DB_PATH = envOr("AGENT_DB_PATH", "./data/agent-knowledge.db");

// ---- load .env jika ada ----
const envFile = resolve(process.cwd(), "agent-service/.env");
if (readFileSync(envFile, "utf8").length > 0) {
  for (const rawLine of readFileSync(envFile, "utf8").split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

// ---- init store ----
const store = new KnowledgeStore(AGENT_DB_PATH);

// ---- commands ----

async function cmdSync() {
  if (!HALOKANTOR_API_KEY) {
    console.error("HALOKANTOR_API_KEY wajib diisi. Set di .env atau environment.");
    process.exit(1);
  }
  console.log(`Mulai sync dari ${HALOKANTOR_API_BASE} ...`);
  const report = await fullSync(store, {
    apiBase: HALOKANTOR_API_BASE,
    apiKey: HALOKANTOR_API_KEY,
    pageSize: 100,
  });
  console.log("\n=== Laporan Sync ===");
  console.log(`Klien:       ${report.clientsSynced} baris di-sync`);
  console.log(`Katalog:     ${report.catalogSynced} baris di-sync`);
  console.log(`Kutipan:     ${report.quotesSynced} baris di-sync`);
  console.log(`Error:       ${report.errors}`);
  console.log(`\nTotal di knowledge store:`);
  console.log(`  Kutipan:   ${report.totalQuotesInStore}`);
  console.log(`  Klien:     ${report.totalClientsInStore}`);
  console.log(`  Katalog:   ${report.totalCatalogInStore}`);
}

function cmdDetectIndustry(clientName: string) {
  const quotes = store.allQuotes().filter((q) => q.client_name === clientName && (q.status === "won" || q.status === "approved"));

  if (quotes.length === 0) {
    console.log(`Tidak ada kutipan won/approved untuk "${clientName}" di knowledge store.`);
    console.log("Jalankan 'npm run sync' dulu untuk meng-capture data dari API.");
    process.exit(1);
  }

  const tags = industryProfileForClient(quotes, (quoteId) => {
    const q = store.quoteById(quoteId);
    if (!q) return null;
    try { return { items: q.items, assumptions: q.assumptions }; } catch { return null; }
  });

  console.log(`\n=== Deteksi Industri: ${clientName} ===`);
  console.log(`Berdasarkan ${quotes.length} kutipan won/approved:`);
  for (const q of quotes.slice(0, 10)) {
    console.log(`  - ${q.number} (${q.status})`);
  }

  if (tags.length === 0) {
    console.log("Tidak terdeteksi industri spesifik dari item mix.");
    return;
  }

  console.log("\nTag industri (urut confidence):");
  for (const tag of tags) {
    console.log(`  ${tag.label} — confidence ${(tag.confidence * 100).toFixed(1)}%`);
    if (tag.evidence.length > 0) {
      console.log(`    Evidence: ${tag.evidence.slice(0, 5).join(", ")}`);
    }
  }
}

function cmdRecommend(clientName: string) {
  const quotes = store.allQuotes().filter((q) => q.client_name === clientName && (q.status === "won" || q.status === "approved"));

  if (quotes.length === 0) {
    console.log(`Tidak ada kutipan won/approved untuk "${clientName}" di knowledge store.`);
    console.log("Jalankan 'npm run sync' dulu.");
    process.exit(1);
  }

  const tags = industryProfileForClient(quotes, (quoteId) => {
    const q = store.quoteById(quoteId);
    if (!q) return null;
    try { return { items: q.items, assumptions: q.assumptions }; } catch { return null; }
  });

  if (tags.length === 0) {
    console.log("Tidak ada industri yang terdeteksi untuk direkomendasikan.");
    process.exit(1);
  }

  console.log(`\n=== Rekomendasi untuk ${clientName} ===`);
  const rec = generateRecommendation(store, clientName, tags, null, 3);

  if (!rec) {
    console.log("Tidak ada kutipan cukup mirip untuk direkomendasikan.");
    return;
  }

  console.log(`Klien mirip: ${rec.similarQuote.client_name} (${rec.similarQuote.number})`);
  console.log(`Skenario:    ${rec.similarScenario == null ? "null" : ["S1 Full Margin", "S2 Cross Subsidise", "S3 RRP Discount"][rec.similarScenario]}`);
  console.log(`Margin:      ${rec.similarMargin != null ? (rec.similarMargin * 100).toFixed(1) + "%" : "N/A"}`);
  console.log(`Confidence:  ${(rec.confidence * 100).toFixed(1)}%`);
  console.log("\nAlasan:");
  for (const reason of rec.reasons) {
    console.log(`  - ${reason}`);
  }

  if (rec.suggestedMonthlyValue != null) {
    console.log(`\nNilai bulanan yang disarankan: Rp ${Math.round(rec.suggestedMonthlyValue).toLocaleString("id-ID")}`);
  }
}

function cmdServer() {
  const { listen } = await import("./index.js");
  // index.ts langsung memulai server saat di-import; ini hanya placeholder
  console.log("Server sudah berjalan. Lihat output di atas.");
}

// ---- main ----

const [,, command, arg] = process.argv;

if (command === "sync") {
  cmdSync();
} else if (command === "detect-industry") {
  if (!arg) {
    console.error("Usage: npm run detect-industry <nama-klien>");
    process.exit(1);
  }
  cmdDetectIndustry(arg);
} else if (command === "recommend") {
  if (!arg) {
    console.error("Usage: npm run recommend <nama-klien>");
    process.exit(1);
  }
  cmdRecommend(arg);
} else if (command === "server") {
  cmdServer();
} else {
  console.log(`Usage: node cli.js <command> [args]

Commands:
  sync                Sync data dari halokantor API ke knowledge store
  detect-industry <nama>  Deteksi industri untuk klien
  recommend <nama>   Generate rekomendasi untuk klien
  server              Mulai HTTP server (default: port 8888)

Environment:
  HALOKANTOR_API_BASE    Base URL halokantor API (default: https://pricing.salvator.co.id)
  HALOKANTOR_API_KEY     API key untuk akses read-only
  AGENT_DB_PATH          Path ke SQLite knowledge store (default: ./data/agent-knowledge.db)
  GEMINI_API_KEY         Gemini API key untuk LLM (opsional)
  GOOGLE_SERVICE_ACCOUNT_EMAIL   Google Workspace service account email (opsional)
  GOOGLE_PRIVATE_KEY     Service account private key PEM (opsional)
  GOOGLE_SEND_AS_EMAIL   Email yang diimpersonasi untuk kirim email (opsional)
  AGENT_PORT             Port HTTP server (default: 8888)
`);
  process.exit(1);
}
