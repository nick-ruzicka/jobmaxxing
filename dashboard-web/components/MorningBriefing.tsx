"use client";

/**
 * The highest-priority surface on /pipeline (and /today). Surfaces concrete,
 * actionable items the user should attend to right now: today's interview,
 * a fresh-fit role that should be applied to, a stale follow-up, a missed
 * lead, etc.
 *
 * Visual: a warm-tinted hero card. Items separated by hairlines, action
 * links use the accent color. Empty state when items.length === 0.
 * Click a row to expand inline detail (role context, score, stack).
 */

import { useState } from "react";
import Link from "next/link";
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
import type { BriefingItem, BriefingItemContext, BriefingItemType } from "@/lib/types";

// Re-export the types so existing callers that did
// `import { BriefingItem } from "@/components/MorningBriefing"` keep working.
export type { BriefingItem, BriefingItemContext, BriefingItemType };

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

  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

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
            const isExpanded = expandedIdx === idx;
            const ctx = item.context as Record<string, unknown> | undefined;
            return (
              <li key={idx}>
                <div
                  data-action="today:click_briefing_item"
                  role="button"
                  tabIndex={0}
                  onClick={() => setExpandedIdx(isExpanded ? null : idx)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setExpandedIdx(isExpanded ? null : idx); }}
                  className="flex cursor-pointer items-start gap-3 px-4 py-3 transition-colors hover:bg-surface-3/50"
                >
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
                        onClick={(e) => e.stopPropagation()}
                        className="mt-1 inline-flex items-center gap-1 text-[12px] font-medium text-accent hover:underline"
                      >
                        {item.action_label}
                        <ArrowRight size={12} />
                      </a>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {onItemAsk && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onItemAsk(item, idx); }}
                        className="rounded p-1 text-text-muted transition-colors hover:bg-surface-3 hover:text-text-secondary"
                        title="Ask the agent about this"
                        aria-label="Ask the agent about this item"
                      >
                        <ChevronRight size={14} />
                      </button>
                    )}
                    <ChevronRight
                      size={14}
                      className={`text-text-muted transition-transform ${isExpanded ? "rotate-90" : ""}`}
                    />
                  </div>
                </div>
                {isExpanded && ctx && (
                  <BriefingDetailPanel context={ctx} />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ─── Inline detail panel for expanded briefing items ────────────────────

function BriefingDetailPanel({ context }: { context: BriefingItemContext }) {
  // Fields are now typed via BriefingItemContext — no more `as string | undefined`
  // casts. The previous untyped Record<string, unknown> shape was the root cause
  // of the AI feature audit Bug A (state-loss-across-navigation) per
  // docs/audits/2026-05-28-ai-feature-audit.md §4.
  // role is in the BriefingItemContext shape but unused in this panel — the
  // title row above already renders it. Omitting from destructure to keep
  // the lint clean.
  const {
    company,
    url,
    fit_score: fitScore,
    comp_range: compRange,
    stack,
    verdict_excerpt: verdictExcerpt,
    draft_message: draftMessage,
    days_stale: daysStale,
    status,
  } = context;

  // Derive company slug for /companies + /pipeline?company=… deep links.
  // Prefer the generator-supplied slug when present (new briefings); fall back
  // to deriving from the display name (old briefings missing the field).
  const companySlug =
    context.company_slug ??
    (company ? company.toLowerCase().replace(/[^a-z0-9]/g, "") : null);

  return (
    <div className="border-t border-border-subtle bg-surface-1 px-4 py-3 text-[12px]">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {/* Left column: metadata */}
        <div className="space-y-2">
          {fitScore !== undefined && (
            <div className="flex items-center gap-2">
              <span className="text-text-tertiary">Score:</span>
              <span className="font-semibold text-text-primary">{fitScore}/10</span>
            </div>
          )}
          {compRange && (
            <div className="flex items-center gap-2">
              <span className="text-text-tertiary">Comp:</span>
              <span className="text-text-secondary">{compRange}</span>
            </div>
          )}
          {status && (
            <div className="flex items-center gap-2">
              <span className="text-text-tertiary">Status:</span>
              <span className="text-text-secondary">{status}</span>
            </div>
          )}
          {daysStale !== undefined && (
            <div className="flex items-center gap-2">
              <span className="text-text-tertiary">Days stale:</span>
              <span className="text-amber">{daysStale}d</span>
            </div>
          )}
          {stack && stack.length > 0 && (
            <div>
              <span className="text-text-tertiary">Stack: </span>
              <span className="text-text-secondary">{stack.join(", ")}</span>
            </div>
          )}
        </div>
        {/* Right column: navigation links */}
        <div className="flex flex-col items-start gap-2 sm:items-end">
          {url && (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1 text-accent hover:underline"
            >
              Open JD <ArrowRight size={11} />
            </a>
          )}
          {companySlug && (
            <Link
              href={`/companies/${companySlug}`}
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1 text-accent hover:underline"
            >
              Company detail <ArrowRight size={11} />
            </Link>
          )}
          <Link
            href={
              companySlug
                ? `/pipeline?company=${companySlug}&from=briefing`
                : "/pipeline"
            }
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 text-accent hover:underline"
          >
            View in pipeline <ArrowRight size={11} />
          </Link>
        </div>
      </div>
      {/* Verdict / draft message */}
      {verdictExcerpt && (
        <p className="mt-3 rounded bg-surface-2 p-2 text-[11px] leading-relaxed text-text-secondary">
          {verdictExcerpt}
        </p>
      )}
      {draftMessage && (
        <div className="mt-3">
          <div className="mb-1 text-[11px] font-medium text-text-tertiary">Draft follow-up:</div>
          <p className="rounded bg-surface-2 p-2 text-[11px] leading-relaxed text-text-secondary">
            {draftMessage}
          </p>
        </div>
      )}
    </div>
  );
}
