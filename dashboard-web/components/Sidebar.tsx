"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Zap,
  Building2,
  Briefcase,
  BellDot,
  GraduationCap,
  Activity,
  Sun,
  BarChart3,
  Sliders,
  Beaker,
} from "lucide-react";
import { Badge, SectionLabel } from "@/components/ui";

interface SidebarProps {
  activePursuing: number;
  highConviction: number;
  companyCount: number;
  signalCount: number;
  hasWarmLeads: boolean;
}

export function Sidebar({
  activePursuing,
  highConviction,
  companyCount,
  signalCount,
  hasWarmLeads,
}: SidebarProps) {
  const pathname = usePathname();

  // /today is the new top-of-funnel surface — the agent's daily focus card
  // lives there. /pipeline is the table-first workspace view. The badge on
  // /pipeline still tracks "actively pursuing" because that's where you go
  // to do something about them.
  const nav = [
    { href: "/today", label: "Today", icon: Sun },
    { href: "/pipeline", label: "Pipeline", icon: LayoutDashboard, badge: activePursuing || undefined },
    { href: "/signals", label: "Signals", icon: Zap, badge: highConviction || undefined },
    { href: "/companies", label: "Companies", icon: Building2 },
    { href: "/sources", label: "Source Health", icon: Activity },
    { href: "/analytics", label: "Analytics", icon: BarChart3 },
    { href: "/interviews", label: "Interview Prep", icon: GraduationCap },
    { href: "/context", label: "Context", icon: Sliders },
    // PersonaLab — multi-persona QA framework. Reads from qa/ on the
    // filesystem (no DB), so it's safe to land empty when the
    // orchestrator hasn't run yet.
    { href: "/qa-reports", label: "QA Reports", icon: Beaker },
  ];

  return (
    <aside className="fixed left-0 top-0 flex h-screen w-60 flex-col border-r border-border-subtle bg-surface-1">
      {/* Logo */}
      <div className="flex items-center gap-2 px-5 pb-5 pt-5">
        <Briefcase size={18} className="text-accent" />
        <span className="text-[15px] font-semibold text-text-primary">Jobmaxxing</span>
        {hasWarmLeads && <BellDot size={15} className="ml-auto animate-subtle-pulse text-amber" />}
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3">
        <SectionLabel className="mb-2 px-3">Workspace</SectionLabel>
        <div className="space-y-0.5">
          {nav.map((item) => {
            const active = pathname === item.href;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 rounded-lg border-l-2 px-3 py-2 text-[13px] font-medium transition-colors ${
                  active
                    ? "border-accent bg-accent-dim text-accent"
                    : "border-transparent text-text-tertiary hover:bg-surface-3 hover:text-text-secondary"
                }`}
              >
                <Icon size={16} />
                {item.label}
                {item.badge !== undefined && <Badge color="accent" className="ml-auto">{item.badge}</Badge>}
              </Link>
            );
          })}
        </div>
      </nav>

      {/* Footer */}
      <div className="border-t border-border-subtle px-5 py-3 text-[11px] text-text-muted">
        {companyCount} watched &middot; {signalCount} signals
      </div>
    </aside>
  );
}
