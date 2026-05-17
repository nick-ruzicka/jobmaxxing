"use client";

import { Users, Shield, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui";

interface Archetype {
  id: string;
  name: string;
  description: string;
  maturity: string;
  resume: string;
  reward_signals?: Array<{ keywords: string[]; weight: number }>;
  title_signals?: { high_match?: string[]; medium_match?: string[]; low_match?: string[] };
  institutional_companies_boost?: { tier_1?: string[]; tier_2?: string[] };
}

export function ArchetypeCard({
  archetype,
  roleCount,
}: {
  archetype: Archetype;
  roleCount: number;
}) {
  // primary = aspirational (accent), conditional = neutral, fallback = amber/caution
  const maturityColor: "accent" | "neutral" | "amber" =
    archetype.maturity === "primary"
      ? "accent"
      : archetype.maturity === "fallback"
        ? "amber"
        : "neutral";
  const totalKeywords = (archetype.reward_signals ?? []).reduce(
    (sum, g) => sum + (g.keywords?.length ?? 0),
    0,
  );
  const tier1Count = archetype.institutional_companies_boost?.tier_1?.length ?? 0;
  const tier2Count = archetype.institutional_companies_boost?.tier_2?.length ?? 0;

  return (
    <div className="rounded-lg border border-border-subtle bg-surface-2 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-[14px] font-semibold text-text-primary">{archetype.name}</h3>
            <Badge color={maturityColor}>{archetype.maturity}</Badge>
          </div>
          <p className="mt-1 text-[12px] text-text-tertiary">{archetype.description}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <div className="text-[18px] font-semibold text-text-primary">{roleCount}</div>
          <div className="text-[10px] uppercase tracking-wide text-text-tertiary">roles tagged</div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-text-tertiary">
        <span className="inline-flex items-center gap-1 rounded bg-surface-3 px-2 py-1">
          <Users size={11} />
          {totalKeywords} keywords
        </span>
        <span className="inline-flex items-center gap-1 rounded bg-surface-3 px-2 py-1">
          high-match titles: {archetype.title_signals?.high_match?.length ?? 0}
        </span>
        {(tier1Count > 0 || tier2Count > 0) && (
          <span className="inline-flex items-center gap-1 rounded bg-surface-3 px-2 py-1">
            <Shield size={11} />
            Web3 tier_1={tier1Count} tier_2={tier2Count}
          </span>
        )}
      </div>

      <div className="mt-3 flex items-center justify-between text-[11px]">
        <span className="text-text-tertiary">
          Resume: <code className="text-text-secondary">{archetype.resume.replace("autoapply/resumes/parsed/", "")}</code>
        </span>
        <a
          href={`/${archetype.resume}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-accent hover:underline"
        >
          view <ExternalLink size={10} />
        </a>
      </div>
    </div>
  );
}
