// /context — Configuration surface for archetypes, preferences, resumes,
// review queue, and recent events. Server-fetches everything, hands to the
// client component for layout.
//
// MVP shape per Task G G6 time-budget fallback: read-only views of all
// archetype + scoring + resume + classification data. Edit/save workflows
// (preferences inline edit, archetype tuning, onboarding wizard) deferred
// to a V2 pass.

import { readFileSync, existsSync } from "fs";
import { join } from "path";

import { loadArchetypeConfig } from "../../../scripts/lib/archetype-config.mjs";
import { loadUserContext } from "../../../scripts/lib/scoring-layer.mjs";
import { readEvents } from "../../../scripts/lib/event-aggregator.mjs";

import { ContextPageClient } from "./context-page-client";

export const dynamic = "force-dynamic";

function repoRoot() {
  return join(process.cwd(), "..");
}

function loadResumeLibrary() {
  const p = join(repoRoot(), "autoapply", "resumes", "library.json");
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function loadEnrichments() {
  const p = join(repoRoot(), "data", "enrichments.json");
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return {};
  }
}

function loadSeen() {
  const p = join(repoRoot(), "data", "seen-urls.json");
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return {};
  }
}

export default function Page() {
  const archetypeConfig = loadArchetypeConfig();
  const userContext = loadUserContext();
  const library = loadResumeLibrary();
  const enrichments = loadEnrichments();
  const seen = loadSeen();

  // Aggregate per-archetype role counts and needs-review queue
  const archetypeCounts: Record<string, number> = {};
  const needsReview: Array<{
    url: string;
    title: string;
    company: string;
    primary: string | null;
    confidence: number;
    secondary: string[];
    reasoning: string;
  }> = [];

  for (const [url, e] of Object.entries(enrichments) as [string, Record<string, unknown>][]) {
    const primary = e.archetype_primary as string | undefined;
    if (primary) {
      archetypeCounts[primary] = (archetypeCounts[primary] || 0) + 1;
    }
    if (e.archetype_needs_review) {
      const seenE = (seen as Record<string, Record<string, unknown>>)[url] ?? {};
      needsReview.push({
        url,
        title: (seenE.title as string) || (e.title as string) || "(no title)",
        company: (seenE.company as string) || (e.company as string) || "",
        primary: primary ?? null,
        confidence: (e.archetype_confidence as number) ?? 0,
        secondary: (e.archetype_secondary as string[]) ?? [],
        reasoning: (e.archetype_reasoning as string) ?? "",
      });
    }
  }
  needsReview.sort((a, b) => a.confidence - b.confidence);

  // Recent events (last 50). readEvents() comes from a .mjs module without
  // strict typings — coerce through unknown so TS is content.
  let recentEvents: Array<Record<string, unknown>> = [];
  try {
    const raw = readEvents({}) as unknown as Array<Record<string, unknown>>;
    recentEvents = raw.slice(-50).reverse();
  } catch {
    recentEvents = [];
  }

  return (
    <ContextPageClient
      archetypes={archetypeConfig.archetypes}
      globalDisqualifiers={archetypeConfig.global_disqualifiers ?? {}}
      userContext={userContext}
      library={library}
      archetypeCounts={archetypeCounts}
      needsReview={needsReview}
      recentEvents={recentEvents}
    />
  );
}
