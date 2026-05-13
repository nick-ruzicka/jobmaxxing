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
} from "lucide-react";

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

  const nav = [
    { href: "/", label: "Pipeline", icon: LayoutDashboard, badge: activePursuing || undefined },
    { href: "/signals", label: "Signals", icon: Zap, badge: highConviction || undefined },
    { href: "/companies", label: "Companies", icon: Building2 },
    { href: "/sources", label: "Source Health", icon: Activity },
    { href: "/interviews", label: "Interview Prep", icon: GraduationCap },
  ];

  return (
    <aside
      className="fixed left-0 top-0 flex h-screen w-60 flex-col"
      style={{ background: "var(--surface-1)", borderRight: "1px solid var(--border-subtle)" }}
    >
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-5 pt-5 pb-6">
        <div
          className="flex h-7 w-7 items-center justify-center rounded-md"
          style={{ background: "var(--accent-dim)" }}
        >
          <Briefcase size={15} style={{ color: "var(--accent)" }} />
        </div>
        <span className="text-[15px] font-semibold" style={{ color: "var(--text-primary)" }}>
          JobOps
        </span>
        {hasWarmLeads && (
          <BellDot size={15} className="ml-auto animate-subtle-pulse" style={{ color: "var(--amber)" }} />
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 space-y-0.5">
        {nav.map((item) => {
          const active = pathname === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors"
              style={{
                background: active ? "var(--accent-dim)" : "transparent",
                color: active ? "var(--accent)" : "var(--text-tertiary)",
                borderLeft: active ? "2px solid var(--accent)" : "2px solid transparent",
              }}
            >
              <Icon size={16} />
              {item.label}
              {item.badge !== undefined && (
                <span
                  className="ml-auto rounded-full px-1.5 py-0.5 text-[11px] tabular-nums font-medium"
                  style={{ background: "var(--accent-dim)", color: "var(--accent)" }}
                >
                  {item.badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-5 py-3 text-[11px]" style={{ color: "var(--text-muted)", borderTop: "1px solid var(--border-subtle)" }}>
        <div>{companyCount} watched &middot; {signalCount} signals</div>
      </div>
    </aside>
  );
}
