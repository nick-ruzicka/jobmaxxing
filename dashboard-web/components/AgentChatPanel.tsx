"use client";

/**
 * The chat surface that lives behind the "Ask agent" button on /today and
 * the chevrons on every BriefingItem. Right-side, 480px-wide slide-in panel,
 * full viewport height. Turn-based (no streaming) — user types, hits send,
 * sees "Thinking…" for ~2-5s, response renders.
 *
 * History is per-day, stored at data/chats/<date>.json via /api/chat. On mount
 * (and whenever `date` changes), the panel GETs the day's history. Reloading
 * the page restores the conversation; new day = new chat session.
 *
 * The optional `itemContext` payload is what the chevron path carries — it's
 * sent with the first message the user types after opening (and only the
 * first; the agent has it in conversation context after that).
 */

import { useEffect, useRef, useState } from "react";
import { X, Send, Loader2, ChevronRight } from "lucide-react";
import type { BriefingItem } from "@/lib/types";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  item_context?: Record<string, unknown>;
  ts: string;
}

interface AgentChatPanelProps {
  /** Whether the panel is open. Parent controls the toggle. */
  open: boolean;
  onClose: () => void;
  /** YYYY-MM-DD — keys both the briefing context and the persistence file. */
  date: string;
  /** When the panel was opened via a BriefingItem chevron, the item flows
   *  through here so the panel can render "About: <title>" and attach the
   *  item's context to the first user message. */
  scopedItem?: BriefingItem | null;
}

