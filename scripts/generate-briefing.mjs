#!/usr/bin/env node
// scripts/generate-briefing.mjs
//
// Generates today's briefing for the /today route. Reads pipeline + application
// data, builds candidate pools deterministically, and makes ONE Claude API call
// to compose the final BriefingItem list. Writes data/briefings/YYYY-MM-DD.json.
//
// Also prunes data/chats/*.json older than 30 days on every run (cheap to
// piggyback here; nothing else owns chat retention).
//
// Usage:
//   node scripts/generate-briefing.mjs               # writes today's briefing
//   node scripts/generate-briefing.mjs --dry-run     # print prompt + summary, no write
//   node scripts/generate-briefing.mjs --kind=pipeline-health   # forwards to generate-pipeline-health.mjs

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { getCompFloorUsd, formatCompFloorString } from "./lib/comp-floor.mjs";
import { defaultGoalFallback } from "./lib/default-goal.mjs";
import {
  BRIEFING_APPLY_THRESHOLD,
  BRIEFING_MISSED_THRESHOLD,
  BRIEFING_RECALIBRATE_MIN,
  BRIEFING_RECALIBRATE_MAX,
  STALE_APPLICATION_DAYS,
  CHAT_PRUNING_DAYS,
} from "./lib/thresholds.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// ---------------------------------------------------------------------------
// .env loader — no dep, just KEY=VALUE lines, ignores comments and quotes.
// ---------------------------------------------------------------------------
function loadEnv() {
  const path = join(ROOT, ".env");
  if (!existsSync(path)) return;
  const raw = readFileSync(path, "utf-8");
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    const key = m[1];
    let val = m[2];
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

// ---------------------------------------------------------------------------
// Date helpers — local-time YYYY-MM-DD, matches what lib/data.ts reads back.
// ---------------------------------------------------------------------------
function todayDateString() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function daysAgo(isoDate) {
  if (!isoDate) return Infinity;
  const then = new Date(isoDate).getTime();
  if (Number.isNaN(then)) return Infinity;
  return Math.floor((Date.now() - then) / 86_400_000);
}

// ---------------------------------------------------------------------------
// Pipeline data loaders
// ---------------------------------------------------------------------------
function loadEnrichments() {
  const path = join(ROOT, "data", "enrichments.json");
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, "utf-8"));
}

function loadSeenUrls() {
  const path = join(ROOT, "data", "seen-urls.json");
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, "utf-8"));
}

/** Parse data/applications.md. Returns [{ num, date, company, role, score, status, notes }]. */
function loadApplications() {
  const path = join(ROOT, "data", "applications.md");
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, "utf-8");
  const rows = [];
  for (const line of raw.split("\n")) {
    // Skip header / separator / non-table rows.
    if (!line.startsWith("|")) continue;
    if (line.includes("---")) continue;
    if (line.includes("Date") && line.includes("Company") && line.includes("Role")) continue;
    const cells = line
      .split("|")
      .slice(1, -1) // strip the leading/trailing | wraps
      .map((c) => c.trim());
    if (cells.length < 8) continue;
    rows.push({
      num: cells[0],
      date: cells[1],
      company: cells[2],
      role: cells[3],
      score: cells[4],
      // The header column reads "Applied" but is actually the canonical status
      // (Applied/Evaluated/Interview/Rejected/Skipped/Offer/Discarded). See
      // CLAUDE.md "Canonical States" — that's the source of truth.
      status: cells[5],
      pdf: cells[6],
      report: cells[7],
      notes: cells[8] ?? "",
    });
  }
  return rows;
}

function loadProfile() {
  const path = join(ROOT, "modes", "_profile.md");
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf-8");
}

// ---------------------------------------------------------------------------
// Goal text — used as the "what is the user actually targeting" block in the
// prompt. Pulled from modes/_profile.md when present, else the documented
// fallback from the T4 spec.
// ---------------------------------------------------------------------------
function extractGoals(profile) {
  if (!profile) {
    return defaultGoalFallback(formatCompFloorString(getCompFloorUsd()));
  }
  // Pull the Background + Target Roles sections — they're enough to ground the
  // agent without exploding the prompt. Cap at ~4KB so the rest of the context
  // has room.
  const sections = [];
  const grab = (heading) => {
    const re = new RegExp(`##\\s+${heading}[\\s\\S]*?(?=\\n##\\s+|$)`, "i");
    const m = profile.match(re);
    if (m) sections.push(m[0].slice(0, 2000));
  };
  grab("Background");
  grab("Your Target Roles");
  grab("Career Narrative");
  return sections.join("\n\n").slice(0, 4000);
}

// ---------------------------------------------------------------------------
// Candidate pool builders — pure functions on the loaded data. Output is a
// compact summary the LLM can reason over.
// ---------------------------------------------------------------------------

