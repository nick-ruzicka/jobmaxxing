"use client";

/**
 * A filter pill that opens a popover with a checkbox list of grouped options.
 *
 * Visual signature is intentionally identical to FilterBar's local `Chip` —
 * same height, radius, font, and active/idle palette — so a row mixing
 * Chips and DropdownPills reads as a single control. The only addition is a
 * 12px chevron at the right that rotates 180° when the popover is open.
 *
 * Used wherever a chip group would otherwise overflow horizontally (e.g.
 * location buckets beyond NYC/Remote get collapsed into "More locations").
 */

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

export type DropdownPillOption = {
  id: string;
  label: string;
  /** Optional trailing count next to the option label. */
  count?: number;
  /** Selected state. Parent owns this — the component is fully controlled. */
  active?: boolean;
};

type DropdownPillProps = {
  label: string;
  /** Numeric badge inside the pill (typically the count of active options).
   *  Omit or set to 0 to hide. */
  count?: number;
  options: DropdownPillOption[];
  /** Fires with the full set of active IDs after a toggle. */
  onChange: (activeIds: string[]) => void;
  /** Which edge of the trigger the popover anchors to. Default: "left". */
  align?: "left" | "right";
  /** Close the popover after a single selection. Default: false (multi). */
  closeOnSelect?: boolean;
  className?: string;
};

export function DropdownPill({
  label,
  count,
  options,
  onChange,
  align = "left",
  closeOnSelect = false,
  className = "",
}: DropdownPillProps) {
  const [open, setOpen] = useState(false);
  const [focusIdx, setFocusIdx] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();

  const hasActive = useMemo(() => options.some((o) => o.active), [options]);

  function toggle(id: string) {
    // Rebuild the active-id set from current props + the flip on `id`.
    const next = options
      .filter((o) => (o.id === id ? !o.active : o.active))
      .map((o) => o.id);
    onChange(next);
    if (closeOnSelect) {
      setOpen(false);
      triggerRef.current?.focus();
    }
  }

  // Outside click + Escape — only when open, to avoid global listener churn.
  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onDocKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onDocKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onDocKeyDown);
    };
  }, [open]);

  // On open, point focus at the first active option (or 0 if none active).
  // Deliberately not depending on `options` so a toggle inside the popover
  // doesn't yank focus.
  useEffect(() => {
    if (!open) return;
    const firstActive = options.findIndex((o) => o.active);
    setFocusIdx(firstActive >= 0 ? firstActive : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Move DOM focus to the focused option whenever focusIdx changes while open.
  useEffect(() => {
    if (!open) return;
    const items = listRef.current?.querySelectorAll<HTMLLIElement>("[role='option']");
    items?.[focusIdx]?.focus();
  }, [open, focusIdx]);

  function onTriggerKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
    // ArrowDown opens and lands on the first option — standard listbox combobox behavior.
    if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !open) {
      e.preventDefault();
      setOpen(true);
    }
  }

  function onListKeyDown(e: React.KeyboardEvent<HTMLUListElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocusIdx((i) => Math.min(i + 1, options.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Home") {
      e.preventDefault();
      setFocusIdx(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setFocusIdx(options.length - 1);
    } else if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      const opt = options[focusIdx];
      if (opt) toggle(opt.id);
    } else if (e.key === "Tab") {
      // Tabbing out of the popover closes it without trapping focus.
      setOpen(false);
    }
  }

  return (
    <div ref={rootRef} className={`relative inline-block ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onTriggerKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[12px] font-medium transition-colors ${
          hasActive
            ? "border-accent-border bg-accent-dim text-accent"
            : "border-border-subtle bg-surface-2 text-text-tertiary hover:bg-surface-3 hover:text-text-secondary"
        }`}
      >
        <span>{label}</span>
        {typeof count === "number" && count > 0 && (
          <span aria-hidden className="tabular-nums opacity-70">·</span>
        )}
        {typeof count === "number" && count > 0 && (
          <span className="tabular-nums">{count}</span>
        )}
        <ChevronDown
          size={12}
          aria-hidden
          className={`shrink-0 transition-transform duration-150 ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div
          className={`absolute z-50 mt-1 min-w-[200px] overflow-hidden rounded-md border border-border-default bg-surface-2 shadow-1 ${
            align === "right" ? "right-0" : "left-0"
          }`}
          role="presentation"
        >
          <ul
            id={listId}
            ref={listRef}
            role="listbox"
            aria-multiselectable={!closeOnSelect}
            aria-label={label}
            onKeyDown={onListKeyDown}
            className="max-h-[280px] overflow-y-auto py-1 outline-none"
          >
            {options.length === 0 ? (
              <li className="px-3 py-2 text-[12px] text-text-muted" role="presentation">
                No options
              </li>
            ) : (
              options.map((opt, idx) => {
                const focused = idx === focusIdx;
                return (
                  <li
                    key={opt.id}
                    role="option"
                    aria-selected={!!opt.active}
                    tabIndex={focused ? 0 : -1}
                    onClick={() => toggle(opt.id)}
                    onMouseEnter={() => setFocusIdx(idx)}
                    className={`flex cursor-pointer select-none items-center gap-2 px-3 py-1.5 text-[13px] outline-none ${
                      focused
                        ? "bg-surface-3 text-text-primary"
                        : "text-text-secondary hover:bg-surface-3 hover:text-text-primary"
                    }`}
                  >
                    <span
                      aria-hidden
                      className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] border ${
                        opt.active
                          ? "border-accent bg-accent text-white"
                          : "border-border-default bg-surface-1"
                      }`}
                    >
                      {opt.active && (
                        <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                          <path
                            d="M2 6.5 5 9.5 10 3.5"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      )}
                    </span>
                    <span className="flex-1 truncate">{opt.label}</span>
                    {typeof opt.count === "number" && (
                      <span className="shrink-0 tabular-nums text-[12px] text-text-muted">
                        {opt.count}
                      </span>
                    )}
                  </li>
                );
              })
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
