import Link from "next/link";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

const BASE =
  "inline-flex items-center gap-1.5 rounded-md font-medium outline-none transition-colors duration-150 ease-out " +
  "active:translate-y-px disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none";

const SIZE: Record<Size, string> = {
  sm: "px-3 py-1.5 text-[13px]",
  md: "px-4 py-2 text-[13px]",
};

const VARIANT: Record<Variant, string> = {
  primary: "border border-transparent bg-accent-strong text-white hover:brightness-110",
  secondary: "border border-border-default bg-surface-2 text-text-secondary hover:bg-surface-3 hover:text-text-primary",
  ghost: "border border-transparent bg-transparent text-text-tertiary hover:bg-surface-3 hover:text-text-secondary",
  danger: "border border-red-border bg-red-dim text-red hover:bg-[rgba(248,113,113,0.18)]",
};

type ButtonProps = ComponentPropsWithoutRef<"button"> & {
  variant?: Variant;
  size?: Size;
  /** When set, renders a styled `next/link` instead of a `<button>`. */
  href?: string;
};

export function Button({ variant = "secondary", size = "sm", href, className = "", children, ...rest }: ButtonProps) {
  const cls = `${BASE} ${SIZE[size]} ${VARIANT[variant]} ${className}`;
  if (href) {
    return (
      <Link href={href} className={cls}>
        {children as ReactNode}
      </Link>
    );
  }
  return (
    <button className={cls} {...rest}>
      {children}
    </button>
  );
}
