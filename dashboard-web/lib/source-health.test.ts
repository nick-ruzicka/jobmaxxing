import { describe, it, expect } from "vitest";
import {
  parentDomain,
  AUDIT_FINDINGS,
  AGGREGATOR_HOSTS,
  EXCLUDE_DOMAINS,
  computeSourceHealth,
  getSourceHealth,
} from "./source-health";
import type { SeenUrlsFile, EnrichmentsFile } from "./source-health";

describe("parentDomain", () => {
  it("returns the registrable-ish parent for a subdomain", () => {
    expect(parentDomain("hirevector.liveblog365.com")).toBe("liveblog365.com");
    expect(parentDomain("jobs.ashbyhq.com")).toBe("ashbyhq.com");
    expect(parentDomain("remotica.totalh.net")).toBe("totalh.net");
  });
  it("returns the host itself when it's already two labels", () => {
    expect(parentDomain("builtin.com")).toBe("builtin.com");
  });
  it("keeps three labels for known two-part TLDs", () => {
    expect(parentDomain("jobs.example.co.uk")).toBe("example.co.uk");
  });
});

describe("audit + block constants", () => {
  it("AUDIT_FINDINGS keys are bare hostnames or parent domains", () => {
    for (const k of Object.keys(AUDIT_FINDINGS)) expect(k).not.toMatch(/^https?:|\/$/);
    expect(AUDIT_FINDINGS["builtin.com"].fixId).toBe("5a");
    expect(AUDIT_FINDINGS["builtin.com"].recoveryRate).toBeGreaterThanOrEqual(0.5);
  });
  it("AGGREGATOR_HOSTS and EXCLUDE_DOMAINS are non-empty", () => {
    expect(AGGREGATOR_HOSTS).toContain("revopscareers.com");
    expect(EXCLUDE_DOMAINS).toContain("liveblog365.com");
  });
});

const SEEN: SeenUrlsFile = {
  // builtin — broken-extractor: low comp coverage, audit finding with recoveryRate >= 0.5
  "https://builtin.com/job/a/1": { firstSeen: "2026-05-01", title: "RevOps Mgr", source: "BuiltIn", company: "A", location: "NYC" },
  "https://builtin.com/job/b/2": { firstSeen: "2026-05-10", title: "GTM Eng", source: "BuiltIn", company: "B", location: "Remote" },
  "https://builtin.com/job/c/3": { firstSeen: "2026-05-03", title: "RevOps", source: "Tier 6: Similar", company: "C", location: "NYC" },
  // ashby — broken-extractor at ~33% coverage (exercises the < 50% gate)
  "https://jobs.ashbyhq.com/x/1": { firstSeen: "2026-05-02", title: "GTM Eng", source: "Tier 1: Ashby", company: "X", location: "NYC" },
  "https://jobs.ashbyhq.com/x/2": { firstSeen: "2026-05-02", title: "RevOps", source: "Tier 1: Ashby", company: "X", location: "NYC" },
  "https://jobs.ashbyhq.com/x/3": { firstSeen: "2026-05-02", title: "Ops", source: "Tier 1: Ashby", company: "X", location: "NYC" },
  // insightpartners — broken-scrape: high error rate, low fit
  "https://jobs.insightpartners.com/companies/y/jobs/1": { firstSeen: "2026-05-04", title: "Dir RevOps", source: "Insight Partners", company: "Y", location: "Remote" },
  "https://jobs.insightpartners.com/companies/y/jobs/2": { firstSeen: "2026-05-04", title: "RevOps", source: "Insight Partners", company: "Y", location: "Remote" },
  "https://jobs.insightpartners.com/companies/y/jobs/3": { firstSeen: "2026-05-05", title: "RevOps", source: "Insight Partners", company: "Y", location: "Remote" },
  // revopscareers — quarantined
  "https://revopscareers.com/job/z-revops": { firstSeen: "2026-05-06", title: "RevOps - RevOps Careers", source: "Tier 2: Exa", company: "RevOps Careers", location: "Remote" },
  // hirevector.liveblog365 — spam-blocked (parent-domain match) + has a parent-domain audit finding
  "https://hirevector.liveblog365.com/job/revops-1": { firstSeen: "2026-05-07", title: "RevOps", source: "Tier 2: Exa", company: "Hirevector", location: "Remote" },
  // healthy host — full coverage, no errors, decent fit
  "https://jobs.lever.co/acme/1": { firstSeen: "2026-05-08", title: "GTM Eng", source: "Tier 1: Lever", company: "Acme", location: "NYC" },
  "https://jobs.lever.co/acme/2": { firstSeen: "2026-05-09", title: "RevOps", source: "Tier 1: Lever", company: "Acme", location: "NYC" },
};

