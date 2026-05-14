import { test } from "node:test";
import assert from "node:assert/strict";

import {
  computeRollup,
  detectAnomalies,
  FIT_THRESHOLD,
  FIT_THRESHOLD_STRICT,
} from "./analytics-rollup.mjs";

function evt(type, extras = {}) {
  return { type, ts: "2026-05-13T08:00:00.000Z", ...extras };
}

test("empty input → zero rollup, no anomalies", () => {
  const r = computeRollup([], { date: "2026-05-13" });
  assert.equal(r.date, "2026-05-13");
  assert.equal(r.totals.roles_discovered, 0);
  assert.equal(r.totals.claude_cost_usd, 0);
  assert.deepEqual(r.by_source, {});
  assert.deepEqual(r.by_tier, {});
  assert.deepEqual(r.anomalies, []);
});

test("tier_start/complete: counts runs and aggregates duration", () => {
  const events = [
    evt("scrape.tier_start", { tier: "tier_9_builtin" }),
    evt("scrape.tier_complete", {
      tier: "tier_9_builtin",
      duration_ms: 4523,
      exit_status: "ok",
    }),
    evt("scrape.tier_start", { tier: "tier_1_ashby" }),
    evt("scrape.tier_complete", {
      tier: "tier_1_ashby",
      duration_ms: 1200,
      exit_status: "ok",
    }),
  ];
  const r = computeRollup(events, { date: "2026-05-13" });
  assert.equal(r.totals.tier_runs, 2);
  assert.equal(r.totals.duration_total_ms, 5723);
  assert.equal(r.by_tier.tier_9_builtin.duration_ms, 4523);
  assert.equal(r.by_tier.tier_1_ashby.duration_ms, 1200);
  assert.equal(r.by_tier.tier_9_builtin.last_exit_status, "ok");
});

test("http_request: total counts + per-source counts + error promotion at >=400", () => {
  const events = [
    evt("scrape.http_request", { host: "builtin.com", status: 200 }),
    evt("scrape.http_request", { host: "builtin.com", status: 200 }),
    evt("scrape.http_request", { host: "builtin.com", status: 403 }),
    evt("scrape.http_request", { host: "jobs.ashbyhq.com", status: 200 }),
  ];
  const r = computeRollup(events, { date: "2026-05-13" });
  assert.equal(r.totals.http_requests, 4);
  assert.equal(r.totals.http_errors, 1);
  assert.equal(r.by_source["builtin.com"].http_requests, 3);
  assert.equal(r.by_source["builtin.com"].http_error_count, 1);
  assert.equal(r.by_source["jobs.ashbyhq.com"].http_error_count, 0);
});

test("Claude calls: tokens summed, cost summed, attributed to URL host", () => {
  const events = [
    evt("enrich.claude_call", {
      url: "https://builtin.com/job/1",
      model: "claude-sonnet-4-20250514",
      input_tokens: 3000,
      output_tokens: 1000,
      cost_usd: 0.024, // 3000 * $3/M + 1000 * $15/M = $0.009 + $0.015 = $0.024
    }),
    evt("enrich.claude_call", {
      url: "https://jobs.ashbyhq.com/foo/bar",
      model: "claude-sonnet-4-20250514",
      input_tokens: 2000,
      output_tokens: 500,
      cost_usd: 0.0135,
    }),
  ];
  const r = computeRollup(events, { date: "2026-05-13" });
  assert.equal(r.totals.claude_calls, 2);
  assert.equal(r.totals.claude_tokens_input, 5000);
  assert.equal(r.totals.claude_tokens_output, 1500);
  assert.equal(r.totals.claude_cost_usd, 0.0375);
  assert.equal(r.by_source["builtin.com"].claude_cost_usd, 0.024);
  assert.equal(r.by_source["jobs.ashbyhq.com"].claude_cost_usd, 0.0135);
});

