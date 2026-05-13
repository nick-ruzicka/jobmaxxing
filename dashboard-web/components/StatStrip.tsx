import { Layers, Target, CalendarCheck, BarChart2, Award } from "lucide-react";
import type { ScanStats } from "@/lib/types";

/**
 * Hierarchy:
 *   Heroes     — Interviews and Offers (whichever are > 0). Accent fill,
 *                accent border, shadow-sm, larger value. They earn the eye.
 *   Secondary  — Discovered, Pursuing, Avg score. Quiet surface-2 cards,
 *                no shadow.
 *   Fallback   — if no interviews AND no offers, Pursuing is promoted to
 *                hero (it's the most meaningful number when nothing's
 *                progressed yet) and dropped from the secondary row.
 *
 * Last scan is rendered next to Run Scan in PipelineHeader — it's
 * metadata, not a stat.
 */

interface HeroCardProps {
  icon: React.ReactNode;
  value: string | number;
  label: string;
  sub?: string;
}

function HeroCard({ icon, value, label, sub }: HeroCardProps) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-accent-border bg-accent-dim px-4 py-3 shadow-sm">
      <span className="shrink-0 text-accent">{icon}</span>
      <div className="min-w-0">
        <div className="text-[28px] font-bold leading-none tracking-[-0.02em] tabular-nums text-accent">
          {value}
        </div>
        <div className="mt-1 text-[12px] font-medium text-accent">
          {label}
          {sub && <span className="ml-1 font-normal text-text-muted">{sub}</span>}
        </div>
      </div>
    </div>
  );
}

interface SecondaryCardProps {
  icon: React.ReactNode;
  value: string | number;
  label: string;
  sub?: string;
}

function SecondaryCard({ icon, value, label, sub }: SecondaryCardProps) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border-subtle bg-surface-2 px-4 py-3">
      <span className="shrink-0 text-text-tertiary">{icon}</span>
      <div className="min-w-0">
        <div className="text-[22px] font-bold leading-tight tracking-[-0.02em] tabular-nums text-text-primary">
          {value}
        </div>
        <div className="text-[12px] text-text-tertiary">
          {label}
          {sub && <span className="ml-1 text-text-muted">{sub}</span>}
        </div>
      </div>
    </div>
  );
}

export function StatStrip({ stats }: { stats: ScanStats }) {
  const hasInterviews = stats.interviews > 0;
  const hasOffers = stats.offers > 0;
  // Pursuing is promoted to hero only when neither real milestone exists.
  // Otherwise Pursuing stays in the secondary row alongside Discovered.
  const promotePursuingToHero = !hasInterviews && !hasOffers;

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {hasInterviews && (
        <HeroCard
          icon={<CalendarCheck size={20} />}
          value={stats.interviews}
          label={stats.interviews === 1 ? "Interview" : "Interviews"}
        />
      )}
      {hasOffers && (
        <HeroCard
          icon={<Award size={20} />}
          value={stats.offers}
          label={stats.offers === 1 ? "Offer" : "Offers"}
        />
      )}
      {promotePursuingToHero && (
        <HeroCard
          icon={<Target size={20} />}
          value={stats.activelyPursuing}
          label="Pursuing"
        />
      )}

      <SecondaryCard
        icon={<Layers size={18} />}
        value={stats.totalDiscovered}
        label="Discovered"
        sub={`${stats.nycCount} NYC / ${stats.remoteCount} Remote`}
      />
      {!promotePursuingToHero && (
        <SecondaryCard
          icon={<Target size={18} />}
          value={stats.activelyPursuing}
          label="Pursuing"
        />
      )}
      <SecondaryCard
        icon={<BarChart2 size={18} />}
        value={stats.avgScore}
        label="Avg score"
      />
    </div>
  );
}
