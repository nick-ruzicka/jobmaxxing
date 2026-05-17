// Hybrid archetype classifier.
//
// Stage 1 (rules): score each archetype against the JD title / body / company.
// Stage 2 (Claude): if top-two are within DISAMBIGUATION_GAP, ask Claude to
// disambiguate — but only if budget remains and the caller hasn't requested
// rules-only.
//
// Public:
//   classifyArchetype(role, opts?) → { primary, confidence, secondary, reasoning,
//                                       classified_at, needs_review, stage }

import { getAllArchetypes, loadArchetypeConfig } from "./archetype-config.mjs";
import { hasBudget, trackCall } from "./claude-budget.mjs";
import { buildDisambiguationPrompt } from "./archetype-classifier-prompt.mjs";

// Tunables (exported for tests + visibility from the /context route)
//
// `confidence` reflects ABSOLUTE match quality of the primary archetype.
// `gap_ratio` (raw_score-based) separately gates Stage 2 disambiguation when
// the top two archetypes score close.
export const SATURATION_POINT = 100;
export const NEEDS_REVIEW_THRESHOLD = 0.8;
export const DISAMBIGUATION_GAP = 0.15; // gap_ratio < this triggers Stage 2
export const SECONDARY_TAG_THRESHOLD = 0.4; // fitness >= this → tagged as secondary
export const ESTIMATED_CLAUDE_COST_PER_CALL = 0.02; // ~$0.02/call for Sonnet, ~2K in / 400 out
// Minimum raw_score for a classification to be considered a real match. Below
// this, primary returns null (rather than the YAML-first archetype) and the
// role is flagged needs_review. Empirically chosen at 10 — see
// WORK_LOG_POST_TASK_G.md threshold analysis: raw 0-9 is dominated by broken-
// content scrapes and pure-default fall-through; raw 10+ retains borderline
// real matches like "GTM AI Engineer @ Superhuman" (raw=15).
export const NO_MATCH_THRESHOLD = 10;

const CLAUDE_MODEL = "claude-sonnet-4-20250514";

/**
 * Classify a role into one or more archetypes.
 *
 * @param {object} role - { title, company, description, requirements?, ats? }
 * @param {object} [opts]
 * @param {boolean} [opts.rulesOnly] - skip Stage 2 Claude disambiguation
 * @param {object[]} [opts.archetypes] - override loaded config (tests)
 * @param {Function} [opts.claudeCaller] - injectable fetcher (tests)
 * @returns {Promise<object>} classification result
 */
export async function classifyArchetype(role, opts = {}) {
  const archetypes = opts.archetypes ?? getAllArchetypes(opts.config);
  const stage1 = scoreAllArchetypes(role, archetypes);

  const primary = stage1[0];
  const runnerUp = stage1[1];
  const hasReasonableMatch = !!primary && primary.raw_score >= NO_MATCH_THRESHOLD;
  const gapRatio =
    primary && primary.raw_score > 0
      ? (primary.raw_score - (runnerUp?.raw_score ?? 0)) / primary.raw_score
      : 0;

  let result;
  if (!hasReasonableMatch) {
    result = {
      primary: null,
      confidence: 0,
      secondary: [],
      reasoning: `no-match: no archetype scored >= ${NO_MATCH_THRESHOLD} (top: ${primary?.id ?? "none"}=${primary?.raw_score ?? 0})`,
      classified_at: new Date().toISOString(),
      needs_review: true,
      stage: "rules",
    };
  } else {
    result = {
      primary: primary.id,
      confidence: round(primary.fitness),
      secondary: stage1.slice(1).filter((s) => s.fitness >= SECONDARY_TAG_THRESHOLD).map((s) => s.id),
      reasoning: `rules: ${stage1.map((s) => `${s.id}=${round(s.fitness)}`).join(", ")}`,
      classified_at: new Date().toISOString(),
      needs_review: primary.fitness < NEEDS_REVIEW_THRESHOLD,
      stage: "rules",
    };
  }

  // Stage 2: Claude disambiguation when top-two are close (gap_ratio < threshold).
  // Only fires when we have a reasonable primary match — no point disambiguating
  // a no-match case (everything scored zero).
  const close = hasReasonableMatch && primary.fitness >= 0.5 && gapRatio < DISAMBIGUATION_GAP;
  const shouldDisambiguate =
    close &&
    !opts.rulesOnly &&
    hasBudget() &&
    (opts.claudeCaller || process.env.ANTHROPIC_API_KEY);

  if (shouldDisambiguate) {
    try {
      const top = stage1.slice(0, 3);
      const refined = await disambiguateWithClaude(role, top, archetypes, opts.claudeCaller);
      if (refined) {
        result = {
          primary: refined.primary ?? result.primary,
          confidence: round(refined.confidence ?? result.confidence),
          secondary: refined.secondary ?? result.secondary,
          reasoning: `claude: ${refined.reasoning ?? ""}`.slice(0, 300),
          classified_at: new Date().toISOString(),
          needs_review: (refined.confidence ?? result.confidence) < NEEDS_REVIEW_THRESHOLD,
          stage: "claude",
        };
        trackCall(ESTIMATED_CLAUDE_COST_PER_CALL);
      }
    } catch (err) {
      // Disambiguation failed — keep rules result, flag review needed
      result.reasoning += ` (claude disambiguation failed: ${err.message})`;
      result.needs_review = true;
    }
  } else if (close) {
    // Close call but we didn't disambiguate (budget out, or rules-only requested)
    result.needs_review = true;
  }

  return result;
}

