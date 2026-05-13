"use client";

/**
 * Pipeline Health Briefing — the top-of-page surface on /sources.
 *
 * Mirrors the MorningBriefing component on /pipeline (same field shape, same
 * visual treatment, same agent-output contract) but speaks in pipeline-health
 * language instead of job-search actions: coverage wins, scraper drift, comp
 * recovery opportunities, data-label opportunities.
 *
 * Status (2026-05-13): placeholder. Items are hard-coded so the visual lands
 * now; T4 will swap SAMPLE_PIPELINE_HEALTH_ITEMS for agent-generated content.
 *
 * The `PipelineHealthItem` shape (`title` / `subtitle` / `action_label` /
 * `action_href`) is intentionally identical to MorningBriefing's
 * `BriefingItem` so the agent's output schema can be uniform across both
 * surfaces — only the `type` discriminator's union differs, because the two
 * surfaces care about different things. Keep the field names in lockstep
 * with MorningBriefing when either evolves.
 */

import {
  Activity,
  TrendingUp,
  AlertTriangle,
  AlertCircle,
  DollarSign,
  Lightbulb,
  Clock,
  RefreshCw,
  ArrowRight,
} from "lucide-react";
import type { ComponentType, SVGProps } from "react";

export type PipelineHealthItemType =
  | "coverage_win"
  | "scraper_drift"
  | "extraction_broken"
  | "data_opportunity"
  | "comp_recovery"
  | "stale_data";

export interface PipelineHealthItem {
  type: PipelineHealthItemType;
  title: string;
  subtitle?: string;
  action_label?: string;
  action_href?: string;
}

interface PipelineHealthBriefingProps {
  /** Concrete pipeline-health items. Order matters — render top-to-bottom as-is. */
  items: PipelineHealthItem[];
  /** When the briefing was generated. Shown as "Generated 2h ago" in the header. */
  lastGenerated?: Date;
  /** Regenerate handler. When omitted, the refresh button is hidden. */
  onRefresh?: () => void;
}

const ICONS: Record<PipelineHealthItemType, ComponentType<SVGProps<SVGSVGElement> & { size?: number }>> = {
  coverage_win: TrendingUp,
  scraper_drift: AlertTriangle,
  extraction_broken: AlertCircle,
  data_opportunity: Lightbulb,
  comp_recovery: DollarSign,
  stale_data: Clock,
};

const ICON_TONE: Record<PipelineHealthItemType, string> = {
  coverage_win: "text-emerald",
  scraper_drift: "text-amber",
  extraction_broken: "text-red",
  data_opportunity: "text-blue",
  comp_recovery: "text-violet",
  stale_data: "text-amber",
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

export function PipelineHealthBriefing({
  items,
  lastGenerated,
  onRefresh,
}: PipelineHealthBriefingProps) {
  return (
    // Same warm tint as MorningBriefing — a low-opacity amber wash over
    // surface-2. Reads as the highest-priority surface on /sources without
    // competing with the colored stat cards below.
    <section
      className="rounded-lg border bg-surface-2 shadow-sm"
      style={{
        borderColor: "color-mix(in srgb, var(--color-amber) 18%, var(--color-border-subtle))",
        background:
          "linear-gradient(180deg, color-mix(in srgb, var(--color-amber) 4%, var(--color-surface-2)) 0%, var(--color-surface-2) 100%)",
      }}
      aria-label="Pipeline health briefing"
    >
      <header className="flex items-center justify-between gap-3 border-b border-border-subtle px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Activity size={14} className="text-amber" aria-hidden />
          <h2 className="text-[13px] font-semibold tracking-[-0.01em] text-text-primary">
            Pipeline Health
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
            Pipeline is healthy — nothing needs attention right now.
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
 * Placeholder content. T4 replaces this with agent-generated items at first
 * load. Kept in the same module as the component so the placeholder + its
 * type contract move together — when T4 deletes this, they delete the
 * import in /sources too.
 */
export const SAMPLE_PIPELINE_HEALTH_ITEMS: PipelineHealthItem[] = [
  {
    type: "comp_recovery",
    title: "BuiltIn coverage jumped to 83% — Greenhouse boards still at 0%",
    subtitle: "Consider running --backfill-comp --host job-boards.greenhouse.io",
  },
  {
    type: "scraper_drift",
    title: "Ashby extraction stable at 85% — new URL pattern detected",
    subtitle: "Scraper may need an update",
  },
  {
    type: "data_opportunity",
    title: "Data label opportunity: 23 BuiltIn roles have 'Featured Benefits' badges",
    subtitle: "Not currently extracted — extending the BuiltIn extractor would surface them",
  },
];
