#!/usr/bin/env node
// scripts/generate-pipeline-health.mjs
//
// The system-maintainer twin of generate-briefing.mjs. Produces a briefing for
// /sources — extractor regressions, scrape failures, label opportunities, and
// suggested commands. Same hybrid runtime (cron + on-demand via the same
// /api/briefing/regenerate?kind=pipeline-health endpoint) and same single-
// Claude-call architecture as the daily briefing.
//
// Output: data/briefings/pipeline-health-YYYY-MM-DD.json (the prefix
// distinguishes it from the daily briefing — both can co-exist on the same date).

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import {
  loadEnv,
  todayDateString,
  callClaude,
  parseBriefingResponse,
  pruneOldChats,
  ROOT,
} from "./generate-briefing.mjs";

// ---------------------------------------------------------------------------
// Aggregator / spam classifications. Kept in sync with
// dashboard-web/lib/source-health.ts AGGREGATOR_HOSTS and EXCLUDE_DOMAINS.
// We duplicate (not import) because lib/source-health.ts is TypeScript and
// this script needs to run from plain Node.
// ---------------------------------------------------------------------------
const AGGREGATOR_HOSTS = new Set([
  "revopscareers.com",
  "lensa.com",
  "whatjobs.com",
  "jobright.ai",
  "jobgether.com",
]);

const EXCLUDE_DOMAINS = new Set([
  "us.jooble.org",
  "trabajo.org",
  "jobsora.com",
  "jora.com",
]);

function hostnameOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function hasRealComp(comp) {
  if (typeof comp !== "string") return false;
  const c = comp.trim();
  if (!c || c === "Not listed" || c === "None" || c === "—") return false;
  // Need at least one digit or dollar sign — qualitative "competitive" doesn't count.
  return /[\d$]/.test(c);
}