const ENR: EnrichmentsFile = {
  "https://builtin.com/job/a/1": { fit_score: 6, comp_range: "$85K - $130K", timestamp: "2026-05-01T00:00:00Z" },
  "https://builtin.com/job/b/2": { fit_score: 8, comp_range: "Not listed", timestamp: "2026-05-10T00:00:00Z" },
  "https://builtin.com/job/c/3": { fit_score: 4, comp_range: "None", timestamp: "2026-05-03T00:00:00Z" },
  "https://jobs.ashbyhq.com/x/1": { fit_score: 8, comp_range: "$200K - $250K + equity", timestamp: "2026-05-02T00:00:00Z" },
  "https://jobs.ashbyhq.com/x/2": { fit_score: 7, comp_range: "Not listed", timestamp: "2026-05-02T00:00:00Z" },
  "https://jobs.ashbyhq.com/x/3": { fit_score: 5, comp_range: "Not listed", timestamp: "2026-05-02T00:00:00Z" },
  "https://jobs.insightpartners.com/companies/y/jobs/1": { error: "scrape failed: empty HTML", timestamp: "2026-05-04T00:00:00Z" },
  "https://jobs.insightpartners.com/companies/y/jobs/2": { error: "scrape failed: SPA shell", timestamp: "2026-05-04T00:00:00Z" },
  "https://jobs.insightpartners.com/companies/y/jobs/3": { fit_score: 1, comp_range: "Not listed", timestamp: "2026-05-05T00:00:00Z" },
  "https://revopscareers.com/job/z-revops": { fit_score: 2, comp_range: "Not listed", timestamp: "2026-05-06T00:00:00Z" },
  "https://hirevector.liveblog365.com/job/revops-1": { fit_score: 1, comp_range: "Not listed", timestamp: "2026-05-07T00:00:00Z" },
  "https://jobs.lever.co/acme/1": { fit_score: 9, comp_range: "$180K - $240K", timestamp: "2026-05-08T00:00:00Z" },
  "https://jobs.lever.co/acme/2": { fit_score: 7, comp_range: "$140K - $190K", timestamp: "2026-05-09T00:00:00Z" },
};

