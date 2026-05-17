import { describe, it, expect } from "vitest";

import { getCompanyDetail, type CompanyDetail } from "./company-detail";

// Shared fixture — identical shape to scripts/lib/company-aggregator.test.mjs's
// fixtures so behaviour parity between the .mjs library and the TS wrapper is
// easy to confirm.
const FIXTURES = {
  seenUrls: {
    "https://j.com/acme/r1": {
      firstSeen: "2026-04-01",
      title: "GTM Engineer",
      company: "Acme AI",
      source: "Tier 1: Ashby",
    },
    "https://j.com/acme/r2": {
      firstSeen: "2026-05-10",
      title: "AI Ops Lead",
      company: "Acme AI",
      source: "Tier 1: Ashby",
    },
  },
  enrichments: {
    "https://j.com/acme/r1": {
      archetype_primary: "gtm-engineering",
      score_base: 7,
      score_adjusted: 8,
      green_flags: ["AI-native company"],
      red_flags: [],
      team_context: "Founding role",
      company_stage: "Series B",
      build_component: true,
      ai_signal: true,
    },
    "https://j.com/acme/r2": {
      archetype_primary: "ai-operations",
      score_base: 6,
      score_adjusted: 7,
      green_flags: ["AI-native company"],
      red_flags: ["No comp listed"],
      team_context: "Established team",
      company_stage: "Series B",
      build_component: false,
      ai_signal: true,
    },
  },
  signals: [
    {
      slug: "acmeai",
      name: "Acme AI",
      amount: "$50M",
      lastChecked: "2026-05-12",
      result: "high",
    },
  ],
  watchlist: [{ canonical_name: "Acme AI", ats: "ashby", slug: "acme-ai" }],
};

describe("getCompanyDetail", () => {
  it("returns null for an unknown slug", () => {
    expect(getCompanyDetail("doesnotexist", FIXTURES)).toBeNull();
  });

  it("returns the full aggregate for a known slug", () => {
    const detail = getCompanyDetail("acmeai", FIXTURES) as CompanyDetail;
    expect(detail).not.toBeNull();
    expect(detail.identity.name).toBe("Acme AI");
    expect(detail.identity.slug).toBe("acmeai");
    expect(detail.identity.funding_amount).toBe("$50M");
    expect(detail.identity.ats).toBe("ashby");
    expect(detail.roles).toHaveLength(2);
    expect(detail.hiring_velocity).toBe("warming");
    expect(detail.archetype_distribution).toEqual({
      "gtm-engineering": 1,
      "ai-operations": 1,
    });
    expect(detail.enrichment_summary.company_stage).toEqual({
      mode: "Series B",
      count: 2,
    });
  });

  it("returns roles with stable shape (id, title, link, archetype, scores)", () => {
    const detail = getCompanyDetail("acmeai", FIXTURES) as CompanyDetail;
    const r1 = detail.roles.find((r) => r.title === "GTM Engineer")!;
    expect(r1.id).toBeTruthy();
    expect(r1.link).toBe("https://j.com/acme/r1");
    expect(r1.archetype_primary).toBe("gtm-engineering");
    expect(r1.score_base).toBe(7);
    expect(r1.score_adjusted).toBe(8);
  });
});
