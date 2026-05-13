"use client";

import { useState, useRef, useEffect } from "react";
import { ChevronDown, Check } from "lucide-react";
import type { RoleStatus } from "@/lib/types";

const STATUS_OPTIONS: RoleStatus[] = [
  "Discovered", "Evaluated", "Applied", "Interview", "Offer", "Rejected", "Skipped",
];

const STATUS_COLOR: Record<RoleStatus, string> = {
  Discovered: "var(--text-muted)",
  Evaluated: "var(--accent)",
  Applied: "var(--violet)",
  Interview: "var(--blue)",
  Offer: "var(--emerald)",
  Rejected: "var(--red)",
  Skipped: "var(--text-muted)",
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
        className="inline-flex items-center gap-2 rounded-md px-2.5 py-1 text-xs font-medium transition-all"
        style={{
          background: "var(--surface-2)",
          border: "1px solid var(--border-subtle)",
          color: STATUS_COLOR[value],
        }}
      >
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ background: STATUS_COLOR[value] }}
        />
        {value}
        <ChevronDown size={10} style={{ color: "var(--text-muted)" }} />
      </button>

      {open && (
        <div
          className="absolute left-0 top-full z-50 mt-1 w-[150px] rounded-lg py-1"
          style={{
            background: "var(--surface-2)",
            border: "1px solid var(--border-default)",
            boxShadow: "var(--shadow-xl)",
          }}
        >
          {STATUS_OPTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => { onChange(s); setOpen(false); }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors"
              style={{
                color: s === value ? STATUS_COLOR[s] : "var(--text-tertiary)",
                background: s === value ? "var(--surface-3)" : "transparent",
              }}
              onMouseEnter={(e) => { if (s !== value) e.currentTarget.style.background = "var(--surface-3)"; }}
              onMouseLeave={(e) => { if (s !== value) e.currentTarget.style.background = "transparent"; }}
            >
              <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: STATUS_COLOR[s] }} />
              <span className="flex-1">{s}</span>
              {s === value && <Check size={11} style={{ color: "var(--accent)" }} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
