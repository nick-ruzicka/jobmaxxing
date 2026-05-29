"use client";

/**
 * ClientProviders — root-layout-level wrapper for client-side providers.
 * Mounts the global chat panel + provides the ChatContext to all children.
 *
 * Why this exists: app/layout.tsx is a server component (no React state).
 * Anything that needs state or interactive event handlers (like the chat
 * panel) has to be inside a client component. ClientProviders is that
 * boundary — it wraps children in <ChatProvider> and renders the
 * <GlobalChatPanel> sibling so it can read the same context.
 *
 * Add new global providers (toast, dialog, scan, etc.) here by composing them
 * around children. Order matters when providers depend on each other.
 */

import type { ReactNode } from "react";
import { ChatProvider } from "@/components/ChatContext";
import { GlobalChatPanel } from "@/components/GlobalChatPanel";

export function ClientProviders({ children }: { children: ReactNode }) {
  return (
    <ChatProvider>
      {children}
      <GlobalChatPanel />
    </ChatProvider>
  );
}
