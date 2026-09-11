/* Grounded pricing assistant. The model may propose changes but never
   applies them: every action is shown to the user and applied only on
   an explicit click, so the engine stays the single source of truth. */

import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useToast } from "../context/ToastContext";
import { Icon } from "./Icon";
import { Rich } from "./Rich";
import { pct, uid } from "@shared/format";
import type { Assumptions, QuoteSnapshot, ScenarioIndex } from "@shared/types";

export interface AssistantAction {
  type: "set" | "item" | "scenario";
  key?: string;
  no?: number;
  field?: string;
  value: unknown;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  error?: boolean;
  actions?: AssistantAction[];
  followups?: string[];
  applied?: boolean;
}

const KEY_LABEL: Record<string, string> = {
  opex: "Opex",
  targetMargin: "Target margin",
  leaderMargin: "Margin leader",
  profitDiscount: "Diskon item profit",
  rrpDiscount: "Diskon dari RRP",
  marginFloor: "Margin minimum",
  ppn: "PPN",
  step: "Pembulatan harga",
  months: "Durasi kontrak",
  includeLogistics: "Logistik di harga",
};

/** Renders one proposed action as a sentence a salesperson can check. */
function describe(action: AssistantAction, snapshot: QuoteSnapshot): string {
  if (action.type === "set") {
    const key = String(action.key);
    const label = KEY_LABEL[key] ?? key;
    if (key === "includeLogistics") return `${label}: ${action.value ? "nyala" : "mati"}`;
    if (key === "step" || key === "months") return `${label}: ${action.value}`;
    const v = Number(action.value);
    return `${label}: ${pct(v > 1 ? v / 100 : v)}`;
  }
  if (action.type === "item") {
    const item = snapshot.items.find((i) => i.lineNo === Number(action.no));
    return `${item?.name ?? `Baris ${action.no}`}: ${action.field} jadi ${action.value}`;
  }
  if (action.type === "scenario") return `Pakai skenario S${action.value}`;
  return "Perubahan tidak dikenali";
}

interface Props {
  snapshot: QuoteSnapshot;
  number: string;
  title: string;
  status: string;
  clientName: string;
  readOnly: boolean;
  onApply: (actions: AssistantAction[]) => void;
}

