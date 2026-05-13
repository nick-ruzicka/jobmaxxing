"use client";

import { useState, useCallback } from "react";
import { Sidebar } from "./Sidebar";
import { TerminalDrawer } from "./TerminalDrawer";
import { ScanProvider } from "./ScanContext";

interface ShellProps {
  children: React.ReactNode;
  activePursuing: number;
  highConviction: number;
  companyCount: number;
  signalCount: number;
  hasWarmLeads: boolean;
}

export function Shell({
  children,
  activePursuing,
  highConviction,
  companyCount,
  signalCount,
  hasWarmLeads,
}: ShellProps) {
  const [scanRunning, setScanRunning] = useState(false);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [terminalOutput, setTerminalOutput] = useState("");

  const handleScanStart = useCallback(
    async (type: "scan" | "signal") => {
      setScanRunning(true);
      setTerminalOpen(true);
      setTerminalOutput("");

      const endpoint =
        type === "scan" ? "/api/run-scan" : "/api/run-signal-scan";

      try {
        const res = await fetch(endpoint, { method: "POST" });
        if (!res.body) {
          setTerminalOutput("Error: no response body");
          setScanRunning(false);
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          setTerminalOutput((prev) => prev + decoder.decode(value));
        }
      } catch (err) {
        setTerminalOutput(
          (prev) => prev + `\nError: ${err instanceof Error ? err.message : "unknown"}`
        );
      } finally {
        setScanRunning(false);
      }
    },
    []
  );

  return (
    <div className="flex h-screen">
      <Sidebar
        activePursuing={activePursuing}
        highConviction={highConviction}
        companyCount={companyCount}
        signalCount={signalCount}
        hasWarmLeads={hasWarmLeads}
      />
      <ScanProvider value={{ runScan: handleScanStart, scanRunning }}>
        <main className="ml-60 flex-1 min-w-0 overflow-y-auto bg-surface-0 p-6">{children}</main>
      </ScanProvider>
      <TerminalDrawer
        open={terminalOpen}
        output={terminalOutput}
        onClose={() => setTerminalOpen(false)}
        running={scanRunning}
      />
    </div>
  );
}