/** Merge seen-urls + enrichments into a single role record per URL. */
function buildRoles(seenUrls, enrichments) {
  const out = [];
  for (const [url, meta] of Object.entries(seenUrls)) {
    const e = enrichments[url] || {};
    if (e.error) continue; // scrape failures are not actionable
    out.push({
      url,
      title: meta.title || "(untitled)",
      company: meta.company || "",
      firstSeen: meta.firstSeen || "",
      location: meta.location || "",
      location_workplace: meta.location_workplace || "unknown",
      location_city: meta.location_city ?? null,
      fit_score: typeof e.fit_score === "number" ? e.fit_score : null,
      comp_range: e.comp_range || null,
      stack: Array.isArray(e.stack) ? e.stack : [],
      green_flags: Array.isArray(e.green_flags) ? e.green_flags : [],
      red_flags: Array.isArray(e.red_flags) ? e.red_flags : [],
      verdict: e.verdict || "",
      company_stage: e.company_stage || "",
      ai_signal: !!e.ai_signal,
      build_component: !!e.build_component,
    });
  }
  return out;
}

/** Status set from applications.md, keyed by lowercased "company|role". Used
 *  to filter out roles the user has already applied to from the "apply" /
 *  "missed" pools. */
function buildAppliedSet(applications) {
  const set = new Set();
  for (const app of applications) {
    const key = `${(app.company || "").toLowerCase()}|${(app.role || "").toLowerCase()}`;
    set.add(key);
  }
  return set;
}

/** Top N highest-fit Discovered roles (no application row, fit_score >= apply threshold). */
function topApplyCandidates(roles, appliedSet, n = 5) {
  return roles
    .filter((r) => r.fit_score !== null && r.fit_score >= BRIEFING_APPLY_THRESHOLD)
    .filter((r) => !appliedSet.has(`${r.company.toLowerCase()}|${r.title.toLowerCase()}`))
    .sort((a, b) => (b.fit_score ?? 0) - (a.fit_score ?? 0))
    .slice(0, n);
}

/** Applications stale beyond STALE_APPLICATION_DAYS, non-terminal. Terminal = Rejected, Skipped, Discarded, Offer. */
function staleApplications(applications) {
  const TERMINAL = new Set(["rejected", "skipped", "discarded", "offer"]);
  return applications
    .filter((a) => {
      const s = (a.status || "").toLowerCase().trim();
      return !TERMINAL.has(s) && s !== "" && s !== "discovered";
    })
    .map((a) => ({ ...a, days_stale: daysAgo(a.date) }))
    .filter((a) => a.days_stale > STALE_APPLICATION_DAYS)
    .sort((a, b) => b.days_stale - a.days_stale);
}

/** High-fit roles you might've missed — Discovered + not applied. */
function missedCandidates(roles, appliedSet, n = 5) {
  return roles
    .filter((r) => r.fit_score !== null && r.fit_score >= BRIEFING_MISSED_THRESHOLD)
    .filter((r) => !appliedSet.has(`${r.company.toLowerCase()}|${r.title.toLowerCase()}`))
    .sort((a, b) => (b.fit_score ?? 0) - (a.fit_score ?? 0))
    .slice(0, n);
}

/** Top-fit roles missing location metadata — recoverable by a manual check. */
function verifyLocationCandidates(roles, n = 5) {
  return roles
    .filter((r) => r.fit_score !== null && r.fit_score >= BRIEFING_APPLY_THRESHOLD)
    .filter((r) => r.location_workplace === "unknown" || r.location_city === null)
    .sort((a, b) => (b.fit_score ?? 0) - (a.fit_score ?? 0))
    .slice(0, n);
}

/** Mid-band (4-6) roles where the agent might revise the score after a deeper
 *  read. We surface candidates; the LLM picks which (if any) actually warrant
 *  surfacing as a "recalibrate" item. */
function recalibrateCandidates(roles, n = 5) {
  return roles
    .filter((r) => r.fit_score !== null && r.fit_score >= BRIEFING_RECALIBRATE_MIN && r.fit_score <= BRIEFING_RECALIBRATE_MAX)
    .sort((a, b) => (b.fit_score ?? 0) - (a.fit_score ?? 0))
    .slice(0, n);
}

// ---------------------------------------------------------------------------
// Prompt assembly
// ---------------------------------------------------------------------------
function compactRole(r) {
  return {
    url: r.url,
    title: r.title,
    company: r.company,
    location: r.location,
    fit_score: r.fit_score,
    comp_range: r.comp_range,
    stack: r.stack.slice(0, 6),
    company_stage: r.company_stage,
    green_flags: r.green_flags.slice(0, 3),
    red_flags: r.red_flags.slice(0, 3),
    verdict: r.verdict.slice(0, 400),
    days_since_seen: daysAgo(r.firstSeen),
  };
}