export function AssistantPanel({
  snapshot, number, title, status, clientName, readOnly, onApply,
}: Props) {
  const toast = useToast();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    api
      .get<{ enabled: boolean }>("/assistant/status")
      .then((r) => setEnabled(r.enabled))
      .catch(() => setEnabled(false));
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 110)}px`;
  }, [input]);

  const send = async (textArg?: string) => {
    const text = (textArg ?? input).trim();
    if (!text || busy) return;
    setInput("");
    const history = [...messages, { id: uid(), role: "user" as const, text }];
    setMessages(history);
    setBusy(true);
    try {
      const r = await api.post<{
        answer: string;
        actions: AssistantAction[];
        followups: string[];
      }>("/assistant/ask", {
        context: {
          snapshot,
          number,
          title,
          status,
          clientName,
          sections: { assumptions: true, items: true, delivery: true },
          notes: [],
        },
        messages: history
          .filter((m) => !m.error)
          .slice(-10)
          .map((m) => ({ role: m.role, content: m.text })),
      });
      setMessages((m) => [
        ...m,
        {
          id: uid(),
          role: "assistant",
          text: r.answer,
          actions: readOnly ? [] : r.actions,
          followups: r.followups,
        },
      ]);
    } catch (e) {
      setMessages((m) => [
        ...m,
        {
          id: uid(),
          role: "assistant",
          error: true,
          text: e instanceof Error ? e.message : "Asisten gagal menjawab.",
        },
      ]);
    } finally {
      setBusy(false);
    }
  };

  const apply = (msg: Message) => {
    if (!msg.actions?.length) return;
    onApply(msg.actions);
    setMessages((all) => all.map((m) => (m.id === msg.id ? { ...m, applied: true } : m)));
    toast("Perubahan diterapkan. Jangan lupa simpan.", "success");
  };

  if (enabled === false) {
    return (
      <div className="card-body">
        <p className="notice info">
          <Icon name="spark" size={14} /> Asisten AI belum aktif. Isi <code>ANTHROPIC_API_KEY</code>{" "}
          di berkas <code>.env</code> server lalu mulai ulang aplikasi.
        </p>
      </div>
    );
  }

  const suggestions = [
    "Skenario mana yang paling aman untuk margin?",
    "Item apa saja yang mentok di RRP?",
    "Kenapa cross subsidise tetap untung?",
    "Naikkan margin leader jadi 12%",
  ];

  return (
    <div className="chat">
      <div className="chat-scroll" ref={scrollRef}>
        {messages.length === 0 && (
          <div>
            <p className="muted small">
              Tanya apa saja soal harga quotation ini. Jawaban hanya diambil dari angka yang ada di
              sini, bukan dari luar.
            </p>
            <div className="chips">
              {suggestions.map((q) => (
                <button key={q} className="chip" onClick={() => void send(q)}>{q}</button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) => (
          <div key={m.id} className={`msg ${m.role}`}>
            {m.role === "user" ? (
              <div className="bubble">{m.text}</div>
            ) : (
              <div className={`answer ${m.error ? "error" : ""}`}>
                <Rich text={m.text} />
                {m.actions && m.actions.length > 0 && (
                  <div className="proposal">
                    <strong>{m.applied ? "Sudah diterapkan" : "Usulan perubahan"}</strong>
                    <ul>
                      {m.actions.map((a, i) => (
                        <li key={i}>{describe(a, snapshot)}</li>
                      ))}
                    </ul>
                    {!m.applied && (
                      <button className="btn small primary" onClick={() => apply(m)}>
                        Terapkan ke engine
                      </button>
                    )}
                  </div>
                )}
                {m.followups && m.followups.length > 0 && !busy && (
                  <div className="chips">
                    {m.followups.map((q) => (
                      <button key={q} className="chip" onClick={() => void send(q)}>{q}</button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}

        {busy && (
          <div className="loading">
            <span className="dots"><i /><i /><i /></span> Membaca angka quotation…
          </div>
        )}
      </div>

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          ref={inputRef}
          rows={1}
          value={input}
          placeholder="Tanya atau minta ubah, misal: diskon RRP jadi 8%"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          aria-label="Pesan ke asisten"
        />
        <button className="send" type="submit" disabled={!input.trim() || busy} aria-label="Kirim">
          <Icon name="send" size={17} />
        </button>
      </form>
    </div>
  );
}

/** Applies assistant actions to a snapshot, ignoring anything invalid. */
export function applyActions(
  actions: AssistantAction[],
  snapshot: QuoteSnapshot,
): { snapshot: QuoteSnapshot; labels: string[] } {
  const assumptions: Assumptions = { ...snapshot.assumptions };
  const items = snapshot.items.map((i) => ({ ...i }));
  let scenario = snapshot.scenario;
  const labels: string[] = [];

  for (const action of actions) {
    if (!action || typeof action !== "object") continue;

    if (action.type === "set" && action.key && action.key in assumptions) {
      const key = action.key as keyof Assumptions;
      if (key === "includeLogistics") {
        const v = action.value === true || action.value === "true" || action.value === "Y";
        assumptions.includeLogistics = v;
        labels.push(`${KEY_LABEL[key]}: ${v ? "nyala" : "mati"}`);
      } else if (key === "step" || key === "months") {
        const v = Number(action.value);
        if (!Number.isFinite(v) || v <= 0) continue;
        assumptions[key] = key === "step" ? Math.min(100000, Math.round(v)) : Math.min(60, Math.round(v));
        labels.push(`${KEY_LABEL[key]}: ${assumptions[key]}`);
      } else {
        let v = Number(action.value);
        if (!Number.isFinite(v)) continue;
        if (v > 1) v = v / 100;
        v = Math.max(0, Math.min(0.9, v));
        (assumptions[key] as number) = v;
        labels.push(`${KEY_LABEL[key]}: ${pct(v)}`);
      }
    } else if (action.type === "item") {
      const item = items.find((x) => x.lineNo === Number(action.no));
      if (!item) continue;
      if (action.field === "role") {
        const v = String(action.value).toUpperCase();
        if (!["LEADER", "CORE", "PROFIT"].includes(v)) continue;
        labels.push(`${item.name}: role jadi ${v}`);
        item.role = v as typeof item.role;
      } else if (["qty", "cogs", "rrp"].includes(String(action.field))) {
        const v = Number(action.value);
        if (!Number.isFinite(v) || v < 0) continue;
        labels.push(`${item.name}: ${action.field} jadi ${v}`);
        (item as unknown as Record<string, number>)[String(action.field)] = v;
        if (action.field === "cogs") item.estCogs = false;
      }
    } else if (action.type === "scenario") {
      const v = Number(action.value);
      if ([1, 2, 3].includes(v)) {
        scenario = (v - 1) as ScenarioIndex;
        labels.push(`Skenario jadi S${v}`);
      }
    }
  }

  return { snapshot: { ...snapshot, assumptions, items, scenario }, labels };
}