test("Exa calls: cost summed at totals and per-tier", () => {
  const events = [
    evt("scrape.exa_call", { tier: "tier_5_social", cost_usd: 0.005, num_results: 10 }),
    evt("scrape.exa_call", { tier: "tier_5_social", cost_usd: 0.005, num_results: 10 }),
    evt("scrape.exa_call", { tier: "tier_2_broad", cost_usd: 0.01, num_results: 30 }),
  ];
  const r = computeRollup(events, { date: "2026-05-13" });
  assert.equal(r.totals.exa_calls, 3);
  assert.equal(r.totals.exa_cost_usd, 0.02);
  assert.equal(r.by_tier.tier_5_social.exa_cost_usd, 0.01);
  assert.equal(r.by_tier.tier_5_social.exa_calls, 2);
  assert.equal(r.by_tier.tier_2_broad.exa_calls, 1);
});

test("Fit distribution bucketing", () => {
  const events = [
    evt("enrich.complete", { host: "builtin.com", fit_score: 2 }), // 0-3
    evt("enrich.complete", { host: "builtin.com", fit_score: 5 }), // 4-6
    evt("enrich.complete", { host: "builtin.com", fit_score: 6 }), // 4-6 → also fit_6plus
    evt("enrich.complete", { host: "builtin.com", fit_score: 7 }), // 7-8 → fit_6plus + fit_7plus
    evt("enrich.complete", { host: "builtin.com", fit_score: 9 }), // 9-10 → both
  ];
  const r = computeRollup(events, { date: "2026-05-13" });
  assert.equal(r.totals.roles_enriched, 5);
  assert.equal(r.totals.roles_fit_6plus, 3);
  assert.equal(r.totals.roles_fit_7plus, 2);
  assert.deepEqual(r.totals.fit_distribution, {
    "0-3": 1,
    "4-6": 2,
    "7-8": 1,
    "9-10": 1,
  });
  assert.equal(r.by_source["builtin.com"].roles_fit_6plus, 3);
  assert.equal(r.by_source["builtin.com"].hit_rate_fit_6plus, 0.6);
});

test("Funnel: roles_after_dedup and roles_after_filter derived", () => {
  const events = [
    evt("scrape.role_discovered", { host: "builtin.com" }),
    evt("scrape.role_discovered", { host: "builtin.com" }),
    evt("scrape.role_discovered", { host: "builtin.com" }),
    evt("scrape.role_discovered", { host: "builtin.com" }),
    evt("scrape.dedup_skip", { kind: "seen_url" }),
    evt("scrape.filter_reject", { host: "builtin.com", reason: "negative_token" }),
  ];
  const r = computeRollup(events, { date: "2026-05-13" });
  assert.equal(r.totals.roles_discovered, 4);
  assert.equal(r.totals.roles_dedup_skipped, 1);
  assert.equal(r.totals.roles_after_dedup, 3);
  assert.equal(r.by_source["builtin.com"].roles_filter_rejected, 1);
  assert.equal(r.totals.roles_after_filter, 2);
});

test("Quarantine skips counted", () => {
  const events = [
    evt("enrich.skip_quarantined", { host: "revopscareers.com", reason: "AGGREGATOR_HOSTS" }),
    evt("enrich.skip_quarantined", { host: "revopscareers.com", reason: "AGGREGATOR_HOSTS" }),
  ];
  const r = computeRollup(events, { date: "2026-05-13" });
  assert.equal(r.totals.roles_quarantine_skipped, 2);
  assert.equal(r.by_source["revopscareers.com"].roles_quarantine_skipped, 2);
});

