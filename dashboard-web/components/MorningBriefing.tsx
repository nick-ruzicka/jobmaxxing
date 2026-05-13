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

import { Calendar, Sparkles, Clock, Search, MapPin, ShieldCheck, RefreshCw, ArrowRight } from "lucide-react";
import type { ComponentType, SVGProps } from "react";

export type BriefingItemType =
  | "interview"
  | "apply"
  | "follow_up"
  | "missed"
  | "stale"
  | "verify_location";

export interface BriefingItem {
  type: BriefingItemType;
  title: string;
  subtitle?: string;
  action_label?: string;
  action_href?: string;
}

interface MorningBriefingProps {
  /** Concrete actions for today. Order matters — render top-to-bottom as-is. */
  items: BriefingItem[];
  /** When the briefing was generated. Shown as "Generated 2h ago" in the header. */
  lastGenerated?: Date;
  /** Regenerate handler. When omitted, the refresh button is hidden. */
  onRefresh?: () => void;
}

const ICONS: Record<BriefingItemType, ComponentType<SVGProps<SVGSVGElement> & { size?: number }>> = {
  interview: Calendar,
  apply: Sparkles,
  follow_up: Clock,
  missed: Search,
  stale: Clock,
  verify_location: MapPin,
};

const ICON_TONE: Record<BriefingItemType, string> = {
  interview: "text-accent",
  apply: "text-emerald",
  follow_up: "text-amber",
  missed: "text-violet",
  stale: "text-amber",
  verify_location: "text-blue",
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

export function MorningBriefing({ items, lastGenerated, onRefresh }: MorningBriefingProps) {
  return (
    // Warm tint: a very low-opacity amber wash. Reads as the highest-priority
    // surface without competing with the accent-fill hero stat tiles below.
    // Border picks up a faint amber bias for the same reason.
    <section
      className="rounded-lg border bg-surface-2 shadow-sm"
      style={{
        borderColor: "color-mix(in srgb, var(--color-amber) 18%, var(--color-border-subtle))",
        background:
          "linear-gradient(180deg, color-mix(in srgb, var(--color-amber) 4%, var(--color-surface-2)) 0%, var(--color-surface-2) 100%)",
      }}
      aria-label="Today's focus"
    >
      <header className="flex items-center justify-between gap-3 border-b border-border-subtle px-4 py-2.5">
        <div className="flex items-center gap-2">
          <ShieldCheck size={14} className="text-amber" aria-hidden />
          <h2 className="text-[13px] font-semibold tracking-[-0.01em] text-text-primary">
            Today&apos;s Focus
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
            className="inline-flex items-center gap-1 rounded-md border border-border-subtle bg-surface-3 px-2 py-0.5 text-[11px] font-medium text-text-tertiary transition-colors hover:bg-surface-4 hover:text-text-secondary"
            title="Regenerate briefing"
          >
            <RefreshCw size={11} />
            Refresh
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
            const tone = ICON_TONE[item.type];
            return (
              <li key={idx} className="flex items-start gap-3 px-4 py-3">
                <span aria-hidden className={`mt-0.5 shrink-0 ${tone}`}>
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
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/**
 * Placeholder content for the MorningBriefing. T4 will replace this with an
 * agent-generated feed; until then the page renders these hard-coded items
 * so the visual is real and reviewable.
 *
 * Kept in the same module as the component so the placeholder + the type
 * shape move together — when T4 deletes this, they delete the import too.
 */
export const SAMPLE_BRIEFING_ITEMS: BriefingItem[] = [
  {
    type: "interview",
    title: "2:00pm — Hearth interview",
    subtitle: "Prep doc covers the GTM-Eng comp shape and their recent funding",
    action_label: "Open interview prep",
    action_href: "/interviews",
  },
  {
    type: "apply",
    title: "Apply today: incident.io GTM Engineer",
    subtitle: "Posted 5d ago · fits your stack · score 8",
    action_label: "View role",
    action_href: "/",
  },
  {
    type: "follow_up",
    title: "Follow up: Stuut (4d since last contact)",
    subtitle: "Last touch was your initial outreach — they replied, didn't book",
    action_label: "Review draft",
    action_href: "/",
  },
  {
    type: "missed",
    title: "You might have missed: Maple GTM Engineer",
    subtitle: "Scored 6 by the title heuristic — JD enrichment says 7",
    action_label: "Re-evaluate",
    action_href: "/",
  },
];
