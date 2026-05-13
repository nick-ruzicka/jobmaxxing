"use client";

/**
 * Pipeline-health twin of MorningBriefing — used by /sources to surface
 * extractor regressions, scrape failures, label opportunities, and suggested
 * commands. Same visual + behavior contract as MorningBriefing; the only
 * delta is the header title and the cool (blue) tone instead of the warm
 * (amber) tone so the two surfaces read as distinct at a glance.
 *
 * Note for T3's morning-merge: this is a minimal placeholder. If T3 lands a
 * richer version, take that one — both consume the same MorningBriefing
 * primitive and the same Briefing type from lib/types, so substitution is
 * a one-line swap in /sources.
 */

import type { Briefing, BriefingItem } from "@/lib/types";
import { MorningBriefing } from "./MorningBriefing";

interface PipelineHealthBriefingProps {
  briefing: Briefing | null;
  onRefresh?: () => void;
  refreshing?: boolean;
  onItemAsk?: (item: BriefingItem, index: number) => void;
}

export function PipelineHealthBriefing({
  briefing,
  onRefresh,
  refreshing,
  onItemAsk,
}: PipelineHealthBriefingProps) {
  return (
    <MorningBriefing
      items={briefing?.items ?? []}
      lastGenerated={briefing ? new Date(briefing.generated_at) : undefined}
      onRefresh={onRefresh}
      refreshing={refreshing}
      onItemAsk={onItemAsk}
      title="Pipeline Health"
      tone="blue"
    />
  );
}
