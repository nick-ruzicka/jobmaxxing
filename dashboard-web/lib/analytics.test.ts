import { describe, it, expect } from "vitest";
import {
  aggregateTotals,
  aggregateBySource,
  aggregateByTier,
  aggregateByDate,
  collectAnomalies,
  rangeDays,
  rangeDates,
  type DailyRollup,
} from "./analytics";

function freshSourceBucket(over: Partial<DailyRollup["by_source"][string]> = {}) {
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
    fit_distribution: { "0-3": 0, "4-6": 0, "7-8": 0, "9-10": 0 },
    hit_rate_fit_6plus: 0,
    ...over,
  };
}

function fakeRollup(date: string, over: Partial<DailyRollup> = {}): DailyRollup {
  return {
    date,
    generated_at: "2026-05-14T08:00:00Z",
    data_completeness: "full",
    totals: {
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
    },
    by_source: {},
    by_tier: {},
    anomalies: [],
    ...over,
  };
}

describe("rangeDays", () => {
  it("maps to integer day counts", () => {
    expect(rangeDays("7d")).toBe(7);
    expect(rangeDays("30d")).toBe(30);
    expect(rangeDays("60d")).toBe(60);
    expect(rangeDays("90d")).toBe(90);
  });
});

describe("rangeDates", () => {
  it("returns N days ending today, oldest first", () => {
    const dates = rangeDates("7d", "2026-05-14");
    expect(dates).toHaveLength(7);
    expect(dates[0]).toBe("2026-05-08");
    expect(dates[6]).toBe("2026-05-14");
  });
});

describe("aggregateTotals", () => {
  it("sums costs and computes cost-per-high-fit", () => {
    const rollups = [
      fakeRollup("2026-05-13", {
        totals: {
          ...fakeRollup("x").totals,
          claude_cost_usd: 1,
          exa_cost_usd: 0.5,
          total_cost_usd: 1.5,
          roles_fit_6plus: 3,
          applications_attributed: 2,
        },
      }),
      fakeRollup("2026-05-12", {
        totals: {
          ...fakeRollup("x").totals,
          claude_cost_usd: 0.5,
          exa_cost_usd: 0.25,
          total_cost_usd: 0.75,
          roles_fit_6plus: 1,
          applications_attributed: 0,
        },
      }),
    ];
    const t = aggregateTotals(rollups, "7d");
    expect(t.claude_cost_usd).toBeCloseTo(1.5, 6);
    expect(t.exa_cost_usd).toBeCloseTo(0.75, 6);
    expect(t.total_cost_usd).toBeCloseTo(2.25, 6);
    expect(t.roles_fit_6plus).toBe(4);
    expect(t.applications_attributed).toBe(2);
    // 2.25 / 4 = 0.5625
    expect(t.cost_per_high_fit_role).toBeCloseTo(0.5625, 6);
    // 2.25 / 2 = 1.125
    expect(t.cost_per_application).toBeCloseTo(1.125, 6);
  });
  it("returns null cost ratios when denominators are zero", () => {
    const t = aggregateTotals([fakeRollup("2026-05-14")], "7d");
    expect(t.cost_per_high_fit_role).toBeNull();
    expect(t.cost_per_application).toBeNull();
  });
  it("counts data-bearing days separately from total day count", () => {
    const rollups = [
      fakeRollup("2026-05-13", { data_completeness: "full" }),
      fakeRollup("2026-05-12", { data_completeness: "no_data" }),
    ];
    const t = aggregateTotals(rollups, "7d");
    expect(t.date_count).toBe(2);
    expect(t.date_count_with_data).toBe(1);
  });
});

