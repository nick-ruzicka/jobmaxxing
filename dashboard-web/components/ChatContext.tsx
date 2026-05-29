"use client";

/**
 * ChatContext — global open/closed + scoped-item state for the agent chat
 * panel. Lands the AI feature audit Step 1 (move AgentChatPanel to root layout
 * so it follows the user across all routes). Anywhere in the app can call
 * `useChat().openChat(item?)` to open the panel; the panel reads its open
 * state + scopedItem from this context instead of per-page React state.
 *
 * Date handling: defaults to today's ISO date string (YYYY-MM-DD). Pages with
 * a specific briefing day in scope (e.g. /pipeline viewing today's briefing)
 * don't need to override — chat persistence file is per-day and today's date
 * is always correct for the active session.
 *
 * Cmd+K (or Ctrl+K on non-Mac) opens the chat with no scoped item — see
 * GlobalChatPanel.tsx for the binding. Esc closes (handled inside
 * AgentChatPanel).
 */

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { BriefingItem } from "@/lib/types";

interface ChatContextValue {
  /** Whether the chat panel is currently open. */
  open: boolean;
  /** When set, the panel renders "About: <title>" and attaches the item's
   *  context to the first user message. Cleared on closeChat(). */
  scopedItem: BriefingItem | null;
  /** Open the chat panel. Optional argument scopes it to a briefing item
   *  (chevron-path); omitted = scoped to the briefing as a whole. */
  openChat: (item?: BriefingItem | null) => void;
  /** Close the chat panel and clear the scoped item. */
  closeChat: () => void;
}

const ChatContext = createContext<ChatContextValue | null>(null);

export function ChatProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [scopedItem, setScopedItem] = useState<BriefingItem | null>(null);

  const openChat = useCallback((item?: BriefingItem | null) => {
    setScopedItem(item ?? null);
    setOpen(true);
  }, []);

  const closeChat = useCallback(() => {
    setOpen(false);
    setScopedItem(null);
  }, []);

  const value = useMemo<ChatContextValue>(
    () => ({ open, scopedItem, openChat, closeChat }),
    [open, scopedItem, openChat, closeChat],
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

/** Hook for opening / closing the global chat panel + reading its state. */
export function useChat(): ChatContextValue {
  const ctx = useContext(ChatContext);
  if (!ctx) {
    throw new Error(
      "useChat() called outside <ChatProvider>. " +
      "Make sure dashboard-web/app/layout.tsx wraps its children in <ClientProviders>.",
    );
  }
  return ctx;
}
