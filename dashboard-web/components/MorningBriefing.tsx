"use client";

/**
 * The highest-priority surface on /pipeline (and /today). Surfaces concrete,
 * actionable items the user should attend to right now: today's interview,
 * a fresh-fit role that should be applied to, a stale follow-up, a missed
 * lead, etc.
 *
 * Status (2026-05-13): placeholder. Items are currently hard-coded so the
 * visual lands now; T4 will replace the sample data with agent-generated
 * suggestions. The component API is the contract — keep it stable.
 *
 * Visual: a warm-tinted hero card. Items separated by hairlines, action
 * links use the accent color. Empty state when items.length === 0.
 */

import {
  Calendar,
  Sparkles,
  Clock,
  Search,
  MapPin,
  ShieldCheck,
  RefreshCw,
  ArrowRight,
  Scale,
  AlertTriangle,
  GitBranch,
  Tag,
  Terminal,
  ChevronRight,
  Loader2,
} from "lucide-react";
import type { ComponentType, SVGProps } from "react";
import type { BriefingItem, BriefingItemType } from "@/lib/types";

// Re-export the types so existing callers that did
// `import { BriefingItem } from "@/components/MorningBriefing"` keep working.
export type { BriefingItem, BriefingItemType };

interface MorningBriefingProps {
  /** Concrete actions for today. Order matters — render top-to-bottom as-is. */
  items: BriefingItem[];
  /** When the briefing was generated. Shown as "Generated 2h ago" in the header. */
  lastGenerated?: Date;
  /** Regenerate handler. When omitted, the refresh button is hidden. */
  onRefresh?: () => void;
  /** While true, the refresh button shows a spinner + "Thinking…" label and is disabled. */
  refreshing?: boolean;
  /** "Ask agent about this item" — when set, each item renders a trailing chevron
   *  that calls this with the item. The /today + /sources pages wire this to the
   *  AgentChatPanel; pages without a chat panel pass nothing. */
  onItemAsk?: (item: BriefingItem, index: number) => void;
  /** Custom card title (defaults to "Today's Focus"). PipelineHealth uses
   *  "Pipeline Health" with a different accent tone. */
  title?: string;
  /** Header tone — "amber" (default, /today) or "blue" (/sources, system-maintainer view). */
  tone?: "amber" | "blue";
}

const ICONS: Record<BriefingItemType, ComponentType<SVGProps<SVGSVGElement> & { size?: number }>> = {
  interview: Calendar,
  apply: Sparkles,
  follow_up: Clock,
  missed: Search,
  stale: Clock,
  verify_location: MapPin,
  recalibrate: Scale,
  extractor_regression: AlertTriangle,
  new_pattern: GitBranch,
  label_opportunity: Tag,
  command_suggestion: Terminal,
};

const ICON_TONE: Record<BriefingItemType, string> = {
  interview: "text-accent",
  apply: "text-emerald",
  follow_up: "text-amber",
  missed: "text-violet",
  stale: "text-amber",
  verify_location: "text-blue",
  recalibrate: "text-violet",
  extractor_regression: "text-red",
  new_pattern: "text-blue",
  label_opportunity: "text-emerald",
  command_suggestion: "text-accent",
};

function relativeFromNow(d: Date): string {
  const ms = Date.now() - d.getTime();
  const mins = Math.round(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export function MorningBriefing({
  items,
  lastGenerated,
  onRefresh,
  refreshing = false,
  onItemAsk,
  title = "Today's Focus",
  tone = "amber",
}: MorningBriefingProps) {
  // Tone palette: amber (default, daily focus) vs blue (pipeline health). Mixed
  // inline via color-mix so we don't ship two near-identical CSS files.
  const toneVar = tone === "blue" ? "var(--color-blue)" : "var(--color-amber)";
  const HeaderIcon = tone === "blue" ? AlertTriangle : ShieldCheck;
  const headerIconClass = tone === "blue" ? "text-blue" : "text-amber";

  return (
    // Warm/cool tint: a very low-opacity wash. Reads as the highest-priority
    // surface without competing with the accent-fill hero stat tiles below.
    // Border picks up a faint same-hue bias for the same reason.
    <section
      className="rounded-lg border bg-surface-2 shadow-sm"
      style={{
        borderColor: `color-mix(in srgb, ${toneVar} 18%, var(--color-border-subtle))`,
        background: `linear-gradient(180deg, color-mix(in srgb, ${toneVar} 4%, var(--color-surface-2)) 0%, var(--color-surface-2) 100%)`,
      }}
      aria-label={title}
    >
      <header className="flex items-center justify-between gap-3 border-b border-border-subtle px-4 py-2.5">
        <div className="flex items-center gap-2">
          <HeaderIcon size={14} className={headerIconClass} aria-hidden />
          <h2 className="text-[13px] font-semibold tracking-[-0.01em] text-text-primary">
            {title}
          </h2>
          {lastGenerated && (
            <span className="text-[11px] tabular-nums text-text-muted">
              · Generated {relativeFromNow(lastGenerated)}
            </span>
          )}
        </div>
        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            className="inline-flex items-center gap-1 rounded-md border border-border-subtle bg-surface-3 px-2 py-0.5 text-[11px] font-medium text-text-tertiary transition-colors hover:bg-surface-4 hover:text-text-secondary disabled:cursor-wait disabled:opacity-60 disabled:hover:bg-surface-3"
            title={refreshing ? "Regenerating…" : "Regenerate briefing"}
            aria-busy={refreshing}
          >
            {refreshing ? (
              <>
                <Loader2 size={11} className="animate-spin" />
                Thinking…
              </>
            ) : (
              <>
                <RefreshCw size={11} />
                Refresh
              </>
            )}
          </button>
        )}
      </header>

      {items.length === 0 ? (
        <div className="px-4 py-6 text-center">
          <p className="text-[13px] text-text-secondary">
            No urgent actions today — pipeline is healthy.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border-subtle">
          {items.map((item, idx) => {
            const Icon = ICONS[item.type];
            const iconTone = ICON_TONE[item.type];
            return (
              <li key={idx} className="flex items-start gap-3 px-4 py-3">
                <span aria-hidden className={`mt-0.5 shrink-0 ${iconTone}`}>
                  <Icon size={16} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium text-text-primary">{item.title}</div>
                  {item.subtitle && (
                    <div className="mt-0.5 text-[12px] text-text-tertiary">{item.subtitle}</div>
                  )}
                  {item.action_label && item.action_href && (
                    <a
                      href={item.action_href}
                      className="mt-1 inline-flex items-center gap-1 text-[12px] font-medium text-accent hover:underline"
                    >
                      {item.action_label}
                      <ArrowRight size={12} />
                    </a>
                  )}
                </div>
                {onItemAsk && (
                  <button
                    type="button"
                    onClick={() => onItemAsk(item, idx)}
                    className="-mr-1 mt-0.5 shrink-0 rounded p-1 text-text-muted transition-colors hover:bg-surface-3 hover:text-text-secondary"
                    title="Ask the agent about this"
                    aria-label="Ask the agent about this item"
                  >
                    <ChevronRight size={14} />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// SAMPLE_BRIEFING_ITEMS used to live here as T1's placeholder feed. T4 deleted
// it once the briefing generator + /today route landed — real items now come
// from data/briefings/YYYY-MM-DD.json via getTodaysBriefing(). Empty briefing
// renders the "No urgent actions today — pipeline is healthy." state.
