"use client";

import { useState, useRef, useEffect } from "react";
import { ChevronDown, Check } from "lucide-react";
import type { RoleStatus } from "@/lib/types";

const STATUS_OPTIONS: RoleStatus[] = [
  "Discovered", "Evaluated", "Applied", "Interview", "Offer", "Rejected", "Skipped",
];

// Dot color per status — Evaluated=accent (in progress), Applied=violet, Interview=blue,
// Offer=emerald, Rejected=red, Discovered/Skipped=neutral. Matches the DESIGN.md color table.
const STATUS_DOT: Record<RoleStatus, string> = {
  Discovered: "bg-text-muted",
  Evaluated: "bg-accent",
  Applied: "bg-violet",
  Interview: "bg-blue",
  Offer: "bg-emerald",
  Rejected: "bg-red",
  Skipped: "bg-text-muted",
};

export function StatusDropdown({ value, onChange }: { value: RoleStatus; onChange: (s: RoleStatus) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-border-subtle bg-surface-2 px-2 py-0.5 text-[12px] leading-tight text-text-secondary transition-colors hover:bg-surface-3"
      >
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[value]}`} />
        {value}
        <ChevronDown size={10} className="text-text-muted" />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-[160px] rounded-lg border border-border-default bg-surface-2 py-1 shadow-1">
          {STATUS_OPTIONS.map((s) => {
            const sel = s === value;
            return (
              <button
                key={s}
                type="button"
                onClick={() => { onChange(s); setOpen(false); }}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] transition-colors hover:bg-surface-3 ${sel ? "bg-surface-3 text-text-primary" : "text-text-tertiary"}`}
              >
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[s]}`} />
                <span className="flex-1">{s}</span>
                {sel && <Check size={11} className="text-accent" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
