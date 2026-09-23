/* ============================================================
   Gemini client — LLM provider untuk agent service.

   Mengapa Gemini vs Anthropic (yang dipakai app utama):
   - Harga jauh lebih murah untuk workload agent yang tidak perlu
     reasoning mendalam seperti Claude.
   - App utama tetap pakai Anthropic (ANTHROPIC_API_KEY); agent
     service pakai Gemini (GEMINI_API_KEY). Mereka independen.
   ============================================================ */

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

export interface GeminiCandidate {
  text: string;
  /** Apakah candidate ini tampak mengandung JSON (di-extract dari markdown code fence atau brace pair). */
  isJSON: boolean;
}

export class GeminiClient {
  private apiKey: string;

  constructor(apiKey: string) {
    if (!apiKey) throw new Error("GEMINI_API_KEY wajib diisi");
    this.apiKey = apiKey;
  }

  /**
   * Call Gemini dengan model tertentu, system prompt, dan daftar messages.
   * Default model: gemini-2.0-flash (cepat, murah, cukup untuk task agent).
   * Maksimal ~8000 token input untuk flash.
   */
  async chat(model: string, system: string, messages: { role: "user" | "model"; content: string }[]): Promise<string> {
    if (!this.apiKey) throw new Error("Gemini tidak terkonfigurasi");
    const url = `${GEMINI_API_BASE}/models/${model}:generateContent?key=${this.apiKey}`;

    const contents = messages.map((m) => ({
      role: m.role === "model" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    const body: object = {
      contents,
      generationConfig: {
        temperature: 0.3,
        topK: 4,
        topP: 0.95,
        maxOutputTokens: 4096,
      },
      safetySettings: [
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
      ],
    };

    // Gemini tidak punya field "system" eksplisit di generateContent; kita
    // prepend system prompt sebagai pesan pertama dengan role "user" dan
    // prefix "[system] " — pola yang umum dipakai saat integrasi langsung.
    const prefixedContents: object[] = [
      { role: "user", parts: [{ text: `[system]\n${system}` }] },
      ...contents,
    ];

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: prefixedContents, ...body }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Gemini API ${res.status}: ${errText.slice(0, 500)}`);
    }

    const json = (await res.json()) as { candidates?: Array<{ content: { parts: Array<{ text: string }> } }>; promptFeedback?: { blockReason?: string } };
    if (!json.candidates || json.candidates.length === 0) {
      const reason = json.promptFeedback?.blockReason ?? "unknown";
      throw new Error(`Gemini tidak mengembalikan candidate (blockReason: ${reason})`);
    }

    const text = json.candidates
      .map((c) => c.content.parts.map((p) => p.text).join(""))
      .join("\n\n");

    return text;
  }

  /**
   * Variasi chat yang hanya mengambil teks pertama dan trim.
   */
  async chatText(model: string, system: string, messages: { role: "user" | "model"; content: string }[]): Promise<string> {
    const raw = await this.chat(model, system, messages);
    return raw.trim();
  }

  /**
   * Extract JSON dari respons Gemini. Model sering membungkus output
   * dalam markdown code fence atau teks prosa; fungsi ini mencoba
   * beberapa strategi: JSON fence, brace pair, dan parse langsung.
   */
  extractJSON(raw: string): Record<string, unknown> | null {
    const cleaned = raw.replace(/```json|```/g, "").trim();
    try {
      return JSON.parse(cleaned) as Record<string, unknown>;
    } catch {
      // fall through
    }
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
      } catch {
        return null;
      }
    }
    return null;
  }
}

/** Model Gemini yang tersedia untuk agent. Flash lebih murah dan cepat. */
export const GEMINI_MODELS = {
  flash: "gemini-2.0-flash",
  flashLite: "gemini-2.0-flash-lite",
} as const;

export type GeminiModel = keyof typeof GEMINI_MODELS;
