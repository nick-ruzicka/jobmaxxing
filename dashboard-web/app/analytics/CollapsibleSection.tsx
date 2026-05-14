"use client";

/**
 * CollapsibleSection — the workhorse container for the /analytics page.
 *
 * - Header is always visible, body folds in/out with state persisted to
 *   localStorage keyed by `id`. Refreshing the page or navigating away and
 *   back restores the user's prior open/closed preference.
 * - Header reads like a Linear section: SectionLabel + optional count chip +
 *   subtitle, with a chevron that rotates to indicate state.
 * - Uses design tokens; no shadows; matches existing Anomalies banner pattern.
 *
 * Usage:
 *   <CollapsibleSection
 *     id="source-perf"
 *     title="Source performance"
 *     subtitle="118 sources · top: builtin.com (51% hit)"
 *     count={118}
 *     defaultOpen={false}
 *   >
 *     ...content...
 *   </CollapsibleSection>
 */

import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import { SectionLabel } from "@/components/ui/SectionLabel";

interface CollapsibleSectionProps {
  /** Stable identifier used as the localStorage key — KEEP THIS STABLE across deploys. */
  id: string;
  title: string;
  subtitle?: ReactNode;
  /** Numeric chip rendered next to the title. Omit / 0 to hide. */
  count?: number;
  defaultOpen?: boolean;
  /** Force a forced-color (e.g., red for anomalies). Optional. */
  toneColor?: "red" | "amber" | "emerald" | "neutral";
  children: ReactNode;
}

const STORAGE_PREFIX = "analytics:section:";

export function CollapsibleSection({
  id,
  title,
  subtitle,
  count,
  defaultOpen = false,
  toneColor,
  children,
}: CollapsibleSectionProps) {
  // Start with the default so SSR matches; hydrate the stored value once.
  const [open, setOpen] = useState(defaultOpen);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let next: boolean | null = null;
    try {
      const stored = window.localStorage.getItem(STORAGE_PREFIX + id);
      if (stored === "open") next = true;
      else if (stored === "closed") next = false;
    } catch {
      /* localStorage blocked — fall back to defaultOpen */
    }
    if (next !== null) {
      // localStorage hydration is the recognized escape hatch for
      // react-hooks/set-state-in-effect: the page is `"use client"` and the
      // alternative (useSyncExternalStore against a non-eventful API) is
      // measurably uglier. Section starts at defaultOpen on first paint, then
      // opens after hydration if the user previously left it open.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOpen(next);
    }
    setHydrated(true);
  }, [id]);

  useEffect(() => {
    if (!hydrated || typeof window === "undefined") return;
    try {
      window.localStorage.setItem(STORAGE_PREFIX + id, open ? "open" : "closed");
    } catch {
      /* localStorage blocked — silently skip persistence */
    }
  }, [hydrated, id, open]);

  const toneBg =
    toneColor === "red"
      ? "border-red-border bg-red-dim/40"
      : toneColor === "amber"
        ? "border-amber-border bg-amber-dim/30"
        : toneColor === "emerald"
          ? "border-emerald-border bg-emerald-dim/40"
          : "border-border-subtle bg-surface-2";

  return (
    <section className={`overflow-hidden rounded-lg border ${toneBg}`}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
        aria-expanded={open}
      >
        <div className="flex items-center gap-3">
          <SectionLabel className="mb-0">{title}</SectionLabel>
          {typeof count === "number" && count > 0 && (
            <Badge color="neutral">{count.toLocaleString("en-US")}</Badge>
          )}
          {subtitle && (
            <span className="text-[12px] text-text-muted">{subtitle}</span>
          )}
        </div>
        {open ? (
          <ChevronDown className="h-4 w-4 text-text-tertiary" />
        ) : (
          <ChevronRight className="h-4 w-4 text-text-tertiary" />
        )}
      </button>
      {open && (
        <div className="border-t border-border-subtle px-4 py-4">{children}</div>
      )}
    </section>
  );
}
