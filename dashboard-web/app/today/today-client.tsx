"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { RefreshCw, Radio, ArrowRight } from "lucide-react";
import type { Briefing, ScanStats } from "@/lib/types";
import { Shell } from "@/components/Shell";
import { StatStrip } from "@/components/StatStrip";
import { MorningBriefing } from "@/components/MorningBriefing";
import { PageHeader, Button, Toast, type ToastKind } from "@/components/ui";
import { useScan } from "@/components/ScanContext";

// Toast lifecycle (same constants as pipeline-client — kept inline rather
// than factored out because the duplication is two lines, the cost of a hook
// is more).
const TOAST_LIFETIME_MS = 3500;
const TOAST_FADE_MS = 300;

type ToastEntry = { id: number; kind: ToastKind; message: string; removing: boolean };

interface TodayPageProps {
  /** Today's briefing JSON, or null if the generator hasn't run yet. */
  briefing: Briefing | null;
  /** Pre-computed pipeline stats (server-side, never mutates here — /today
   *  doesn't expose status edits). */
  stats: ScanStats;
  highConviction: number;
  companyCount: number;
  signalCount: number;
  hasWarmLeads: boolean;
}

/** Pretty date for the page subtitle. "Wednesday, May 13" — the day of the
 *  week is what makes this feel like a daily surface and not a static page. */
function formatTodayHuman(): string {
  return new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function TodayHeader() {
  const { runScan, scanRunning } = useScan();
  return (
    <PageHeader
      title="Today"
      subtitle={formatTodayHuman()}
      actions={
        <>
          <Button
            variant="secondary"
            onClick={() => runScan("scan")}
            disabled={scanRunning}
            title="Job boards + Exa + Similar"
          >
            <RefreshCw size={14} className={scanRunning ? "animate-spin" : ""} />
            Run Scan
          </Button>
          <Button
            variant="secondary"
            onClick={() => runScan("signal")}
            disabled={scanRunning}
            title="Funding + hiring-intent signals"
          >
            <Radio size={14} />
            Signal Scan
          </Button>
        </>
      }
    />
  );
}

export function TodayPage({
  briefing: initialBriefing,
  stats,
  highConviction,
  companyCount,
  signalCount,
  hasWarmLeads,
}: TodayPageProps) {
  // Briefing lives in state so the Regenerate handler can swap it in place
  // without a hard reload.
  const [briefing, setBriefing] = useState<Briefing | null>(initialBriefing);
  const [refreshing, setRefreshing] = useState(false);

  // Toast queue — identical lifecycle to pipeline-client's; kept inline.
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const nextToastId = useRef(1);

  function pushToast(kind: ToastKind, message: string) {
    const id = nextToastId.current++;
    setToasts((prev) => [...prev, { id, kind, message, removing: false }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, removing: true } : t)));
    }, TOAST_LIFETIME_MS - TOAST_FADE_MS);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, TOAST_LIFETIME_MS);
  }

  async function handleRefresh() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const res = await fetch("/api/briefing/regenerate", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (res.status === 429) {
        // The error tone is overkill for a benign throttle, but it's what
        // Toast supports; the message makes the cause clear ("Try again in Ns").
        pushToast("error", body.message ?? "Hold on — regen is rate-limited (1 / 5 min).");
        return;
      }
      if (!res.ok) {
        pushToast("error", body.message ?? "Couldn't regenerate — check the server logs.");
        return;
      }
      setBriefing(body.briefing as Briefing);
      pushToast("success", `Regenerated · ${body.briefing.items.length} item${body.briefing.items.length === 1 ? "" : "s"}`);
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : "Regen failed");
    } finally {
      setRefreshing(false);
    }
  }

  const items = briefing?.items ?? [];
  const lastGenerated = briefing ? new Date(briefing.generated_at) : undefined;

  return (
    <Shell
      activePursuing={stats.activelyPursuing}
      highConviction={highConviction}
      companyCount={companyCount}
      signalCount={signalCount}
      hasWarmLeads={hasWarmLeads}
    >
      <TodayHeader />
      <div className="space-y-6">
        {/* Hero: the morning briefing. onRefresh is wired to the rate-limited
            regenerate API; Task 5 will add onItemAsk for the chat panel. */}
        <MorningBriefing
          items={items}
          lastGenerated={lastGenerated}
          onRefresh={handleRefresh}
          refreshing={refreshing}
        />

        {/* Pivot to the table view — flush right, low-weight. Reads as
            metadata, not as competing CTA with the briefing's action links. */}
        <div className="flex justify-end">
          <Link
            href="/pipeline"
            className="inline-flex items-center gap-1 text-[12px] font-medium text-accent hover:underline"
          >
            View full pipeline
            <ArrowRight size={12} />
          </Link>
        </div>

        {/* Secondary context: pipeline KPIs as a quiet strip at the bottom.
            Same stats the /pipeline page leads with — here they're grounding
            metadata, not the main act. */}
        <StatStrip stats={stats} />
      </div>

      {/* Toast queue — fixed bottom-right, identical to pipeline-client's. */}
      {toasts.length > 0 && (
        <div
          aria-live="polite"
          aria-atomic="false"
          className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2"
        >
          {toasts.map((t) => (
            <div key={t.id} className="pointer-events-auto">
              <Toast kind={t.kind} message={t.message} removing={t.removing} />
            </div>
          ))}
        </div>
      )}
    </Shell>
  );
}