describe("aggregateBySource", () => {
  it("merges per-day buckets and computes derived fields", () => {
    const r1 = fakeRollup("2026-05-13", {
      by_source: {
        "builtin.com": freshSourceBucket({
          roles_discovered: 10,
          roles_enriched: 8,
          roles_fit_6plus: 3,
          claude_cost_usd: 0.2,
          fit_distribution: { "0-3": 1, "4-6": 4, "7-8": 2, "9-10": 1 },
          applications_attributed: 2,
        }),
      },
    });
    const r2 = fakeRollup("2026-05-12", {
      by_source: {
        "builtin.com": freshSourceBucket({
          roles_discovered: 5,
          roles_enriched: 4,
          roles_fit_6plus: 1,
          claude_cost_usd: 0.1,
          fit_distribution: { "0-3": 1, "4-6": 2, "7-8": 1, "9-10": 0 },
        }),
        "jobs.ashbyhq.com": freshSourceBucket({
          roles_discovered: 2,
          roles_enriched: 2,
          roles_fit_6plus: 1,
        }),
      },
    });
    const out = aggregateBySource([r1, r2]);
    expect(out).toHaveLength(2);
    expect(out[0].host).toBe("builtin.com"); // sorted by roles_discovered desc
    expect(out[0].roles_discovered).toBe(15);
    expect(out[0].roles_fit_6plus).toBe(4);
    expect(out[0].hit_rate_fit_6plus).toBeCloseTo(4 / 12, 4);
    expect(out[0].claude_cost_usd).toBeCloseTo(0.3, 6);
    expect(out[0].cost_per_high_fit).toBeCloseTo(0.3 / 4, 6);
    expect(out[0].fit_distribution["7-8"]).toBe(3);
    expect(out[0].applications_attributed).toBe(2);
  });
});

describe("aggregateByTier", () => {
  it("rolls up tier runs and durations", () => {
    const r = fakeRollup("2026-05-13", {
      by_tier: {
        tier_9_builtin: {
          runs: 2,
          duration_ms: 5000,
          roles_discovered: 50,
          exa_calls: 0,
          exa_cost_usd: 0,
          last_exit_status: "ok",
        },
      },
    });
    const out = aggregateByTier([r, r]);
    expect(out).toHaveLength(1);
    expect(out[0].tier).toBe("tier_9_builtin");
    expect(out[0].runs).toBe(4);
    expect(out[0].duration_ms).toBe(10000);
    expect(out[0].last_exit_status).toBe("ok");
  });
});

describe("aggregateByDate", () => {
  it("returns one entry per rollup sorted ascending", () => {
    const rollups = [
      fakeRollup("2026-05-13"),
      fakeRollup("2026-05-12"),
      fakeRollup("2026-05-14"),
    ];
    const out = aggregateByDate(rollups);
    expect(out.map((d) => d.date)).toEqual([
      "2026-05-12",
      "2026-05-13",
      "2026-05-14",
    ]);
  });
});

describe("collectAnomalies", () => {
  it("de-duplicates by (type, source, tier) and counts occurrences", () => {
    const a = {
      type: "high_cost_low_yield",
      severity: "high" as const,
      source: "revopscareers.com",
      cost_usd: 0.5,
      suggested_action: "quarantine",
    };
    const rollups = [
      fakeRollup("2026-05-13", { anomalies: [a] }),
      fakeRollup("2026-05-12", { anomalies: [{ ...a, cost_usd: 0.6 }] }),
      fakeRollup("2026-05-11", {
        anomalies: [
          {
            type: "source_silent",
            severity: "low" as const,
            source: "x",
            suggested_action: "investigate",
          },
        ],
      }),
    ];
    const out = collectAnomalies(rollups);
    expect(out).toHaveLength(2);
    const hcl = out.find((x) => x.type === "high_cost_low_yield");
    expect(hcl?.occurrence_count).toBe(2);
    expect(hcl?.first_seen).toBe("2026-05-13");
    expect(hcl?.last_seen).toBe("2026-05-12");
    // Most-recent cost_usd carries forward
    expect(hcl?.cost_usd).toBe(0.6);
  });
  it("sorts high severity before low", () => {
    const rollups = [
      fakeRollup("2026-05-13", {
        anomalies: [
          { type: "a", severity: "low", suggested_action: "" },
          { type: "b", severity: "high", suggested_action: "" },
          { type: "c", severity: "medium", suggested_action: "" },
        ],
      }),
    ];
    const out = collectAnomalies(rollups);
    expect(out.map((a) => a.type)).toEqual(["b", "c", "a"]);
  });
});