function buildPrompt(ctx) {
  const date = ctx.date;
  return `You are the daily agent for a job search system. Today is ${date}. Your job is to compose a brief, actionable morning briefing for the user.

USER GOALS AND CONTEXT:
${ctx.goals}

PIPELINE CONTEXT (deterministically pre-filtered — you choose which to surface, you don't recompute):

TOP_APPLY_CANDIDATES (Discovered, fit_score >= ${BRIEFING_APPLY_THRESHOLD}, not yet applied):
${JSON.stringify(ctx.applyCandidates, null, 2)}

STALE_APPLICATIONS (non-terminal status, > ${STALE_APPLICATION_DAYS} days since application date):
${JSON.stringify(ctx.staleApps, null, 2)}

MISSED_CANDIDATES (fit_score >= ${BRIEFING_MISSED_THRESHOLD}, not yet applied — may overlap with apply candidates):
${JSON.stringify(ctx.missedCandidates, null, 2)}

VERIFY_LOCATION_CANDIDATES (fit_score >= ${BRIEFING_APPLY_THRESHOLD} with unknown workplace/city):
${JSON.stringify(ctx.verifyLocationCandidates, null, 2)}

RECALIBRATE_CANDIDATES (fit_score ${BRIEFING_RECALIBRATE_MIN}-${BRIEFING_RECALIBRATE_MAX} — judge whether the verdict + flags suggest a higher score):
${JSON.stringify(ctx.recalibrateCandidates, null, 2)}

INTERVIEWS_TODAY_AND_TOMORROW: (calendar integration not yet wired — assume empty unless surfaced via the stale apps' notes)

INSTRUCTIONS:
Compose a JSON briefing with at most:
- 1 "apply" item — the single highest-leverage application target for today. Pick from TOP_APPLY_CANDIDATES. The subtitle should be a tight 1-sentence "why now" (stage, stack fit, days since seen, comp signal).
- 1-2 "follow_up" items — pick the staleest non-terminal applications. Include a drafted follow-up message in context.draft_message (3-5 sentences, professional, references the role specifics).
- 1-2 "missed" items — only if they're NOT already in your "apply" pick and are genuinely high-fit (>=7). Skip if redundant with "apply".
- 1-2 "verify_location" items — low-priority but useful, top-fit only.
- 1-2 "recalibrate" items — only if the verdict + flags clearly support a score >=7 despite the current 4-6 score. Include the proposed new score and reasoning in context.

If the pipeline is genuinely quiet (no actionable items), return { "items": [] }. Don't pad.

For each item, return:
- type: one of "apply" | "follow_up" | "missed" | "verify_location" | "recalibrate"
- title: short, scannable headline (≤80 chars)
- subtitle: one tight sentence with the "why" (≤140 chars)
- action_label: short verb phrase ("View role", "Open draft", "Re-evaluate", "Set location")
- action_href: the role URL (action items pointing at /pipeline, /interviews, etc. for non-URL items are fine)
- context: object with item-specific payload — for "apply"/"missed"/"recalibrate" include { url, company, company_slug, role, fit_score, comp_range, stack, verdict_excerpt }; for "follow_up" include { company, company_slug, role, days_stale, status, draft_message }; for "verify_location" include { url, company, company_slug, role, location_string }. company_slug is the company name lowercased with non-alphanumerics removed (e.g. "Anthropic" → "anthropic", "OpenAI" → "openai", "Mistral AI" → "mistralai"). Used by the UI for deep-linking into /pipeline?company=<slug>&from=briefing.

Return ONLY valid JSON in this exact shape, no markdown, no commentary:
{ "items": [ ... ] }`;
}

// ---------------------------------------------------------------------------
// Claude API call
// ---------------------------------------------------------------------------
async function callClaude(prompt) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set (looked in .env and process.env)");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-opus-4-7",
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    // Credit-exhausted detection — surfaced via a sentinel prefix so the
    // dashboard's /api/briefing/regenerate route can return a structured 402
    // with a top-up link instead of a raw stderr dump in the regen toast.
    let parsedErr = null;
    try { parsedErr = JSON.parse(body); } catch {}
    const apiMsg = parsedErr?.error?.message ?? "";
    if (res.status === 400 && /credit balance|credits.*too low|purchase credits/i.test(apiMsg)) {
      throw new Error(`CREDITS_EXHAUSTED: ${apiMsg}`);
    }
    throw new Error(`Anthropic API ${res.status}: ${body.slice(0, 500)}`);
  }

  const json = await res.json();
  const text = json.content?.[0]?.text;
  if (!text) throw new Error("Anthropic response missing content text");
  return text;
}

