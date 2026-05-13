import type { ReactNode } from "react";

/** Linear-style tracked-uppercase micro-label for grouping (sidebar groups, page sections). */
export function SectionLabel({ icon, children, className = "" }: { icon?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={`flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-tertiary ${className}`}>
      {icon}
      {children}
    </div>
  );
}
