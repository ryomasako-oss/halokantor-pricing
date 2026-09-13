import Anthropic from "@anthropic-ai/sdk";
import { Hono } from "hono";
import { z } from "zod";
import { requireAuth } from "../auth";
import { audit } from "../audit";
import { currentPolicy } from "../quoteService";
import { DOCS, buildContext, chatSystem, docSystem } from "../../assistantContext";
import { snapshotSchema, zodMessage } from "../../validate";
import { clientIp, type Env } from "../env";

export const assistantRouter = new Hono<Env>();
assistantRouter.use(requireAuth);

export const assistantEnabled = (apiKey?: string): boolean => Boolean(apiKey);

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

assistantRouter.get("/status", (c) => {
  const model = c.env.ANTHROPIC_MODEL || "claude-opus-5";
  return c.json({ enabled: assistantEnabled(c.env.ANTHROPIC_API_KEY), model, docs: DOCS });
});

assistantRouter.post("/ask", async (c) => {
  const user = c.get("user")!;
  const apiKey = c.env.ANTHROPIC_API_KEY;
  if (!assistantEnabled(apiKey)) {
    return c.json({ error: "Asisten AI belum aktif. Isi ANTHROPIC_API_KEY dengan `wrangler secret put`, lalu deploy ulang." }, 503);
  }
  // Same limiter the Express server applies via express-rate-limit — this
  // endpoint calls a paid, per-token API, so it needs its own throttle.
  const { success } = await c.env.ASSISTANT_LIMITER.limit({ key: clientIp(c) });
  if (!success) return c.json({ error: "Asisten sedang kena batas pemakaian. Coba lagi sebentar lagi." }, 429);

  const parsed = z
    .object({
      context: contextInput,
      messages: z
        .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(8000) }))
        .min(1)
        .max(20),
    })
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: zodMessage(parsed.error) }, 400);

  const d = parsed.data.context;
  const ctx = buildContext({
    quote: { ...d.snapshot, number: d.number, title: d.title, status: d.status },
    policy: await currentPolicy(c.env.DB),
    clientName: d.clientName,
    notes: d.notes,
    sections: d.sections,
  });

  try {
    const anthropic = new Anthropic({ apiKey });
    const response = await anthropic.messages.create({
      model: c.env.ANTHROPIC_MODEL || "claude-opus-5",
      max_tokens: 2000,
      system: chatSystem(ctx),
      messages: parsed.data.messages,
    });
    const raw = textOf(response.content);
    const json = parseJSON(raw) ?? { answer: raw, sources: [], actions: [], followups: [] };
    await audit(c.env.DB, user.id, "assistant", 0, "ask", {
      question: parsed.data.messages[parsed.data.messages.length - 1]?.content.slice(0, 200),
    });
    return c.json({
      answer: String(json.answer ?? raw),
      sources: Array.isArray(json.sources) ? json.sources : [],
      actions: Array.isArray(json.actions) ? json.actions : [],
      followups: Array.isArray(json.followups) ? json.followups.slice(0, 3) : [],
    });
  } catch (err) {
    const { status, message } = describeError(err);
    console.error("[assistant] ask failed:", err);
    return c.json({ error: message }, status as any);
  }
});

assistantRouter.post("/document", async (c) => {
  const user = c.get("user")!;
  const apiKey = c.env.ANTHROPIC_API_KEY;
  if (!assistantEnabled(apiKey)) {
    return c.json({ error: "Asisten AI belum aktif. Isi ANTHROPIC_API_KEY dengan `wrangler secret put`." }, 503);
  }
  const { success } = await c.env.ASSISTANT_LIMITER.limit({ key: clientIp(c) });
  if (!success) return c.json({ error: "Asisten sedang kena batas pemakaian. Coba lagi sebentar lagi." }, 429);

  const parsed = z
    .object({ context: contextInput, kind: z.enum(["briefing", "faq", "risk", "negotiation"]) })
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: zodMessage(parsed.error) }, 400);

  const d = parsed.data.context;
  const ctx = buildContext({
    quote: { ...d.snapshot, number: d.number, title: d.title, status: d.status },
    policy: await currentPolicy(c.env.DB),
    clientName: d.clientName,
    notes: d.notes,
    sections: d.sections,
  });

  try {
    const anthropic = new Anthropic({ apiKey });
    const response = await anthropic.messages.create({
      model: c.env.ANTHROPIC_MODEL || "claude-opus-5",
      max_tokens: 4000,
      system: docSystem(ctx),
      messages: [{ role: "user", content: DOCS[parsed.data.kind].prompt }],
    });
    await audit(c.env.DB, user.id, "assistant", 0, "document", { kind: parsed.data.kind });
    return c.json({ content: textOf(response.content) });
  } catch (err) {
    const { status, message } = describeError(err);
    console.error("[assistant] document failed:", err);
    return c.json({ error: message }, status as any);
  }
});
