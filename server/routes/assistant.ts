import Anthropic from "@anthropic-ai/sdk";
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { type AuthedRequest, requireAuth } from "../auth.js";
import { audit } from "../audit.js";
import { currentPolicy } from "../quoteService.js";
import { DOCS, buildContext, chatSystem, docSystem } from "../assistantContext.js";
import { snapshotSchema, zodMessage } from "../validate.js";

export const assistantRouter = Router();
assistantRouter.use(requireAuth);

const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5";

let client: Anthropic | null = null;
function anthropic(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

export const assistantEnabled = (): boolean => Boolean(process.env.ANTHROPIC_API_KEY);

const askLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Terlalu banyak permintaan ke asisten. Tunggu sebentar." },
});

/** Turns SDK exceptions into a message a salesperson can act on. */
function describeError(err: unknown): { status: number; message: string } {
  if (err instanceof Anthropic.AuthenticationError)
    return { status: 502, message: "Kunci API Anthropic ditolak. Periksa ANTHROPIC_API_KEY di server." };
  if (err instanceof Anthropic.RateLimitError)
    return { status: 429, message: "Asisten sedang kena batas pemakaian. Coba lagi sebentar lagi." };
  if (err instanceof Anthropic.BadRequestError)
    return { status: 502, message: `Permintaan ke model ditolak: ${err.message}` };
  if (err instanceof Anthropic.APIConnectionError)
    return { status: 503, message: "Tidak bisa menghubungi layanan AI. Periksa koneksi internet server." };
  if (err instanceof Anthropic.APIError)
    return { status: 502, message: `Layanan AI mengembalikan error ${err.status}.` };
  return { status: 500, message: "Asisten gagal menjawab karena kesalahan tak terduga." };
}

/** Best-effort JSON extraction: models occasionally wrap output in prose. */
function parseJSON(text: string): Record<string, unknown> | null {
  const cleaned = String(text || "").replace(/```json|```/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    /* fall through to a brace slice */
  }
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      return null;
    }
  }
  return null;
}

const textOf = (content: Anthropic.ContentBlock[]): string =>
  content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");

const contextInput = z.object({
  snapshot: snapshotSchema,
  number: z.string().max(64).default(""),
  title: z.string().max(200).default(""),
  status: z.string().max(32).default("draft"),
  clientName: z.string().max(200).default("Klien"),
  sections: z.record(z.boolean()).default({}),
  notes: z
    .array(z.object({ id: z.string().max(64), title: z.string().max(200), text: z.string().max(20000) }))
    .max(20)
    .default([]),
});

assistantRouter.get("/status", (_req, res) => {
  res.json({ enabled: assistantEnabled(), model: MODEL, docs: DOCS });
});

assistantRouter.post("/ask", askLimiter, async (req: AuthedRequest, res) => {
  if (!assistantEnabled()) {
    res.status(503).json({
      error: "Asisten AI belum aktif. Isi ANTHROPIC_API_KEY di berkas .env server, lalu mulai ulang.",
    });
    return;
  }
  const parsed = z
    .object({
      context: contextInput,
      messages: z
        .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(8000) }))
        .min(1)
        .max(20),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: zodMessage(parsed.error) });
    return;
  }
  const c = parsed.data.context;
  const ctx = buildContext({
    quote: { ...c.snapshot, number: c.number, title: c.title, status: c.status },
    policy: currentPolicy(),
    clientName: c.clientName,
    notes: c.notes,
    sections: c.sections,
  });

  try {
    const response = await anthropic().messages.create({
      model: MODEL,
      max_tokens: 2000,
      system: chatSystem(ctx),
      messages: parsed.data.messages,
    });
    const raw = textOf(response.content);
    const json = parseJSON(raw) ?? { answer: raw, sources: [], actions: [], followups: [] };
    audit(req.user!.id, "assistant", 0, "ask", {
      question: parsed.data.messages[parsed.data.messages.length - 1]?.content.slice(0, 200),
    });
    res.json({
      answer: String(json.answer ?? raw),
      sources: Array.isArray(json.sources) ? json.sources : [],
      actions: Array.isArray(json.actions) ? json.actions : [],
      followups: Array.isArray(json.followups) ? json.followups.slice(0, 3) : [],
    });
  } catch (err) {
    const { status, message } = describeError(err);
    console.error("[assistant] ask failed:", err);
    res.status(status).json({ error: message });
  }
});

assistantRouter.post("/document", askLimiter, async (req: AuthedRequest, res) => {
  if (!assistantEnabled()) {
    res.status(503).json({ error: "Asisten AI belum aktif. Isi ANTHROPIC_API_KEY di server." });
    return;
  }
  const parsed = z
    .object({ context: contextInput, kind: z.enum(["briefing", "faq", "risk", "negotiation"]) })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: zodMessage(parsed.error) });
    return;
  }
  const c = parsed.data.context;
  const ctx = buildContext({
    quote: { ...c.snapshot, number: c.number, title: c.title, status: c.status },
    policy: currentPolicy(),
    clientName: c.clientName,
    notes: c.notes,
    sections: c.sections,
  });

  try {
    const response = await anthropic().messages.create({
      model: MODEL,
      max_tokens: 4000,
      system: docSystem(ctx),
      messages: [{ role: "user", content: DOCS[parsed.data.kind].prompt }],
    });
    audit(req.user!.id, "assistant", 0, "document", { kind: parsed.data.kind });
    res.json({ content: textOf(response.content) });
  } catch (err) {
    const { status, message } = describeError(err);
    console.error("[assistant] document failed:", err);
    res.status(status).json({ error: message });
  }
});