/** Parse Claude's response — tolerate markdown fences, leading/trailing chatter. */
function parseBriefingResponse(text) {
  // Strip markdown code fences if Claude wrapped the JSON.
  let body = text.trim();
  const fence = body.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) body = fence[1].trim();
  // If there's still chatter, grab the first {...} balanced block.
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("Response had no JSON object");
  const jsonStr = body.slice(start, end + 1);
  const parsed = JSON.parse(jsonStr);
  if (!Array.isArray(parsed.items)) throw new Error("Response JSON missing items[] array");
  return parsed;
}

// ---------------------------------------------------------------------------
// Chat retention — prune data/chats/*.json older than 30 days.
// ---------------------------------------------------------------------------
function pruneOldChats() {
  const dir = join(ROOT, "data", "chats");
  if (!existsSync(dir)) return { pruned: 0 };
  const cutoff = Date.now() - CHAT_PRUNING_DAYS * 86_400_000;
  let pruned = 0;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    const full = join(dir, f);
    try {
      const st = statSync(full);
      if (st.mtimeMs < cutoff) {
        unlinkSync(full);
        pruned++;
      }
    } catch {
      // ignore — could be a race with another process writing the file
    }
  }
  return { pruned };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  loadEnv();

  const args = new Set(process.argv.slice(2));
  const dryRun = args.has("--dry-run");

  // If the caller asked for the pipeline-health flavor, forward to the sibling
  // script — this keeps the cron entry "node scripts/generate-briefing.mjs"
  // canonical even if you want to run both from the same invocation.
  if (args.has("--kind=pipeline-health")) {
    const mod = await import("./generate-pipeline-health.mjs");
    return mod.main();
  }

  const date = todayDateString();
  console.error(`[briefing] generating for ${date}`);

  const enrichments = loadEnrichments();
  const seenUrls = loadSeenUrls();
  const applications = loadApplications();
  const profile = loadProfile();

  const roles = buildRoles(seenUrls, enrichments);
  const appliedSet = buildAppliedSet(applications);

  const ctx = {
    date,
    goals: extractGoals(profile),
    applyCandidates: topApplyCandidates(roles, appliedSet, 5).map(compactRole),
    staleApps: staleApplications(applications).slice(0, 8),
    missedCandidates: missedCandidates(roles, appliedSet, 5).map(compactRole),
    verifyLocationCandidates: verifyLocationCandidates(roles, 5).map(compactRole),
    recalibrateCandidates: recalibrateCandidates(roles, 5).map(compactRole),
  };

  console.error(
    `[briefing] candidates — apply:${ctx.applyCandidates.length} stale:${ctx.staleApps.length} missed:${ctx.missedCandidates.length} verifyLoc:${ctx.verifyLocationCandidates.length} recalibrate:${ctx.recalibrateCandidates.length}`
  );

  const prompt = buildPrompt(ctx);

  if (dryRun) {
    console.log(prompt);
    return;
  }

  console.error(`[briefing] calling Claude (prompt ~${prompt.length} chars)…`);
  const responseText = await callClaude(prompt);
  const { items } = parseBriefingResponse(responseText);

  const briefing = {
    date,
    generated_at: new Date().toISOString(),
    items,
  };

  const outDir = join(ROOT, "data", "briefings");
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `${date}.json`);
  writeFileSync(outPath, JSON.stringify(briefing, null, 2) + "\n");
  console.error(`[briefing] wrote ${outPath} (${items.length} items)`);

  // Track last-regen timestamp for the rate limiter in Task 3 — per-kind file
  // so daily and pipeline-health don't clobber each other's throttle window.
  writeFileSync(
    join(outDir, "last-regen-daily.json"),
    JSON.stringify({ kind: "daily", at: briefing.generated_at }, null, 2) + "\n"
  );

  const { pruned } = pruneOldChats();
  if (pruned > 0) console.error(`[briefing] pruned ${pruned} chat file(s) older than 30 days`);

  // Print the items list to stdout so the regenerate API route (Task 3) can
  // capture it without re-reading the file.
  console.log(JSON.stringify(briefing));
}

// Allow other scripts to import the helpers (e.g. tests) without auto-running.
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((err) => {
    console.error(`[briefing] ERROR: ${err.message}`);
    process.exit(1);
  });
}

export {
  main,
  buildRoles,
  loadApplications,
  staleApplications,
  topApplyCandidates,
  missedCandidates,
  verifyLocationCandidates,
  recalibrateCandidates,
  parseBriefingResponse,
  // Shared runtime helpers — generate-pipeline-health.mjs re-uses these so
  // the .env loading, the Claude call, and the response parser stay in one place.
  loadEnv,
  todayDateString,
  callClaude,
  pruneOldChats,
  ROOT,
};