function daysAgoIso(n) {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Host-level aggregation — minimum needed for the briefing. Mirrors the
// shape of dashboard-web/lib/source-health.ts but only computes what we
// actually surface here.
// ---------------------------------------------------------------------------
function aggregateHosts(seenUrls, enrichments) {
  const hosts = new Map();
  const ensure = (host) => {
    let h = hosts.get(host);
    if (!h) {
      h = {
        host,
        urls: new Set(),
        enrichedReal: 0,
        scrapeFailures: 0,
        hasCompCount: 0,
        notListedCount: 0,
        qualitativeCompCount: 0,
        fitScores: [],
        lastSeen: "",
        firstSeenList: [],
      };
      hosts.set(host, h);
    }
    return h;
  };

  for (const [url, meta] of Object.entries(seenUrls)) {
    const host = hostnameOf(url);
    if (!host) continue;
    const h = ensure(host);
    h.urls.add(url);
    if (meta?.firstSeen) {
      h.firstSeenList.push(meta.firstSeen);
      if (meta.firstSeen > h.lastSeen) h.lastSeen = meta.firstSeen;
    }
  }

  for (const [url, entry] of Object.entries(enrichments)) {
    const host = hostnameOf(url);
    if (!host) continue;
    const h = ensure(host);
    h.urls.add(url);
    const isErr =
      entry &&
      typeof entry === "object" &&
      "error" in entry &&
      Object.keys(entry).every((k) => k === "error" || k === "timestamp");
    if (isErr) {
      h.scrapeFailures++;
      continue;
    }
    h.enrichedReal++;
    if (typeof entry.fit_score === "number") h.fitScores.push(entry.fit_score);
    if (hasRealComp(entry.comp_range)) h.hasCompCount++;
    else {
      h.notListedCount++;
      // "Qualitative" = a string that's NOT a recognized empty marker but also
      // has no digit/$ — the kind of comp that comp-extraction could probably
      // recover. Useful signal for the label-opportunity category.
      const c = entry.comp_range;
      if (typeof c === "string" && c.trim() && c.trim() !== "Not listed" && c.trim() !== "None") {
        h.qualitativeCompCount++;
      }
    }
  }

  // Classify and compute derived fields.
  return [...hosts.values()].map((h) => {
    const totalUrls = h.urls.size;
    const enrichedReal = h.enrichedReal;
    const scrapeFailures = h.scrapeFailures;
    const scrapeErrorRate =
      enrichedReal + scrapeFailures > 0
        ? scrapeFailures / (enrichedReal + scrapeFailures)
        : 0;
    const hasCompCoverage = enrichedReal > 0 ? h.hasCompCount / enrichedReal : 0;
    const avgFit =
      h.fitScores.length > 0
        ? h.fitScores.reduce((s, n) => s + n, 0) / h.fitScores.length
        : null;
    const maxFit = h.fitScores.length > 0 ? Math.max(...h.fitScores) : null;
    let status = "healthy";
    if (AGGREGATOR_HOSTS.has(h.host)) status = "quarantined";
    else if (EXCLUDE_DOMAINS.has(h.host)) status = "spam-blocked";
    else if (scrapeErrorRate > 0.4 && enrichedReal + scrapeFailures > 10) status = "broken-scrape";
    else if (
      enrichedReal >= 10 &&
      hasCompCoverage < 0.3 &&
      (maxFit ?? 0) >= 5 /* this host serves real roles, but comp's missing */
    )
      status = "broken-extractor";
    return {
      host: h.host,
      totalUrls,
      enrichedReal,
      scrapeFailures,
      scrapeErrorRate,
      hasCompCount: h.hasCompCount,
      notListedCount: h.notListedCount,
      qualitativeCompCount: h.qualitativeCompCount,
      hasCompCoverage,
      avgFit: avgFit === null ? null : Math.round(avgFit * 10) / 10,
      maxFit,
      lastSeen: h.lastSeen,
      status,
    };
  });
}

// ---------------------------------------------------------------------------
// Candidate-pool builders — surface things the maintainer might act on today.
// ---------------------------------------------------------------------------
function brokenExtractorCandidates(hosts, n = 5) {
  return hosts
    .filter((h) => h.status === "broken-extractor")
    // Bias toward hosts that serve high-fit roles — they're the most painful
    // ones to leak comp on.
    .sort((a, b) => (b.maxFit ?? 0) - (a.maxFit ?? 0) || b.enrichedReal - a.enrichedReal)
    .slice(0, n);
}

function brokenScrapeCandidates(hosts, n = 5) {
  return hosts
    .filter((h) => h.status === "broken-scrape")
    .sort((a, b) => b.scrapeFailures - a.scrapeFailures)
    .slice(0, n);
}

/** Hosts with lots of qualitative comp — explicit text but no $/digit. The
 *  prime --backfill-comp targets. */
function labelOpportunityCandidates(hosts, n = 5) {
  return hosts
    .filter((h) => h.status !== "quarantined" && h.status !== "spam-blocked")
    .filter((h) => h.qualitativeCompCount >= 5)
    .sort((a, b) => b.qualitativeCompCount - a.qualitativeCompCount)
    .slice(0, n);
}

/** Hosts active recently (firstSeen in last 7 days) but with low enrichment
 *  rate — possible new URL pattern that scrape isn't keeping up with. */
function newPatternCandidates(hosts, n = 5) {
  const cutoff = daysAgoIso(7);
  return hosts
    .filter((h) => h.lastSeen >= cutoff)
    .filter((h) => h.totalUrls >= 5)
    .filter((h) => h.enrichedReal / h.totalUrls < 0.5)
    .sort((a, b) => b.totalUrls - a.totalUrls)
    .slice(0, n);
}

// ---------------------------------------------------------------------------
// Prompt assembly
// ---------------------------------------------------------------------------
function compactHost(h) {
  return {
    host: h.host,
    status: h.status,
    totalUrls: h.totalUrls,
    enrichedReal: h.enrichedReal,
    scrapeFailures: h.scrapeFailures,
    scrapeErrorRate: Math.round(h.scrapeErrorRate * 100) / 100,
    hasCompCount: h.hasCompCount,
    notListedCount: h.notListedCount,
    qualitativeCompCount: h.qualitativeCompCount,
    hasCompCoverage: Math.round(h.hasCompCoverage * 100) / 100,
    avgFit: h.avgFit,
    maxFit: h.maxFit,
    lastSeen: h.lastSeen,
  };
}

function buildPrompt(ctx) {
  return `You are the pipeline-health agent for a job-search system. Today is ${ctx.date}. Your audience is the maintainer of the scraping/enrichment pipeline — not the job seeker. The goal is to surface CONCRETE FIXABLE THINGS, not generic observations.

OVERALL_SUMMARY:
${JSON.stringify(ctx.summary, null, 2)}

BROKEN_EXTRACTOR_CANDIDATES (hosts serving real roles but pulling almost no structured comp — enrichment-rule problem, not a scrape problem):
${JSON.stringify(ctx.brokenExtractor, null, 2)}

BROKEN_SCRAPE_CANDIDATES (high error rate at scrape time — the page is fetching/parsing wrong):
${JSON.stringify(ctx.brokenScrape, null, 2)}

LABEL_OPPORTUNITY_CANDIDATES (qualitative comp in many JDs — backfill candidates, would lift coverage if extracted):
${JSON.stringify(ctx.labelOpportunity, null, 2)}

NEW_PATTERN_CANDIDATES (recent activity but low enrichment ratio — possibly a new URL shape we're not handling):
${JSON.stringify(ctx.newPattern, null, 2)}

INSTRUCTIONS:
Produce a JSON briefing with at most:
- 0-2 "extractor_regression" items (from BROKEN_EXTRACTOR_CANDIDATES). Each title names the host, subtitle quantifies the leak ("123 enriched, 8% comp coverage — leaking 90+ rows").
- 0-2 "new_pattern" items (from NEW_PATTERN_CANDIDATES or BROKEN_SCRAPE_CANDIDATES). Each names the host + the symptom.
- 0-2 "label_opportunity" items (from LABEL_OPPORTUNITY_CANDIDATES). Subtitle should call out the recoverable count.
- 0-2 "command_suggestion" items — concrete commands the user could run today. Examples: 'npm run backfill-comp', 'npm run enrich -- --host <host>', 'npm run scan-jobs'. Pick commands grounded in the data above; don't invent flags.

If everything looks healthy (nothing actionable), return { "items": [] }.

For each item:
- type: "extractor_regression" | "new_pattern" | "label_opportunity" | "command_suggestion"
- title: ≤80 chars, host-named
- subtitle: ≤140 chars, one tight observation with a number
- action_label: short verb ("View host", "Run backfill")
- action_href: "/sources" for in-app navigation; or a host filter like "/sources?host=<host>"
- context: { host, status, enrichedReal, hasCompCoverage, qualitativeCompCount, ... } for diagnostics — pass through the relevant fields

Return ONLY valid JSON in this exact shape, no markdown, no commentary:
{ "items": [ ... ] }`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
export async function main() {
  loadEnv();
  const dryRun = process.argv.includes("--dry-run");
  const date = todayDateString();
  console.error(`[pipeline-health] generating for ${date}`);

  const seenUrls = JSON.parse(readFileSync(join(ROOT, "data", "seen-urls.json"), "utf-8"));
  const enrichments = JSON.parse(readFileSync(join(ROOT, "data", "enrichments.json"), "utf-8"));

  const hosts = aggregateHosts(seenUrls, enrichments);

  const totalHosts = hosts.length;
  const healthyHosts = hosts.filter((h) => h.status === "healthy").length;
  const brokenHosts = hosts.filter(
    (h) => h.status === "broken-extractor" || h.status === "broken-scrape"
  ).length;
  const totalEnriched = hosts.reduce((s, h) => s + h.enrichedReal, 0);
  const totalHasComp = hosts.reduce((s, h) => s + h.hasCompCount, 0);
  const overallCompCoverage = totalEnriched > 0 ? totalHasComp / totalEnriched : 0;

  const ctx = {
    date,
    summary: {
      totalHosts,
      healthyHosts,
      brokenHosts,
      totalEnriched,
      totalHasComp,
      overallCompCoverage: Math.round(overallCompCoverage * 100) / 100,
    },
    brokenExtractor: brokenExtractorCandidates(hosts, 5).map(compactHost),
    brokenScrape: brokenScrapeCandidates(hosts, 5).map(compactHost),
    labelOpportunity: labelOpportunityCandidates(hosts, 5).map(compactHost),
    newPattern: newPatternCandidates(hosts, 5).map(compactHost),
  };

  console.error(
    `[pipeline-health] candidates — brokenExtractor:${ctx.brokenExtractor.length} brokenScrape:${ctx.brokenScrape.length} labelOpp:${ctx.labelOpportunity.length} newPattern:${ctx.newPattern.length}`
  );

  const prompt = buildPrompt(ctx);
  if (dryRun) {
    console.log(prompt);
    return;
  }

  console.error(`[pipeline-health] calling Claude (prompt ~${prompt.length} chars)…`);
  const responseText = await callClaude(prompt);
  const { items } = parseBriefingResponse(responseText);

  const briefing = {
    date,
    generated_at: new Date().toISOString(),
    items,
  };

  const outDir = join(ROOT, "data", "briefings");
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `pipeline-health-${date}.json`);
  writeFileSync(outPath, JSON.stringify(briefing, null, 2) + "\n");
  console.error(`[pipeline-health] wrote ${outPath} (${items.length} items)`);

  // Per-kind last-regen file so daily and pipeline-health don't clobber each
  // other's throttle window in /api/briefing/regenerate.
  writeFileSync(
    join(outDir, "last-regen-pipeline-health.json"),
    JSON.stringify({ kind: "pipeline-health", at: briefing.generated_at }, null, 2) + "\n"
  );

  const { pruned } = pruneOldChats();
  if (pruned > 0) console.error(`[pipeline-health] pruned ${pruned} chat file(s) older than 30 days`);

  console.log(JSON.stringify(briefing));
  return briefing;
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((err) => {
    console.error(`[pipeline-health] ERROR: ${err.message}`);
    process.exit(1);
  });
}

export {
  aggregateHosts,
  brokenExtractorCandidates,
  brokenScrapeCandidates,
  labelOpportunityCandidates,
  newPatternCandidates,
};
