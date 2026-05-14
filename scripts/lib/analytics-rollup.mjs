/**
 * analytics-rollup.mjs — pure aggregation functions for the analytics pipeline.
 *
 * Takes a stream of events (see event-log.mjs) and produces a daily rollup.
 * Also exports detectAnomalies(today, priorDays) for anomaly synthesis.
 *
 * No I/O — caller passes in events and prior rollups. Easy to test.
 *
 * Test coverage: scripts/lib/analytics-rollup.test.mjs
 */

/** Roles with fit_score >= FIT_THRESHOLD count as "high-fit". */
export const FIT_THRESHOLD = 6;

/** Roles with fit_score >= 7 count as the stricter "very high fit" tier. */
export const FIT_THRESHOLD_STRICT = 7;

/**
 * Compute a daily rollup from a stream of events.
 *
 * @param {Array<object>} events
 * @param {object} opts
 * @param {string} opts.date — YYYY-MM-DD
 * @returns {object} rollup
 */
export function computeRollup(events, { date }) {
  const totals = freshTotals();
  const bySource = new Map();
  const byTier = new Map();
  const fitDistTotals = freshFitDist();

  const ensureSource = (host) => {
    if (!host) return null;
    if (!bySource.has(host)) bySource.set(host, freshSourceBucket());
    return bySource.get(host);
  };
  const ensureTier = (tier) => {
    if (!tier) return null;
    if (!byTier.has(tier)) byTier.set(tier, freshTierBucket());
    return byTier.get(tier);
  };

  for (const e of events) {
    if (!e || typeof e !== "object" || typeof e.type !== "string") continue;
    const src = e.host ? ensureSource(e.host) : null;
    const tier = e.tier ? ensureTier(e.tier) : null;

    switch (e.type) {
      case "scrape.tier_start":
        totals.tier_runs += 1;
        if (tier) tier.runs += 1;
        break;
      case "scrape.tier_complete":
        if (tier && typeof e.duration_ms === "number") {
          tier.duration_ms += e.duration_ms;
          totals.duration_total_ms += e.duration_ms;
        }
        if (tier && e.exit_status) tier.last_exit_status = e.exit_status;
        break;
      case "scrape.http_request":
        totals.http_requests += 1;
        if (src) src.http_requests += 1;
        if (typeof e.status === "number" && e.status >= 400) {
          totals.http_errors += 1;
          if (src) src.http_error_count += 1;
        }
        break;
      case "scrape.http_error":
        totals.http_errors += 1;
        if (src) src.http_error_count += 1;
        break;
      case "scrape.parse_success":
        if (src) src.parse_success += 1;
        break;
      case "scrape.parse_failure":
        if (src) src.parse_failure += 1;
        break;
      case "scrape.dedup_skip":
        totals.roles_dedup_skipped =
          (totals.roles_dedup_skipped || 0) + 1;
        break;
      case "scrape.filter_reject":
        if (src) src.roles_filter_rejected += 1;
        // funnel — counted but not part of roles_after_dedup/filter math directly
        break;
      case "scrape.role_discovered":
        totals.roles_discovered += 1;
        if (src) src.roles_discovered += 1;
        if (tier) tier.roles_discovered += 1;
        break;
      case "scrape.exa_call":
        totals.exa_calls += 1;
        if (typeof e.cost_usd === "number") totals.exa_cost_usd += e.cost_usd;
        if (tier) {
          tier.exa_calls += 1;
          if (typeof e.cost_usd === "number") tier.exa_cost_usd += e.cost_usd;
        }
        break;
      case "enrich.start":
        // funnel position; nothing to aggregate yet
        break;
      case "enrich.complete":
        totals.roles_enriched += 1;
        if (src) src.roles_enriched += 1;
        if (typeof e.fit_score === "number") {
          bumpFitDist(fitDistTotals, e.fit_score);
          totals.fit_score_sum += e.fit_score;
          totals.fit_score_count += 1;
          if (e.fit_score >= FIT_THRESHOLD) totals.roles_fit_6plus += 1;
          if (e.fit_score >= FIT_THRESHOLD_STRICT) totals.roles_fit_7plus += 1;
          if (src) {
            bumpFitDist(src.fit_distribution, e.fit_score);
            src.fit_score_sum += e.fit_score;
            src.fit_score_count += 1;
            if (e.fit_score >= FIT_THRESHOLD) src.roles_fit_6plus += 1;
          }
        }
        // Comp coverage — count enrichments whose comp_range carries a real number,
        // not "Not listed" / "Competitive" / etc. Kept in lockstep with the
        // hasRealComp() implementation in dashboard-web/lib/source-health.ts.
        if (hasRealComp(e.comp_range)) {
          totals.has_comp_count += 1;
          if (src) src.has_comp_count += 1;
        }
        break;
      case "enrich.claude_call":
        totals.claude_calls += 1;
        if (typeof e.input_tokens === "number")
          totals.claude_tokens_input += e.input_tokens;
        if (typeof e.output_tokens === "number")
          totals.claude_tokens_output += e.output_tokens;
        if (typeof e.cost_usd === "number") {
          totals.claude_cost_usd += e.cost_usd;
          // Attribute to the URL's host if present
          const callHost = e.url ? safeHost(e.url) : null;
          if (callHost) {
            const s = ensureSource(callHost);
            s.claude_calls += 1;
            s.claude_cost_usd += e.cost_usd;
            if (typeof e.input_tokens === "number")
              s.claude_tokens_input += e.input_tokens;
            if (typeof e.output_tokens === "number")
              s.claude_tokens_output += e.output_tokens;
          }
        }
        break;
      case "enrich.skip_quarantined":
        totals.roles_quarantine_skipped += 1;
        if (src) src.roles_quarantine_skipped += 1;
        break;
      case "enrich.error":
        if (src) src.enrich_errors += 1;
        break;
      case "score.complete":
        // future use
        break;
      case "promote.candidate":
        if (src) src.promote_candidates = (src.promote_candidates || 0) + 1;
        break;
      case "promote.applied":
        totals.auto_promotions += 1;
        if (src) src.promote_applied = (src.promote_applied || 0) + 1;
        break;
      default:
        // Unknown event type — skip silently. The taxonomy is enforced at write time;
        // if we ever see an unknown one here, the writer side has drifted from us.
        break;
    }
  }

  totals.total_cost_usd =
    round6(totals.claude_cost_usd) + round6(totals.exa_cost_usd);
  totals.claude_cost_usd = round6(totals.claude_cost_usd);
  totals.exa_cost_usd = round6(totals.exa_cost_usd);
  totals.total_cost_usd = round6(totals.total_cost_usd);
  totals.fit_distribution = fitDistTotals;
  totals.avg_fit =
    totals.fit_score_count > 0
      ? round4(totals.fit_score_sum / totals.fit_score_count)
      : null;
  totals.has_comp_coverage =
    totals.roles_enriched > 0
      ? round4(totals.has_comp_count / totals.roles_enriched)
      : 0;

  // Roles after dedup / filter — derived from the funnel
  totals.roles_after_dedup =
    totals.roles_discovered - (totals.roles_dedup_skipped || 0);
  // sum filter rejections across all sources
  let filter_rejected_total = 0;
  for (const v of bySource.values()) filter_rejected_total += v.roles_filter_rejected;
  totals.roles_after_filter = totals.roles_after_dedup - filter_rejected_total;

  // Per-source derived fields
  for (const [, s] of bySource) {
    s.claude_cost_usd = round6(s.claude_cost_usd);
    s.hit_rate_fit_6plus =
      s.roles_enriched > 0 ? round4(s.roles_fit_6plus / s.roles_enriched) : 0;
    s.avg_fit =
      s.fit_score_count > 0
        ? round4(s.fit_score_sum / s.fit_score_count)
        : null;
    s.has_comp_coverage =
      s.roles_enriched > 0
        ? round4(s.has_comp_count / s.roles_enriched)
        : 0;
  }
  for (const [, t] of byTier) {
    t.exa_cost_usd = round6(t.exa_cost_usd);
  }

  return {
    date,
    generated_at: new Date().toISOString(),
    data_completeness: "full",
    totals,
    by_source: Object.fromEntries(bySource),
    by_tier: Object.fromEntries(byTier),
    anomalies: [],
  };
}

