"use client";

import { createContext, useContext } from "react";

export interface ScanContextValue {
  /** Kick off a scan — opens the terminal drawer and streams its output. */
  runScan: (type: "scan" | "signal") => void;
  /** True while a scan is in flight (disables the scan buttons). */
  scanRunning: boolean;
}

const ScanContext = createContext<ScanContextValue | null>(null);

export function ScanProvider({
  value,
  children,
}: {
  value: ScanContextValue;
  children: React.ReactNode;
}) {
  return <ScanContext.Provider value={value}>{children}</ScanContext.Provider>;
}

/** Access the scan controls surfaced in a page header. Must be used under `<Shell>`. */
export function useScan(): ScanContextValue {
  const ctx = useContext(ScanContext);
  if (!ctx) throw new Error("useScan must be used within <Shell>");
  return ctx;
}
