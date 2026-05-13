"use client";

import { useEffect, useRef } from "react";
import { X, Terminal } from "lucide-react";

interface TerminalDrawerProps {
  open: boolean;
  output: string;
  onClose: () => void;
  running: boolean;
}

export function TerminalDrawer({ open, output, onClose, running }: TerminalDrawerProps) {
  const scrollRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [output]);

  if (!open) return null;

  return (
    <div
      className="fixed bottom-0 left-60 right-0 z-30"
      style={{ background: "var(--surface-0)", borderTop: "1px solid var(--border-default)", boxShadow: "var(--shadow-xl)" }}
    >
      <div
        className="flex items-center justify-between px-4 py-2"
        style={{ borderBottom: "1px solid var(--border-subtle)" }}
      >
        <div className="flex items-center gap-2 text-[12px]" style={{ color: "var(--text-tertiary)" }}>
          <Terminal size={13} />
          <span>{running ? "Scan running..." : "Scan complete"}</span>
          {running && <span className="h-1.5 w-1.5 rounded-full animate-pulse" style={{ background: "var(--emerald)" }} />}
        </div>
        <button
          onClick={onClose}
          className="rounded p-1 transition-colors"
          style={{ color: "var(--text-muted)" }}
        >
          <X size={13} />
        </button>
      </div>
      <pre
        ref={scrollRef}
        className="h-48 overflow-y-auto px-4 py-3 text-[12px] leading-relaxed"
        style={{ color: "var(--emerald)", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
      >
        {output || "Starting scan..."}
      </pre>
    </div>
  );
}