/**
 * Detect anomalies in today's rollup, optionally comparing to prior days.
 *
 * @param {object} today — rollup of the current day
 * @param {Array<object>} prior — rollups of the prior 7 days (most-recent first)
 * @returns {Array<object>}
 */
export function detectAnomalies(today, prior = []) {
  const anomalies = [];

  // 1. High cost, low yield — per-source spend with zero fit≥6.
  for (const [host, s] of Object.entries(today.by_source || {})) {
    const cost = (s.claude_cost_usd || 0) + (s.exa_cost_usd || 0);
    if (cost > 0.1 && s.roles_fit_6plus === 0 && s.roles_enriched >= 5) {
      anomalies.push({
        type: "high_cost_low_yield",
        severity: cost > 1 ? "high" : "medium",
        source: host,
        cost_usd: round6(cost),
        roles_enriched: s.roles_enriched,
        roles_fit_6plus: 0,
        suggested_action: `Consider quarantining ${host} — it has cost $${cost.toFixed(4)} today across ${s.roles_enriched} enrichments with 0 fit≥6.`,
      });
    }
  }

  // 2. Extractor regression — hit rate dropped >30% vs 7-day rolling average.
  if (prior.length >= 3) {
    const priorBySource = new Map();
    for (const p of prior) {
      for (const [host, s] of Object.entries(p.by_source || {})) {
        if (!priorBySource.has(host)) priorBySource.set(host, []);
        priorBySource.get(host).push(s.hit_rate_fit_6plus || 0);
      }
    }
    for (const [host, s] of Object.entries(today.by_source || {})) {
      const history = priorBySource.get(host);
      if (!history || history.length < 3) continue;
      const avg = history.reduce((a, b) => a + b, 0) / history.length;
      if (avg > 0.1 && s.hit_rate_fit_6plus < avg * 0.7 && s.roles_enriched >= 5) {
        anomalies.push({
          type: "extractor_regression",
          severity: avg - s.hit_rate_fit_6plus > 0.3 ? "high" : "medium",
          source: host,
          previous_rate: round4(avg),
          today_rate: round4(s.hit_rate_fit_6plus),
          delta: round4(s.hit_rate_fit_6plus - avg),
          suggested_action: `Hit rate on ${host} dropped from ${(avg * 100).toFixed(0)}% (7d avg) to ${(s.hit_rate_fit_6plus * 100).toFixed(0)}% today. Inspect the per-source extractor.`,
        });
      }
    }
  }

  // 3. Quarantined but still being enriched — the revopscareers bug.
  for (const [host, s] of Object.entries(today.by_source || {})) {
    if (s.claude_calls > 0 && isLikelyQuarantined(host)) {
      anomalies.push({
        type: "quarantined_still_enriched",
        severity: "high",
        source: host,
        claude_calls: s.claude_calls,
        cost_usd: round6(s.claude_cost_usd || 0),
        suggested_action: `${host} is on the quarantine list (AGGREGATOR_HOSTS) but Claude was called on ${s.claude_calls} of its URLs today, costing $${(s.claude_cost_usd || 0).toFixed(4)}. Add a pre-enrichment quarantine check.`,
      });
    }
  }

  // 4. Source not heard from — was producing roles last week, 0 today.
  if (prior.length >= 1) {
    const recentSources = new Map();
    for (const p of prior) {
      for (const [host, s] of Object.entries(p.by_source || {})) {
        recentSources.set(host, (recentSources.get(host) || 0) + (s.roles_discovered || 0));
      }
    }
    const todayHosts = new Set(Object.keys(today.by_source || {}));
    for (const [host, count] of recentSources) {
      if (count >= 5 && !todayHosts.has(host)) {
        anomalies.push({
          type: "source_silent",
          severity: count >= 50 ? "high" : "low",
          source: host,
          prior_roles: count,
          today_roles: 0,
          suggested_action: `${host} produced ${count} roles in the last ${prior.length} days but 0 today. Crawler may be silently broken.`,
        });
      }
    }
  }

  // 5. Auto-promotion explosion — >20 promotions in one day.
  if ((today.totals?.auto_promotions || 0) > 20) {
    anomalies.push({
      type: "auto_promotion_explosion",
      severity: "high",
      count: today.totals.auto_promotions,
      suggested_action: `${today.totals.auto_promotions} auto-promotions today — review companies.yml diff to make sure the promotion logic isn't runaway.`,
    });
  }

  return anomalies;
}

