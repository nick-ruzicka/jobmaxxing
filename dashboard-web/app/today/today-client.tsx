"use client";

import Link from "next/link";
import { RefreshCw, Radio, ArrowRight } from "lucide-react";
import type { Briefing, ScanStats } from "@/lib/types";
import { Shell } from "@/components/Shell";
import { StatStrip } from "@/components/StatStrip";
import { MorningBriefing } from "@/components/MorningBriefing";
import { PageHeader, Button } from "@/components/ui";
import { useScan } from "@/components/ScanContext";

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
  briefing,
  stats,
  highConviction,
  companyCount,
  signalCount,
  hasWarmLeads,
}: TodayPageProps) {
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
        {/* Hero: the morning briefing. T4 Task 3 will wire onRefresh /
            refreshing; Task 5 will wire onItemAsk for the chat panel. */}
        <MorningBriefing items={items} lastGenerated={lastGenerated} />

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
    </Shell>
  );
}
