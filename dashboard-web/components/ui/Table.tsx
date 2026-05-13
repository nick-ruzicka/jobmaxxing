import type { ReactNode, HTMLAttributes, ThHTMLAttributes } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

/** The table shell: 1px border + rounded-lg + horizontal scroll. No shadow. */
export function TableContainer({ className = "", children }: { className?: string; children: ReactNode }) {
  return (
    <div className={`overflow-x-auto rounded-lg border border-border-subtle bg-surface-2 ${className}`}>
      <table className="w-full text-[13px]">{children}</table>
    </div>
  );
}

interface ThProps extends ThHTMLAttributes<HTMLTableCellElement> {
  /** When set, renders a sort affordance and makes the header clickable. */
  sortDir?: "asc" | "desc" | false;
}

/** Uppercase tracked column header cell. Pass `sortDir` (or `false` for sortable-but-inactive) for the sort caret. */
export function Th({ sortDir, className = "", children, ...rest }: ThProps) {
  const sortable = sortDir !== undefined;
  return (
    <th
      className={`px-3 py-2.5 text-left text-[11px] font-medium uppercase tracking-[0.04em] text-text-tertiary ${sortable ? "cursor-pointer select-none transition-colors hover:text-text-secondary" : ""} ${className}`}
      {...rest}
    >
      {children == null ? null : (
        <span className="inline-flex items-center gap-1">
          {children}
          {sortable && (sortDir === "desc" ? <ChevronDown size={11} className="text-accent" /> : sortDir === "asc" ? <ChevronUp size={11} className="text-accent" /> : <ChevronDown size={11} className="text-border-strong" />)}
        </span>
      )}
    </th>
  );
}

interface TrProps extends HTMLAttributes<HTMLTableRowElement> {
  /** Adds the even-row zebra tint. Off by default (turn on for tables without injected expand-rows). */
  zebra?: boolean;
  /** Rejected / skipped / stale — dims the row, no strikethrough, no left-border. */
  dimmed?: boolean;
  /** Keyboard-nav focus — uses the global focus-ring language (inset). */
  focused?: boolean;
}

/** A table row with CSS-only hover + optional zebra. No JS mouseenter/leave handlers. */
export function Tr({ zebra, dimmed, focused, className = "", children, ...rest }: TrProps) {
  return (
    <tr
      data-dimmed={dimmed || undefined}
      className={[
        "border-b border-border-subtle transition-colors duration-150 hover:bg-surface-3",
        zebra ? "even:bg-surface-row" : "",
        dimmed ? "opacity-50" : "",
        focused ? "[box-shadow:inset_0_0_0_1px_var(--color-accent)]" : "",
        className,
      ].filter(Boolean).join(" ")}
      {...rest}
    >
      {children}
    </tr>
  );
}
