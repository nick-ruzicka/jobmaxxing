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
    <div className="fixed bottom-0 left-60 right-0 z-30 border-t border-border-default bg-surface-0 shadow-1">
      <div className="flex items-center justify-between border-b border-border-subtle px-4 py-2">
        <div className="flex items-center gap-2 text-[12px] text-text-tertiary">
          <Terminal size={13} />
          <span>{running ? "Scan running…" : "Scan complete"}</span>
          {running && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald" />}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close terminal"
          className="rounded-sm p-1 text-text-muted transition-colors hover:bg-surface-3 hover:text-text-secondary"
        >
          <X size={13} />
        </button>
      </div>
      <pre ref={scrollRef} className="h-48 overflow-y-auto px-4 py-3 font-mono text-[12px] leading-relaxed text-emerald">
        {output || "Starting scan…"}
      </pre>
    </div>
  );
}
