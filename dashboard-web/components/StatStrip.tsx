import { Layers, Target, CalendarCheck, BarChart2, Clock } from "lucide-react";
import type { ScanStats } from "@/lib/types";

interface StatCardProps {
  icon: React.ReactNode;
  value: string | number;
  label: string;
  sub?: string;
  color: string;
  dimColor: string;
}

function StatCard({ icon, value, label, sub, color, dimColor }: StatCardProps) {
  return (
    <div
      className="flex items-center gap-3 rounded-lg px-4 py-3"
      style={{ background: "var(--surface-2)", border: "1px solid var(--border-subtle)", boxShadow: "var(--shadow-sm)" }}
    >
      <div
        className="flex h-9 w-9 items-center justify-center rounded-lg"
        style={{ background: dimColor, color }}
      >
        {icon}
      </div>
      <div>
        <div className="text-xl font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>
          {value}
        </div>
        <div className="text-[12px]" style={{ color: "var(--text-tertiary)" }}>
          {label}
          {sub && <span className="ml-1" style={{ color: "var(--text-muted)" }}>{sub}</span>}
        </div>
      </div>
    </div>
  );
}

export function StatStrip({ stats }: { stats: ScanStats }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
      <StatCard
        icon={<Layers size={18} />}
        value={stats.totalDiscovered}
        label="Discovered"
        sub={`${stats.nycCount} NYC / ${stats.remoteCount} Remote`}
        color="var(--accent)"
        dimColor="var(--accent-dim)"
      />
      <StatCard
        icon={<Target size={18} />}
        value={stats.activelyPursuing}
        label="Pursuing"
        color="var(--violet)"
        dimColor="var(--violet-dim)"
      />
      <StatCard
        icon={<CalendarCheck size={18} />}
        value={stats.interviews}
        label="Interviews"
        color="var(--blue)"
        dimColor="var(--blue-dim)"
      />
      <StatCard
        icon={<BarChart2 size={18} />}
        value={stats.avgScore}
        label="Avg Score"
        color="var(--emerald)"
        dimColor="var(--emerald-dim)"
      />
      <StatCard
        icon={<Clock size={18} />}
        value={stats.lastScanDate || "Never"}
        label="Last Scan"
        color="var(--text-tertiary)"
        dimColor="var(--surface-3)"
      />
    </div>
  );
}
