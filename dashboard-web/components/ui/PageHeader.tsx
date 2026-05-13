import type { ReactNode } from "react";

interface PageHeaderProps {
  title: ReactNode;
  /** A count or one-line context shown next to the title. */
  subtitle?: ReactNode;
  icon?: ReactNode;
  /** Primary action(s), right-aligned. */
  actions?: ReactNode;
  className?: string;
}

/** Page title row: icon + title + subtitle on the left, actions on the right. */
export function PageHeader({ title, subtitle, icon, actions, className = "" }: PageHeaderProps) {
  return (
    <div className={`mb-6 flex items-center justify-between gap-4 ${className}`}>
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-2.5">
          {icon}
          <h1 className="text-[18px] font-semibold leading-tight tracking-[-0.02em] text-text-primary">{title}</h1>
        </span>
        {subtitle != null && <span className="text-[12px] tabular-nums text-text-muted">{subtitle}</span>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
