import type { ReactNode } from "react";

interface EmptyStateProps {
  /** A muted Lucide glyph (~24-32px). */
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** Usually a secondary <Button>. */
  action?: ReactNode;
  className?: string;
}

/** Designed "no data" state — centered icon + title + optional description + optional action. */
export function EmptyState({ icon, title, description, action, className = "" }: EmptyStateProps) {
  return (
    <div className={`flex flex-col items-center px-4 py-12 text-center ${className}`}>
      {icon && <div className="mb-3 text-text-muted">{icon}</div>}
      <div className="text-[13px] text-text-secondary">{title}</div>
      {description && <div className="mt-1 text-[12px] text-text-muted">{description}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
