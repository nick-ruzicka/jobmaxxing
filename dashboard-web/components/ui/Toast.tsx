"use client";

/**
 * The presentational half of a toast — visual only, no state. The parent
 * owns the queue (useState + setTimeout) and just renders these.
 *
 * Two kinds:
 *   success → accent-dim fill, checkmark
 *   error   → red-dim fill,    AlertTriangle
 *
 * Both pick up shadow-1 because they overlay the page like a popover.
 */

import { CheckCircle2, AlertTriangle } from "lucide-react";

export type ToastKind = "success" | "error";

interface ToastProps {
  kind: ToastKind;
  message: string;
  /** When true, the toast fades out — set ~300ms before unmounting. */
  removing?: boolean;
}

export function Toast({ kind, message, removing = false }: ToastProps) {
  const palette =
    kind === "success"
      ? "border-accent-border bg-accent-dim text-accent"
      : "border-red-border bg-red-dim text-red";
  const Icon = kind === "success" ? CheckCircle2 : AlertTriangle;
  return (
    <div
      role="status"
      className={`flex items-center gap-2 rounded-md border px-3 py-2 text-[13px] font-medium shadow-1 transition-opacity duration-300 ${palette} ${
        removing ? "opacity-0" : "opacity-100"
      }`}
    >
      <Icon size={14} aria-hidden />
      <span>{message}</span>
    </div>
  );
}
