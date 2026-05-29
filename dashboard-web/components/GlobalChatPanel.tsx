"use client";

/**
 * GlobalChatPanel — mounts the AgentChatPanel at root-layout level and binds
 * Cmd+K (Mac) / Ctrl+K (Linux/Win) to open it. Lives inside <ChatProvider>;
 * reads open/scopedItem from ChatContext instead of per-page state.
 *
 * Date: defaults to today's ISO date string. The chat persistence is per-day,
 * so this matches the active session.
 *
 * Lands AI feature audit Step 1 (chat-follows-user). The mobile-responsive
 * pass + drawer-vs-dock decision are deferred to a follow-up PR — for now
 * the panel keeps the existing 480px right-side slide-in shape.
 */

import { useEffect } from "react";
import { AgentChatPanel } from "@/components/AgentChatPanel";
import { useChat } from "@/components/ChatContext";

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function GlobalChatPanel() {
  const { open, scopedItem, openChat, closeChat } = useChat();

  // Cmd+K / Ctrl+K to open chat with no scoped item. Esc closes the panel
  // (handled inside AgentChatPanel). Guarded against running while the user
  // is typing in another input — if focus is in a form field, don't intercept.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "k" && e.key !== "K") return;
      if (!(e.metaKey || e.ctrlKey)) return;
      const active = document.activeElement;
      // Allow Cmd+K inside our own chat textarea (Esc closes; Cmd+K toggles
      // is overkill — but also harmless since openChat is idempotent on open).
      if (
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        active instanceof HTMLSelectElement
      ) {
        // Only let the shortcut work outside form controls; inside, let the
        // user type "k" without hijacking. Browsers typically don't fire
        // Cmd+K inside a contenteditable either, so this covers the cases.
        return;
      }
      e.preventDefault();
      openChat(null);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openChat]);

  return (
    <AgentChatPanel
      open={open}
      onClose={closeChat}
      date={todayISO()}
      scopedItem={scopedItem}
    />
  );
}