// -----------------------------------------------------------------------------
// Constants used by anomaly detection — kept in sync with dashboard-web/lib/source-health.ts
// -----------------------------------------------------------------------------

export const QUARANTINED_HOSTS = new Set([
  "revopscareers.com",
  "lensa.com",
  "whatjobs.com",
  "jobright.ai",
  "jobgether.com",
]);

function isLikelyQuarantined(host) {
  if (QUARANTINED_HOSTS.has(host)) return true;
  for (const q of QUARANTINED_HOSTS) {
    if (host.endsWith("." + q)) return true;
  }
  return false;
}

// -----------------------------------------------------------------------------
// Bucket factories
// -----------------------------------------------------------------------------

function freshTotals() {
  return {
    tier_runs: 0,
    http_requests: 0,
    http_errors: 0,
    claude_calls: 0,
    claude_tokens_input: 0,
    claude_tokens_output: 0,
    claude_cost_usd: 0,
    exa_calls: 0,
    exa_cost_usd: 0,
    total_cost_usd: 0,
    roles_discovered: 0,
    roles_after_dedup: 0,
    roles_after_filter: 0,
    roles_enriched: 0,
    roles_quarantine_skipped: 0,
    roles_fit_6plus: 0,
    roles_fit_7plus: 0,
    auto_promotions: 0,
    duration_total_ms: 0,
    roles_dedup_skipped: 0,
    fit_score_sum: 0,
    fit_score_count: 0,
    avg_fit: null,
    has_comp_count: 0,
    has_comp_coverage: 0,
  };
}

