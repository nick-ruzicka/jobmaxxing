import type { ReactNode } from "react";

export type BadgeColor = "neutral" | "accent" | "emerald" | "amber" | "blue" | "violet" | "red";
type Variant = "soft" | "dot";

const SOFT: Record<BadgeColor, string> = {
  neutral: "border-border-subtle bg-surface-3 text-text-tertiary",
  accent: "border-accent-border bg-accent-dim text-accent",
  emerald: "border-emerald-border bg-emerald-dim text-emerald",
  amber: "border-amber-border bg-amber-dim text-amber",
  blue: "border-blue-border bg-blue-dim text-blue",
  violet: "border-violet-border bg-violet-dim text-violet",
  red: "border-red-border bg-red-dim text-red",
};

const DOT: Record<BadgeColor, string> = {
  neutral: "bg-text-muted",
  accent: "bg-accent",
  emerald: "bg-emerald",
  amber: "bg-amber",
  blue: "bg-blue",
  violet: "bg-violet",
  red: "bg-red",
};

interface BadgeProps {
  color?: BadgeColor;
  variant?: Variant;
  /** Leading icon for the `soft` variant (e.g. a 10px Lucide glyph). */
  icon?: ReactNode;
  className?: string;
  children: ReactNode;
}

/**
 * One badge primitive. `soft` = the tinted chip (tier labels, counts, locations).
 * `dot` = a quiet status marker — a 6px colored dot + label, no chip background.
 */
export function Badge({ color = "neutral", variant = "soft", icon, className = "", children }: BadgeProps) {
  if (variant === "dot") {
    return (
      <span className={`inline-flex items-center gap-1.5 text-[13px] text-text-secondary ${className}`}>
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[color]}`} />
        {children}
      </span>
    );
  }
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium tabular-nums ${SOFT[color]} ${className}`}
    >
      {icon}
      {children}
    </span>
  );
}