describe("computeSourceHealth", () => {
  const { rows, summary } = computeSourceHealth(SEEN, ENR);
  const byHost = Object.fromEntries(rows.map((r) => [r.host, r]));

  it("aggregates BuiltIn correctly and flags broken-extractor", () => {
    const b = byHost["builtin.com"];
    expect(b.totalUrls).toBe(3);
    expect(b.enrichedReal).toBe(3);
    expect(b.scrapeFailures).toBe(0);
    expect(b.hasCompCount).toBe(1);
    expect(b.notListedCount).toBe(2);
    expect(b.hasCompCoverage).toBeCloseTo(1 / 3, 5);
    expect(b.recoverableCount).toBe(2); // round(2 * 0.8)
    expect(b.status).toBe("broken-extractor");
    expect(b.auditFinding?.fixId).toBe("5a");
    expect(b.lastSeen).toBe("2026-05-10");
    expect(b.sourceTags).toEqual(["BuiltIn", "Tier 6: Similar"]);
    expect(b.avgFit).toBe(6); // (6+8+4)/3
    expect(b.maxFit).toBe(8);
    expect(b.hitRate).toBeCloseTo(2 / 3, 5); // fit>=6: a1(6), b2(8)
  });

  it("flags Ashby broken-extractor at ~33% coverage (the < 50% gate, not < 20%)", () => {
    const a = byHost["jobs.ashbyhq.com"];
    expect(a.hasCompCoverage).toBeCloseTo(1 / 3, 5);
    expect(a.status).toBe("broken-extractor");
  });

  it("flags the VC board broken-scrape (error-rate > 30% && maxFit < 4)", () => {
    const v = byHost["jobs.insightpartners.com"];
    expect(v.scrapeFailures).toBe(2);
    expect(v.enrichedReal).toBe(1);
    expect(v.scrapeErrorRate).toBeCloseTo(2 / 3, 5);
    expect(v.maxFit).toBe(1);
    expect(v.status).toBe("broken-scrape");
  });

  it("flags aggregator hosts quarantined and spam hosts spam-blocked (parent-domain match)", () => {
    expect(byHost["revopscareers.com"].status).toBe("quarantined");
    expect(byHost["hirevector.liveblog365.com"].status).toBe("spam-blocked");
    expect(byHost["hirevector.liveblog365.com"].auditFinding?.recoveryRate).toBe(0.4);
    expect(byHost["hirevector.liveblog365.com"].recoverableCount).toBe(0); // round(1 * 0.4) = 0
  });

  it("leaves a clean host healthy with no recovery estimate", () => {
    const h = byHost["jobs.lever.co"];
    expect(h.hasCompCoverage).toBe(1);
    expect(h.status).toBe("healthy");
    expect(h.auditFinding).toBeNull();
    expect(h.recoverableCount).toBe(0);
  });

  it("orders rows by totalUrls desc", () => {
    expect(rows[0].host).toBe("builtin.com"); // 3 urls, ties broken alphabetically
  });

  it("summary excludes quarantined + spam-blocked from healthy/broken tallies", () => {
    expect(summary.totalSources).toBe(rows.length);
    expect(summary.healthySources).toBe(1); // jobs.lever.co only
    expect(summary.brokenSources).toBe(3); // builtin, ashby, insightpartners
    expect(summary.quarantinedSources).toBe(1);
    expect(summary.spamBlockedSources).toBe(1);
    expect(summary.totalHasComp).toBe(4); // a1, x1, lever1, lever2
    expect(summary.totalEnriched).toBe(11);
    expect(summary.totalNotListed).toBe(7);
  });

  it("summary splits active-pipeline recoverable from quarantined/spam", () => {
    // active hosts = builtin, ashby, insightpartners, lever (revopscareers quarantined, hirevector spam excluded)
    expect(summary.activeEnriched).toBe(9); // 11 - 1 (revops) - 1 (hirevector)
    expect(summary.activeHasComp).toBe(4);
    expect(summary.overallRecoverable).toBe(4); // builtin round(2*.8)=2 + ashby round(2*.85)=2 + insight round(1*.35)=0
    expect(summary.additionalRecoverableQuarantined).toBe(0); // revops round(1*.45)=0
    expect(summary.additionalRecoverableSpam).toBe(0); // hirevector round(1*.4)=0
    // headline = (totalHasComp + activeRecoverable) / totalEnriched
    expect(summary.overallProjectedCoverage).toBeCloseTo(8 / 11, 5);
    expect(summary.overallProjectedCoverage).toBeGreaterThan(summary.overallCompCoverage);
  });
});

describe("getSourceHealth (real data smoke test)", () => {
  it("reads the live files and shows the audited shape", () => {
    const { rows, summary } = getSourceHealth();
    expect(rows.length).toBeGreaterThan(5);
    expect(summary.totalEnriched).toBeGreaterThan(100);
    const builtin = rows.find((r) => r.host === "builtin.com");
    expect(builtin).toBeDefined();
    expect(builtin!.hasCompCoverage).toBeLessThan(0.5);
    expect(builtin!.status).toBe("broken-extractor");
    const gh = rows.find((r) => r.host === "job-boards.greenhouse.io");
    if (gh) expect(gh.hasCompCount).toBe(0);
    expect(rows.find((r) => r.host === "revopscareers.com")?.status).toBe("quarantined");
    // revopscareers carries a big recoverable count that must NOT leak into the headline
    expect(summary.additionalRecoverableQuarantined).toBeGreaterThan(50);
    expect(summary.overallRecoverable).toBeGreaterThan(50); // active-pipeline recoverable still substantial (builtin etc.)
    expect(summary.overallProjectedCoverage).toBeGreaterThan(summary.overallCompCoverage);
    expect(summary.overallProjectedCoverage).toBeLessThan(0.55); // headline excludes the ~133 quarantined
  });
});