function freshSourceBucket() {
  return {
    roles_discovered: 0,
    roles_filter_rejected: 0,
    roles_enriched: 0,
    roles_fit_6plus: 0,
    roles_quarantine_skipped: 0,
    enrich_errors: 0,
    parse_success: 0,
    parse_failure: 0,
    http_requests: 0,
    http_error_count: 0,
    claude_calls: 0,
    claude_tokens_input: 0,
    claude_tokens_output: 0,
    claude_cost_usd: 0,
    exa_cost_usd: 0,
    fit_distribution: freshFitDist(),
    hit_rate_fit_6plus: 0,
    fit_score_sum: 0,
    fit_score_count: 0,
    avg_fit: null,
    has_comp_count: 0,
    has_comp_coverage: 0,
  };
}

function freshTierBucket() {
  return {
    runs: 0,
    duration_ms: 0,
    roles_discovered: 0,
    exa_calls: 0,
    exa_cost_usd: 0,
    last_exit_status: null,
  };
}

function freshFitDist() {
  return { "0-3": 0, "4-6": 0, "7-8": 0, "9-10": 0 };
}

function bumpFitDist(dist, fit) {
  if (fit <= 3) dist["0-3"] += 1;
  else if (fit <= 6) dist["4-6"] += 1;
  else if (fit <= 8) dist["7-8"] += 1;
  else dist["9-10"] += 1;
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function safeHost(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

// Mirror of dashboard-web/lib/source-health.ts:hasRealComp — keep these in sync.
// "Real comp" means a string that carries a numeric range or amount; "Not listed",
// "Competitive", or qualitative-only entries don't count.
const EMPTY_COMP_VALUES = new Set([
  "",
  "not listed",
  "none",
  "n/a",
  "na",
  "not specified",
  "not disclosed",
  "unknown",
]);
const QUALITATIVE_COMP_RE =
  /^(competitive|market|top of market|industry[- ]standard|commensurate|negotiable|doe\b|depends on experience)/i;

function hasRealComp(comp_range) {
  if (typeof comp_range !== "string") return false;
  const c = comp_range.trim();
  if (!c) return false;
  if (EMPTY_COMP_VALUES.has(c.toLowerCase())) return false;
  if (QUALITATIVE_COMP_RE.test(c) && !/[$\d]/.test(c)) return false;
  return /[$\d]/.test(c);
}

function round6(n) {
  return Math.round(n * 1_000_000) / 1_000_000;
}

function round4(n) {
  return Math.round(n * 10_000) / 10_000;
}
