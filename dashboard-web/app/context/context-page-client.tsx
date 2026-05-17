"use client";

import { useState } from "react";
import { Sliders, Users, FileText, AlertCircle, Activity, Filter } from "lucide-react";

import { Badge, PageHeader, SectionLabel } from "@/components/ui";

import { ArchetypeCard } from "./_components/ArchetypeCard";
import { PreferencesPanel } from "./_components/PreferencesPanel";
import { ResumesPanel } from "./_components/ResumesPanel";
import { ReviewQueuePanel } from "./_components/ReviewQueuePanel";
import { RecentEventsPanel } from "./_components/RecentEventsPanel";
import { FilteredPanel } from "./_components/FilteredPanel";

interface Archetype {
  id: string;
  name: string;
  description: string;
  maturity: string;
  resume: string;
  required_signals?: string[];
  reward_signals?: Array<{ keywords: string[]; weight: number }>;
  title_signals?: { high_match?: string[]; medium_match?: string[]; low_match?: string[] };
  institutional_companies_boost?: { tier_1?: string[]; tier_2?: string[] };
  company_filter?: Record<string, unknown>;
}

interface LibraryBullet {
  id: string;
  text: string;
  archetypes: string[];
  tags: string[];
  impact_metric: string | null;
  role: string;
}

interface FilteredRow {
  url: string;
  title: string;
  company: string;
  reason: string;
  assessed_at: string | null;
}

interface ContextPageClientProps {
  archetypes: Archetype[];
  globalDisqualifiers: Record<string, unknown>;
  userContext: Record<string, unknown>;
  library: { archetypes: string[]; bullets: LibraryBullet[]; current_titles_at_linera: string[] } | null;
  archetypeCounts: Record<string, number>;
  needsReview: Array<{
    url: string;
    title: string;
    company: string;
    primary: string | null;
    confidence: number;
    secondary: string[];
    reasoning: string;
  }>;
  recentEvents: Array<Record<string, unknown>>;
  filteredRows: FilteredRow[];
  filteredCounts: Record<string, number>;
}

type Section = "archetypes" | "preferences" | "resumes" | "review" | "filtered" | "events";

const SECTIONS: Array<{ key: Section; label: string; icon: typeof Users }> = [
  { key: "archetypes", label: "Archetypes", icon: Users },
  { key: "preferences", label: "Preferences", icon: Sliders },
  { key: "resumes", label: "Resumes", icon: FileText },
  { key: "review", label: "Review queue", icon: AlertCircle },
  { key: "filtered", label: "Filtered", icon: Filter },
  { key: "events", label: "Recent events", icon: Activity },
];

export function ContextPageClient({
  archetypes,
  globalDisqualifiers,
  userContext,
  library,
  archetypeCounts,
  needsReview,
  recentEvents,
  filteredRows,
  filteredCounts,
}: ContextPageClientProps) {
  const [section, setSection] = useState<Section>("archetypes");

  const reviewCount = needsReview.length;
  const filteredTotal = filteredRows.length;

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Context"
        subtitle="Configure how CareerOps thinks about your job search — archetypes, preferences, resumes, and the review queue."
        icon={<Sliders size={20} />}
      />

      {/* Tab strip */}
      <div className="flex flex-wrap gap-2">
        {SECTIONS.map((s) => {
          const Icon = s.icon;
          const active = section === s.key;
          const badge =
            s.key === "review" && reviewCount > 0
              ? reviewCount
              : s.key === "filtered" && filteredTotal > 0
                ? filteredTotal
                : s.key === "archetypes"
                  ? archetypes.length
                  : undefined;
          return (
            <button
              key={s.key}
              onClick={() => setSection(s.key)}
              className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-[13px] font-medium transition-colors ${
                active
                  ? "border-accent bg-accent-dim text-accent"
                  : "border-border-subtle bg-surface-1 text-text-tertiary hover:bg-surface-3 hover:text-text-secondary"
              }`}
            >
              <Icon size={14} />
              {s.label}
              {badge !== undefined && (
                <Badge color={active ? "accent" : "neutral"} className="ml-1">
                  {badge}
                </Badge>
              )}
            </button>
          );
        })}
      </div>

      {/* Section body */}
      <div className="rounded-xl border border-border-subtle bg-surface-1 p-6">
        {section === "archetypes" && (
          <div className="space-y-4">
            <SectionLabel>5 archetypes — used by the hybrid classifier (G3) + scoring layer (G4)</SectionLabel>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {archetypes.map((a) => (
                <ArchetypeCard
                  key={a.id}
                  archetype={a}
                  roleCount={archetypeCounts[a.id] ?? 0}
                />
              ))}
            </div>
          </div>
        )}

        {section === "preferences" && (
          <PreferencesPanel userContext={userContext} globalDisqualifiers={globalDisqualifiers} />
        )}

        {section === "resumes" && <ResumesPanel library={library} />}

        {section === "review" && <ReviewQueuePanel rows={needsReview} archetypes={archetypes} />}

        {section === "filtered" && (
          <FilteredPanel rows={filteredRows} countsByReason={filteredCounts} />
        )}

        {section === "events" && <RecentEventsPanel events={recentEvents} />}
      </div>
    </div>
  );
}
