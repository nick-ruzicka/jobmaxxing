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
import { X, Send, Loader2, ChevronRight, AlertTriangle, Check } from "lucide-react";
import type { BriefingItem } from "@/lib/types";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  item_context?: Record<string, unknown>;
  ts: string;
}

/** Mutating-tool confirmation card payload. Mirrors what the server emits
 *  as the `tool_request` SSE event (or the `pending` field on GET /api/chat
 *  for hydration after a page refresh). */
interface PendingTool {
  tool_call_id: string;
  name: string;
  input: Record<string, unknown>;
  preview: string;
}

/** Callbacks the SSE consumer dispatches as it reads the chat stream.
 *  Factored out so handleSend (fresh turn) and handleRespondToTool (resume)
 *  can share the same parse loop. */
interface StreamCallbacks {
  onDelta: (text: string) => void;
  onToolRequest: (req: PendingTool) => void;
  onToolResolved: (action: "confirm" | "cancel") => void;
  onPaused: () => void;
  onDone: (history: ChatMessage[]) => void;
}

/** Parse the chat SSE stream and dispatch events to the supplied callbacks.
 *  Throws on transport / parsing errors. The caller owns history updates,
 *  spinner state, and error handling. */
async function consumeChatStream(res: Response, cbs: StreamCallbacks): Promise<void> {
  if (!res.body) throw new Error("Streaming response had no body");
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
        cbs.onDelta(obj.text);
      } else if (obj.type === "tool_request") {
        cbs.onToolRequest({
          tool_call_id: String(obj.id ?? ""),
          name: String(obj.name ?? ""),
          input: (obj.input as Record<string, unknown>) ?? {},
          preview: String(obj.preview ?? ""),
        });
      } else if (obj.type === "tool_resolved") {
        const action = obj.action === "confirm" ? "confirm" : "cancel";
        cbs.onToolResolved(action);
      } else if (obj.type === "paused") {
        cbs.onPaused();
        // paused signals the server ended the stream intentionally at a
        // confirmation gate. The pending state is already in pendingTool via
        // onToolRequest; we just stop reading.
        streamDone = true;
      } else if (obj.type === "done") {
        if (Array.isArray(obj.history)) cbs.onDone(obj.history as ChatMessage[]);
        streamDone = true;
      } else if (obj.type === "error") {
        throw new Error(typeof obj.message === "string" ? obj.message : "stream failed");
      }
    }
  }
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
  // Confirmation-card state. Non-null means the chat stream paused at a
  // mutating tool; user must confirm or cancel before more messages can flow.
  // Hydrated from GET /api/chat on mount so a page refresh re-renders the
  // card. Cleared on confirm/cancel resolution and on a new user message.
  const [pendingTool, setPendingTool] = useState<PendingTool | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  // Disables both confirm/cancel buttons + the composer while we're round-
  // tripping the POST /api/chat/respond-to-tool stream.
  const [respondingTo, setRespondingTo] = useState<"confirm" | "cancel" | null>(null);
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

  // Hydrate history (and any pending confirmation) from disk when the panel
  // opens or the day changes.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/chat?date=${date}`);
        if (!res.ok) throw new Error(`GET /api/chat returned ${res.status}`);
        const body = await res.json();
        if (cancelled) return;
        setHistory(Array.isArray(body.history) ? body.history : []);
        if (body.pending) {
          setPendingTool({
            tool_call_id: String(body.pending.tool_call_id ?? ""),
            name: String(body.pending.name ?? ""),
            input: (body.pending.input as Record<string, unknown>) ?? {},
            preview: String(body.pending.preview ?? ""),
          });
        } else {
          setPendingTool(null);
        }
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

  /** Append a delta chunk to the current assistant placeholder (the last
   *  message). Both fresh sends and confirmation resumes share this. */
  function appendDeltaToPlaceholder(chunk: string) {
    setHistory((prev) => {
      const next = prev.slice();
      const last = next[next.length - 1];
      if (last && last.role === "assistant") {
        next[next.length - 1] = { ...last, content: last.content + chunk };
      }
      return next;
    });
  }

  async function handleSend() {
    const message = input.trim();
    if (!message || thinking || respondingTo) return;

    // A new user message supersedes any unresolved confirmation. The server
    // discards pending state on POST /api/chat — mirror that locally so the
    // confirmation card disappears.
    setPendingTool(null);
    setCancelReason("");
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

      await consumeChatStream(res, {
        onDelta: appendDeltaToPlaceholder,
        onToolRequest: (req) => setPendingTool(req),
        // tool_resolved doesn't fire on a fresh POST (no prior pending), but
        // the callback is required by the shared shape.
        onToolResolved: () => {},
        onPaused: () => {
          // Stream ended at a confirmation gate. The pending placeholder
          // stays in history with whatever partial text streamed before the
          // pause; the card UI takes over below.
        },
        onDone: (newHistory) => setHistory(newHistory),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Send failed");
      rollback();
    } finally {
      setThinking(false);
    }
  }

  async function handleRespondToTool(action: "confirm" | "cancel") {
    if (!pendingTool || respondingTo) return;
    setRespondingTo(action);
    setError(null);

    const tool_call_id = pendingTool.tool_call_id;
    const reason = action === "cancel" ? cancelReason.trim() || undefined : undefined;

    // Ensure there's an assistant placeholder for incoming deltas. After
    // hydration from refresh, the last message in history is the user message
    // that triggered the pause — no assistant placeholder yet. Add one. On
    // mid-session confirmation the placeholder is already there (from the
    // original POST that paused) and we reuse it.
    setHistory((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.role === "assistant") return prev;
      return [...prev, { role: "assistant", content: "", ts: new Date().toISOString() }];
    });

    try {
      const res = await fetch("/api/chat/respond-to-tool", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, tool_call_id, action, reason }),
      });

      const contentType = res.headers.get("Content-Type") ?? "";
      if (!res.ok || !contentType.includes("text/event-stream")) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? `POST /api/chat/respond-to-tool returned ${res.status}`);
      }

      await consumeChatStream(res, {
        onDelta: appendDeltaToPlaceholder,
        onToolRequest: (req) => setPendingTool(req),
        onToolResolved: () => {
          // First event off the resume stream — server confirms it applied
          // the decision. Dismiss the card; the agent's follow-up text will
          // arrive via deltas next.
          setPendingTool(null);
          setCancelReason("");
        },
        onPaused: () => {
          // The agent's follow-up itself hit another confirmation gate.
          // pendingTool was already updated via onToolRequest; we just stop.
        },
        onDone: (newHistory) => {
          setHistory(newHistory);
          setPendingTool(null);
          setCancelReason("");
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Confirmation failed");
    } finally {
      setRespondingTo(null);
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

        {/* Confirmation card — shown when the agent's last tool call is a
            mutation awaiting user approval. Two-phase pattern from the
            write-path map: agent proposes → user reviews + decides → server
            executes (or feeds back a synthetic decline). Until resolved, the
            composer is disabled to make the gate explicit. */}
        {pendingTool && (
          <div
            role="region"
            aria-label="Confirm agent action"
            className="border-t border-amber-border bg-amber-dim px-4 py-3"
          >
            <div className="flex items-start gap-2">
              <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber" aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="text-[12px] font-semibold text-text-primary">
                  Confirm action
                  <span className="ml-1.5 font-mono text-[11px] text-text-tertiary">
                    {pendingTool.name}
                  </span>
                </div>
                <pre className="mt-1.5 whitespace-pre-wrap break-words font-sans text-[12px] leading-relaxed text-text-secondary">
                  {pendingTool.preview}
                </pre>
                <input
                  type="text"
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  placeholder="(optional) reason if cancelling"
                  disabled={respondingTo !== null}
                  className="mt-2 w-full rounded-md border border-border-subtle bg-surface-1 px-2 py-1 text-[12px] text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-60"
                />
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => handleRespondToTool("confirm")}
                    disabled={respondingTo !== null}
                    className="inline-flex items-center gap-1 rounded-md border border-accent-border bg-accent-dim px-2.5 py-1 text-[12px] font-medium text-accent transition-colors hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {respondingTo === "confirm" ? (
                      <Loader2 size={12} className="animate-spin" aria-hidden />
                    ) : (
                      <Check size={12} aria-hidden />
                    )}
                    Confirm
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRespondToTool("cancel")}
                    disabled={respondingTo !== null}
                    className="inline-flex items-center gap-1 rounded-md border border-red-border bg-red-dim px-2.5 py-1 text-[12px] font-medium text-red transition-colors hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {respondingTo === "cancel" ? (
                      <Loader2 size={12} className="animate-spin" aria-hidden />
                    ) : (
                      <X size={12} aria-hidden />
                    )}
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

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
              placeholder={
                pendingTool
                  ? "Resolve the pending action above to send a new message…"
                  : "Ask about a role, the pipeline, or today's items…"
              }
              disabled={thinking || respondingTo !== null || pendingTool !== null}
              className="min-h-[48px] flex-1 resize-none rounded-md border border-border-subtle bg-surface-1 px-3 py-2 text-[13px] text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-60"
            />
            <button
              type="button"
              onClick={handleSend}
              disabled={thinking || !input.trim() || respondingTo !== null || pendingTool !== null}
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