function scoreAllArchetypes(role, archetypes) {
  const titleLower = (role.title || "").toLowerCase();
  const bodyLower = ((role.description || "") + " " + (role.requirements || "")).toLowerCase();
  const companyLower = (role.company || "").toLowerCase();

  const results = [];
  for (const a of archetypes) {
    let score = 0;
    const breakdown = [];

    const ts = a.title_signals ?? {};
    if (ts.high_match?.some((t) => titleLower.includes(t.toLowerCase()))) {
      score += 100;
      breakdown.push("title:high");
    } else if (ts.medium_match?.some((t) => titleLower.includes(t.toLowerCase()))) {
      score += 50;
      breakdown.push("title:medium");
    } else if (ts.low_match?.some((t) => titleLower.includes(t.toLowerCase()))) {
      score += 20;
      breakdown.push("title:low");
    }

    for (const group of a.reward_signals ?? []) {
      for (const kw of group.keywords ?? []) {
        if (bodyLower.includes(kw.toLowerCase())) {
          score += group.weight;
          breakdown.push(`kw:${kw}(+${group.weight})`);
        }
      }
    }

    const boost = a.institutional_companies_boost;
    if (boost) {
      if (boost.tier_1?.some((c) => companyLower.includes(c.toLowerCase()))) {
        score += 50;
        breakdown.push("inst-tier-1");
      } else if (boost.tier_2?.some((c) => companyLower.includes(c.toLowerCase()))) {
        score += 25;
        breakdown.push("inst-tier-2");
      }
    }

    results.push({
      id: a.id,
      raw_score: score,
      fitness: Math.min(1.0, score / SATURATION_POINT),
      breakdown,
    });
  }
  // Sort by raw_score (not fitness) so ties between saturated archetypes resolve
  // to the higher absolute scorer rather than YAML order.
  results.sort((a, b) => b.raw_score - a.raw_score);
  return results;
}

async function disambiguateWithClaude(role, candidates, archetypes, caller) {
  const prompt = buildDisambiguationPrompt(role, candidates, archetypes);
  const text = caller
    ? await caller(prompt)
    : await callAnthropic(prompt);

  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("no JSON in claude response");
  const parsed = JSON.parse(match[0]);

  // Validate structure
  if (!parsed.primary || !archetypes.find((a) => a.id === parsed.primary)) {
    throw new Error(`unknown primary: ${parsed.primary}`);
  }
  if (!Array.isArray(parsed.secondary)) parsed.secondary = [];
  for (const s of parsed.secondary) {
    if (!archetypes.find((a) => a.id === s)) {
      throw new Error(`unknown secondary: ${s}`);
    }
  }
  if (typeof parsed.confidence !== "number") {
    parsed.confidence = 0.5;
  }
  parsed.confidence = Math.max(0, Math.min(1, parsed.confidence));
  return parsed;
}

async function callAnthropic(prompt) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 400,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`anthropic ${res.status}: ${err.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.content?.[0]?.text ?? "";
}

function round(n) {
  return Math.round(n * 100) / 100;
}

// Re-export for callers that want to fall back to config loading.
export { loadArchetypeConfig };