test("Anomaly: high_cost_low_yield triggered when source spends >$0.1 with 0 fit≥6", () => {
  const today = computeRollup(
    [
      // 6 enrichments on revopscareers, none fit≥6, $0.20 spent
      ...Array.from({ length: 6 }, (_, i) =>
        evt("enrich.claude_call", {
          url: `https://revopscareers.com/job/${i}`,
          input_tokens: 5000,
          output_tokens: 1000,
          cost_usd: 0.03,
          model: "claude-sonnet-4-20250514",
        }),
      ),
      ...Array.from({ length: 6 }, () =>
        evt("enrich.complete", { host: "revopscareers.com", fit_score: 2 }),
      ),
    ],
    { date: "2026-05-13" },
  );
  const anomalies = detectAnomalies(today, []);
  const a = anomalies.find((x) => x.type === "high_cost_low_yield");
  assert.ok(a, "expected high_cost_low_yield anomaly");
  assert.equal(a.source, "revopscareers.com");
  assert.equal(a.roles_fit_6plus, 0);
});

test("Anomaly: quarantined_still_enriched flags revopscareers if claude was called", () => {
  const today = computeRollup(
    [
      evt("enrich.claude_call", {
        url: "https://revopscareers.com/job/123",
        input_tokens: 1000,
        output_tokens: 200,
        cost_usd: 0.006,
        model: "claude-sonnet-4-20250514",
      }),
    ],
    { date: "2026-05-13" },
  );
  const anomalies = detectAnomalies(today, []);
  const a = anomalies.find((x) => x.type === "quarantined_still_enriched");
  assert.ok(a, "expected quarantined_still_enriched anomaly");
  assert.equal(a.source, "revopscareers.com");
  assert.equal(a.claude_calls, 1);
});

test("Anomaly: extractor_regression triggers on >30% drop from 7d avg", () => {
  const today = computeRollup(
    [
      ...Array.from({ length: 10 }, () =>
        evt("enrich.complete", { host: "jobs.ashbyhq.com", fit_score: 2 }),
      ),
    ],
    { date: "2026-05-13" },
  );
  // Build prior days with hit_rate 0.5 each
  const prior = Array.from({ length: 5 }, () => ({
    by_source: {
      "jobs.ashbyhq.com": { hit_rate_fit_6plus: 0.5, roles_enriched: 10 },
    },
  }));
  const anomalies = detectAnomalies(today, prior);
  const a = anomalies.find((x) => x.type === "extractor_regression");
  assert.ok(a, "expected extractor_regression anomaly");
  assert.equal(a.source, "jobs.ashbyhq.com");
  assert.equal(a.previous_rate, 0.5);
  assert.equal(a.today_rate, 0);
});

test("Anomaly: source_silent triggers when source was active last week but 0 today", () => {
  const today = computeRollup([], { date: "2026-05-13" });
  const prior = [
    { by_source: { "builtin.com": { roles_discovered: 100, hit_rate_fit_6plus: 0.3 } } },
  ];
  const anomalies = detectAnomalies(today, prior);
  const a = anomalies.find((x) => x.type === "source_silent");
  assert.ok(a, "expected source_silent anomaly");
  assert.equal(a.source, "builtin.com");
  assert.equal(a.prior_roles, 100);
  assert.equal(a.severity, "high"); // 100 >= 50 threshold
});

test("Anomaly: auto_promotion_explosion fires above threshold", () => {
  const today = computeRollup(
    Array.from({ length: 25 }, (_, i) =>
      evt("promote.applied", { host: `co${i}.com` }),
    ),
    { date: "2026-05-13" },
  );
  assert.equal(today.totals.auto_promotions, 25);
  const anomalies = detectAnomalies(today, []);
  const a = anomalies.find((x) => x.type === "auto_promotion_explosion");
  assert.ok(a);
  assert.equal(a.count, 25);
});

test("Unknown event types are silently ignored (forward compat)", () => {
  const events = [
    evt("totally.new.type", { extra: 42 }),
    evt("scrape.role_discovered", { host: "builtin.com" }),
  ];
  const r = computeRollup(events, { date: "2026-05-13" });
  assert.equal(r.totals.roles_discovered, 1);
});

test("FIT_THRESHOLD constants are 6 and 7", () => {
  assert.equal(FIT_THRESHOLD, 6);
  assert.equal(FIT_THRESHOLD_STRICT, 7);
});
