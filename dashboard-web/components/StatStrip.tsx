import { Layers, Target, CalendarCheck, BarChart2, Clock } from "lucide-react";
import type { ScanStats } from "@/lib/types";

interface StatCardProps {
  icon: React.ReactNode;
  value: string | number;
  label: string;
  sub?: string;
}

function StatCard({ icon, value, label, sub }: StatCardProps) {
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
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
      <StatCard
        icon={<Layers size={18} />}
        value={stats.totalDiscovered}
        label="Discovered"
        sub={`${stats.nycCount} NYC / ${stats.remoteCount} Remote`}
      />
      <StatCard icon={<Target size={18} />} value={stats.activelyPursuing} label="Pursuing" />
      <StatCard icon={<CalendarCheck size={18} />} value={stats.interviews} label="Interviews" />
      <StatCard icon={<BarChart2 size={18} />} value={stats.avgScore} label="Avg score" />
      <StatCard icon={<Clock size={18} />} value={stats.lastScanDate || "Never"} label="Last scan" />
    </div>
  );
}