export function AgentChatPanel({ open, onClose, date, scopedItem }: AgentChatPanelProps) {
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // True until we've successfully attached this scoped item to a message —
  // after that, the agent has it in conversation context and we don't keep
  // re-sending it.
  const scopedItemPending = useRef<BriefingItem | null>(scopedItem ?? null);
  const listEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Reset the scoped-item pointer whenever the panel re-opens or the item
  // changes — old context shouldn't bleed into a new chevron click.
  useEffect(() => {
    scopedItemPending.current = scopedItem ?? null;
  }, [scopedItem, open]);

  // Hydrate history from disk when the panel opens or the day changes.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/chat?date=${date}`);
        if (!res.ok) throw new Error(`GET /api/chat returned ${res.status}`);
        const body = await res.json();
        if (!cancelled) setHistory(Array.isArray(body.history) ? body.history : []);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Couldn't load history");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, date]);

  // Auto-scroll to bottom on new messages / thinking.
  useEffect(() => {
    if (!open) return;
    listEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [history, thinking, open]);

  // Focus the input when opening (after the slide-in animation completes —
  // a small delay avoids the focus ring flashing pre-position).
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => inputRef.current?.focus(), 240);
    return () => window.clearTimeout(t);
  }, [open]);

  // ESC to close — wired here rather than relying on form-control behavior
  // because the textarea swallows ESC by default in some browsers.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  async function handleSend() {
    const message = input.trim();
    if (!message || thinking) return;

    setError(null);
    setInput("");
    setThinking(true);

    // Optimistic append of the user message + an empty assistant placeholder
    // that the streaming loop fills in token-by-token.
    const itemContext = scopedItemPending.current?.context;
    const ts = new Date().toISOString();
    const optimisticUser: ChatMessage = { role: "user", content: message, item_context: itemContext, ts };
    const placeholder: ChatMessage = { role: "assistant", content: "", ts };
    setHistory((prev) => [...prev, optimisticUser, placeholder]);
    // Item context has now been "attached" to a message — don't send again.
    scopedItemPending.current = null;

    function rollback() {
      setHistory((prev) => prev.filter((m) => m !== optimisticUser && m !== placeholder));
    }

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, message, item_context: itemContext }),
      });

      // Non-OK responses + non-streaming JSON errors (402 credits exhausted)
      // come back as JSON, not SSE. Detect via Content-Type.
      const contentType = res.headers.get("Content-Type") ?? "";
      if (!res.ok || !contentType.includes("text/event-stream")) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? `POST /api/chat returned ${res.status}`);
      }
      if (!res.body) throw new Error("Streaming response had no body");

      // Stream loop: parse SSE events, append deltas to the placeholder
      // message in place, swap to the authoritative server history on done.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let streamDone = false;
      while (!streamDone) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";
        for (const ev of events) {
          const dataLine = ev.split("\n").find((l) => l.startsWith("data: "));
          if (!dataLine) continue;
          let payload: unknown;
          try {
            payload = JSON.parse(dataLine.slice(6));
          } catch {
            continue;
          }
          const obj = payload as Record<string, unknown>;
          if (obj.type === "delta" && typeof obj.text === "string") {
            const chunk = obj.text;
            setHistory((prev) => {
              // Append to the LAST message (the placeholder). Don't touch
              // anything else.
              const next = prev.slice();
              const last = next[next.length - 1];
              if (last && last.role === "assistant") {
                next[next.length - 1] = { ...last, content: last.content + chunk };
              }
              return next;
            });
          } else if (obj.type === "done") {
            if (Array.isArray(obj.history)) {
              setHistory(obj.history as ChatMessage[]);
            }
            streamDone = true;
          } else if (obj.type === "error") {
            throw new Error(typeof obj.message === "string" ? obj.message : "stream failed");
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Send failed");
      rollback();
    } finally {
      setThinking(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends; Shift+Enter inserts a newline (standard chat-input pattern).
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <>
      {/* Backdrop — only visible on smaller screens (lg+ is side-by-side,
          no dim overlay needed). Clicking it closes the panel. */}
      <button
        type="button"
        aria-hidden={!open}
        tabIndex={-1}
        onClick={onClose}
        className={`fixed inset-0 z-40 bg-black/40 transition-opacity duration-200 lg:hidden ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />

      {/* Panel — slides in from the right via transform. translate-x-full
          when closed, translate-x-0 when open. The width is fixed at 480px;
          on screens narrower than that, max-w-[100vw] kicks in. */}
      <aside
        aria-label="Agent chat"
        className={`fixed right-0 top-0 z-50 flex h-screen w-[480px] max-w-[100vw] flex-col border-l border-border-subtle bg-surface-1 shadow-xl transition-transform duration-200 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <header className="flex items-center justify-between gap-3 border-b border-border-subtle bg-surface-2 px-4 py-3">
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-text-primary">Ask the agent</div>
            {scopedItem && (
              <div className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-text-tertiary">
                <ChevronRight size={11} className="shrink-0 text-text-muted" />
                <span className="truncate">About: {scopedItem.title}</span>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-text-tertiary transition-colors hover:bg-surface-3 hover:text-text-primary"
            aria-label="Close chat"
            title="Close (Esc)"
          >
            <X size={16} />
          </button>
        </header>

        {/* Message list */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {history.length === 0 && !thinking ? (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <p className="max-w-xs text-[13px] text-text-secondary">
                Ask anything about today&apos;s briefing, or about specific roles.
              </p>
              {scopedItem && (
                <p className="mt-3 text-[11px] text-text-muted">
                  The agent already has the item context — just type your question.
                </p>
              )}
            </div>
          ) : (
            <ul className="space-y-3">
              {history.map((m, idx) => (
                <li key={idx} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
                  <div
                    className={`max-w-[85%] rounded-lg px-3 py-2 text-[13px] leading-relaxed ${
                      m.role === "user"
                        ? "bg-accent-dim text-text-primary"
                        : "bg-surface-2 text-text-secondary"
                    }`}
                  >
                    {m.content.split("\n").map((line, i) => (
                      <p key={i} className={i > 0 ? "mt-2" : ""}>
                        {line}
                      </p>
                    ))}
                  </div>
                </li>
              ))}
              {/* "Thinking…" only shows BEFORE the first streaming token
                  arrives. Once the assistant placeholder has content, the
                  partial response is visible in the message list and the
                  spinner duplicates the signal. The placeholder is the last
                  message and has role="assistant" + empty content while
                  pending. */}
              {thinking
                && history[history.length - 1]?.role === "assistant"
                && history[history.length - 1]?.content === ""
                && (
                <li className="flex justify-start">
                  <div className="inline-flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 text-[13px] text-text-tertiary">
                    <Loader2 size={13} className="animate-spin" aria-hidden />
                    Thinking…
                  </div>
                </li>
              )}
            </ul>
          )}
          <div ref={listEndRef} aria-hidden />
        </div>

        {/* Error banner — transient, replaced on next send attempt. */}
        {error && (
          <div
            role="alert"
            className="border-t border-red-border bg-red-dim px-4 py-2 text-[12px] text-red"
          >
            {error}
          </div>
        )}

        {/* Composer */}
        <div className="border-t border-border-subtle bg-surface-2 px-3 py-3">
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={2}
              placeholder="Ask about a role, the pipeline, or today's items…"
              disabled={thinking}
              className="min-h-[48px] flex-1 resize-none rounded-md border border-border-subtle bg-surface-1 px-3 py-2 text-[13px] text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-60"
            />
            <button
              type="button"
              onClick={handleSend}
              disabled={thinking || !input.trim()}
              className="inline-flex h-[48px] items-center gap-1 rounded-md border border-accent-border bg-accent-dim px-3 text-[13px] font-medium text-accent transition-colors hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-50"
              title="Send (Enter)"
            >
              <Send size={14} />
              Send
            </button>
          </div>
          <div className="mt-1 text-[11px] text-text-muted">
            Enter to send · Shift+Enter for newline · Esc to close
          </div>
        </div>
      </aside>
    </>
  );
}
