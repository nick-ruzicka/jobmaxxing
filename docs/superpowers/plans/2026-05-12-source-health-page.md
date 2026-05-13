# Source Health Page (`/sources`, D-9) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/sources` route to the Next.js dashboard that renders the comp-extraction audit's source-by-source breakdown as a live page — per source host: enrichment health, comp coverage today, comp recoverable (audit-derived), scrape failures, a status badge, and an expandable diagnosis/fix detail view.

**Architecture:** New `lib/source-health.ts` reads `data/seen-urls.json` + `data/enrichments.json` and folds them per hostname into `SourceHealthRow[]`. A hand-maintained `AUDIT_FINDINGS` constant (recovery rates + diagnoses, sourced from `audit/comp-extraction-audit-2026-05-13.md`) is the bridge from the audit to the page. The core aggregation is a pure function (`computeSourceHealth(seenUrls, enrichments)`) so it's unit-testable; a thin `getSourceHealth()` wrapper does the file I/O. A server component (`app/sources/page.tsx`) feeds a client component (`app/sources/sources-client.tsx`) that does sort/filter/expand. Same patterns as the existing `/signals` route.

**Tech Stack:** Next.js 16 (App Router, `dynamic = "force-dynamic"`), React 19, Tailwind 4 + CSS vars in `app/globals.css`, lucide-react icons, vitest (new — for the pure-logic tests).

---

## File structure

| File | Status | Responsibility |
|---|---|---|
| `dashboard-web/lib/source-health.ts` | create | `AGGREGATOR_HOSTS` / `EXCLUDE_DOMAINS` / `AUDIT_FINDINGS` constants, `parentDomain()`, `computeSourceHealth()` pure fn, `getSourceHealth()` file wrapper |
| `dashboard-web/lib/types.ts` | modify | add `SourceStatus`, `AuditFinding`, `SourceHealthRow`, `SourceHealthSummary` |
| `dashboard-web/lib/data.ts` | modify | export `readJsonSafe` and `ROOT` (currently module-private) so `source-health.ts` reuses them |
| `dashboard-web/app/sources/page.tsx` | create | server component — calls `getSourceHealth()`, passes Shell boilerplate |
| `dashboard-web/app/sources/sources-client.tsx` | create | client component — `<Shell>`, summary strip, status-filter chips, sortable table, expandable detail rows |
| `dashboard-web/components/Sidebar.tsx` | modify | add `{ href: "/sources", label: "Source Health", icon: Activity }` |
| `dashboard-web/lib/source-health.test.ts` | create | vitest tests for `parentDomain` + `computeSourceHealth` (fixture) + `getSourceHealth` (real data smoke) |
| `dashboard-web/package.json` | modify | add `vitest` devDep, `"test": "vitest run"` script |

Constants `AGGREGATOR_HOSTS` (already in `lib/data.ts`, mirrored from `scripts/scan-jobs.mjs`) and `EXCLUDE_DOMAINS` (in `scripts/scan-jobs.mjs` only) are re-declared in `source-health.ts` with a "keep in sync" comment — matching the existing duplication convention.

---

## Task 1: Add vitest

**Files:**
- Modify: `dashboard-web/package.json`
- Create: `dashboard-web/lib/source-health.test.ts` (placeholder smoke test)

- [ ] **Step 1: Install vitest**

Run: `cd dashboard-web && npm install -D vitest`
Expected: vitest added to `devDependencies`, lockfile updated. (Node 18.16 — if `npm install -D vitest` errors on engines, pin: `npm install -D vitest@^1.6.1`.)

- [ ] **Step 2: Add the test script**

In `dashboard-web/package.json` `"scripts"`, add: `"test": "vitest run"` (after `"lint"`).

- [ ] **Step 3: Write a placeholder smoke test**

Create `dashboard-web/lib/source-health.test.ts`:

```ts
import { describe, it, expect } from "vitest";

describe("vitest harness", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 4: Run it**

Run: `cd dashboard-web && npm test`
Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add dashboard-web/package.json dashboard-web/package-lock.json dashboard-web/lib/source-health.test.ts
git commit -m "chore(dashboard): add vitest test harness"
```

---

## Task 2: Types

**Files:**
- Modify: `dashboard-web/lib/types.ts`

- [ ] **Step 1: Append the new types**

Append to `dashboard-web/lib/types.ts`:

```ts
// ---------------------------------------------------------------------------
// Source Health (/sources page) — see lib/source-health.ts
// ---------------------------------------------------------------------------
export type SourceStatus =
  | "healthy"
  | "broken-extractor" // comp is on the page (audit-confirmed) but we're not pulling it
  | "broken-scrape" //    SPA / scrape failures — high error rate, low fit
  | "quarantined" //      AGGREGATOR_HOSTS — intentionally hidden, kept toggleable
  | "spam-blocked"; //    EXCLUDE_DOMAINS — content-farm, blocked at scan time

/** A per-host finding from the comp-extraction audit (audit/comp-extraction-audit-2026-05-13.md). */
export interface AuditFinding {
  /** 0..1 — sample-derived fraction of this host's "Not listed" rows that are recoverable. */
  recoveryRate: number;
  /** One-line explanation of why comp isn't being extracted from this host. */
  diagnosis: string;
  /** "5a", "5b", … — which numbered fix addresses it. */
  fixId: string;
  /** Short description of the fix. */
  fixLabel: string;
  /** Exemplar URLs from the audit (the "sample evidence"). */
  sampleUrls: string[];
  /** Which extraction layer the fix targets: "jsonld_basesalary" | "jsonld_description" | "jd_prose" | "page_structured". */
  compSourceTarget: string;
}

export interface SourceHealthRow {
  host: string;
  totalUrls: number; //          entries in seen-urls ∪ enrichments for this host
  enrichedReal: number; //       enrichment entries WITHOUT an `error` key
  scrapeFailures: number; //     enrichment entries that are { error, timestamp }
  enrichmentRate: number; //     enrichedReal / totalUrls
  scrapeErrorRate: number; //    scrapeFailures / (enrichedReal + scrapeFailures), 0 if none
  avgFit: number | null; //      mean enrichment.fit_score over enrichedReal
  maxFit: number | null; //      max enrichment.fit_score over enrichedReal
  hitRate: number | null; //     fraction of enrichedReal with fit_score >= 6
  hasCompCount: number; //       enrichedReal with a real comp_range
  notListedCount: number; //     enrichedReal with comp_range "Not listed" / "None" / empty / qualitative-only
  hasCompCoverage: number; //    hasCompCount / enrichedReal, 0 if none
  recoverableCount: number; //   round(notListedCount * (auditFinding?.recoveryRate ?? 0))
  projectedCompCoverage: number; // (hasCompCount + recoverableCount) / enrichedReal, 0 if none
  lastSeen: string; //           max firstSeen across the host's seen-urls entries (ISO date), "" if unknown
  status: SourceStatus;
  auditFinding: AuditFinding | null; // null = not yet audited
  sourceTags: string[]; //       distinct `source` values from seen-urls ("Tier 1: Ashby", "BuiltIn", …)
}

export interface SourceHealthSummary {
  totalSources: number;
  healthySources: number; //         status === "healthy"
  brokenSources: number; //          "broken-extractor" + "broken-scrape"
  quarantinedSources: number;
  spamBlockedSources: number;
  totalEnriched: number; //          Σ enrichedReal
  totalHasComp: number; //           Σ hasCompCount
  totalNotListed: number; //         Σ notListedCount
  overallCompCoverage: number; //    totalHasComp / totalEnriched
  overallRecoverable: number; //     Σ recoverableCount
  overallProjectedCoverage: number; // (totalHasComp + overallRecoverable) / totalEnriched
}
```

- [ ] **Step 2: Type-check**

Run: `cd dashboard-web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add dashboard-web/lib/types.ts
git commit -m "feat(dashboard): add Source Health types"
```

---

## Task 3: Constants + `parentDomain` (TDD)

**Files:**
- Modify: `dashboard-web/lib/data.ts` (export `readJsonSafe`, `ROOT`)
- Create: `dashboard-web/lib/source-health.ts` (constants + `parentDomain` only this task)
- Modify: `dashboard-web/lib/source-health.test.ts`

- [ ] **Step 1: Write the failing test**

Replace the placeholder test in `dashboard-web/lib/source-health.test.ts` with:

```ts
import { describe, it, expect } from "vitest";
import { parentDomain, AUDIT_FINDINGS, AGGREGATOR_HOSTS, EXCLUDE_DOMAINS } from "./source-health";

describe("parentDomain", () => {
  it("returns the registrable-ish parent for a subdomain", () => {
    expect(parentDomain("hirevector.liveblog365.com")).toBe("liveblog365.com");
    expect(parentDomain("jobs.ashbyhq.com")).toBe("ashbyhq.com");
    expect(parentDomain("remotica.totalh.net")).toBe("totalh.net");
  });
  it("returns the host itself when it's already two labels", () => {
    expect(parentDomain("builtin.com")).toBe("builtin.com");
  });
  it("handles co.uk-style two-part TLDs by keeping three labels", () => {
    expect(parentDomain("jobs.example.co.uk")).toBe("example.co.uk");
  });
});

describe("audit + block constants", () => {
  it("AUDIT_FINDINGS keys are bare hostnames or parent domains", () => {
    for (const k of Object.keys(AUDIT_FINDINGS)) expect(k).not.toMatch(/^https?:|\/$/);
    expect(AUDIT_FINDINGS["builtin.com"].fixId).toBe("5a");
    expect(AUDIT_FINDINGS["builtin.com"].recoveryRate).toBeGreaterThanOrEqual(0.5);
  });
  it("AGGREGATOR_HOSTS and EXCLUDE_DOMAINS are non-empty string arrays", () => {
    expect(AGGREGATOR_HOSTS).toContain("revopscareers.com");
    expect(EXCLUDE_DOMAINS).toContain("liveblog365.com");
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `cd dashboard-web && npm test`
Expected: FAIL — cannot resolve `./source-health`.

- [ ] **Step 3: Export `readJsonSafe` and `ROOT` from `lib/data.ts`**

In `dashboard-web/lib/data.ts`, add `export` to the existing `const ROOT = …` and `function readJsonSafe<T>…`:

```ts
export const ROOT = join(process.cwd(), "..");
// …
export function readJsonSafe<T>(path: string, fallback: T): T { /* unchanged body */ }
```

- [ ] **Step 4: Create `lib/source-health.ts` with constants + `parentDomain`**

```ts
import { join } from "path";
import { readJsonSafe, ROOT } from "./data";
import type {
  AuditFinding,
  SourceHealthRow,
  SourceHealthSummary,
  SourceStatus,
} from "./types";

// Re-syndicator hosts — hidden from default views, kept toggleable.
// Keep in sync with scripts/scan-jobs.mjs AGGREGATOR_HOSTS and lib/data.ts.
export const AGGREGATOR_HOSTS = [
  "revopscareers.com",
  "lensa.com",
  "whatjobs.com",
  "jobright.ai",
  "jobgether.com",
];

// Content-farm / SEO-spam hosts blocked at scan time.
// Keep in sync with scripts/scan-jobs.mjs EXCLUDE_DOMAINS.
export const EXCLUDE_DOMAINS = [
  "flexionis.wuaze.com",
  "novaedge.page.gd",
  "hireza.wuaze.com",
  "joborix.us",
  "jobsgemach.com",
  "talent.com",
  "jooble.org",
  "recruit.net",
  "careerbuilder.com",
  "snagajob.com",
  "simplyhired.com",
  "jobrapido.com",
  "liveblog365.com",
  "totalh.net",
  "wuaze.com",
  "page.gd",
  "saashero.net",
  "2x.marketing",
  "anywhereremotejobs.com",
  "kickstartremote.com",
];

/**
 * Per-host comp-extraction findings.
 *
 * Source: audit/comp-extraction-audit-2026-05-13.md (the in-this-session audit).
 * Update this constant when re-auditing. Recovery rates and diagnoses are sample-derived
 * (n=30); confidence is medium-high for top-volume hosts (BuiltIn, Ashby, Greenhouse) and
 * lower for tail hosts. Keys are bare hostnames or parent domains (matched via parentDomain()).
 */
export const AUDIT_FINDINGS: Record<string, AuditFinding> = {
  "builtin.com": {
    recoveryRate: 0.8,
    diagnosis:
      'JSON-LD JobPosting is present, but the script type is HTML-entity-encoded (type="application/ld&#x2B;json") and JobPosting is nested in an @graph array — naive parsers miss it. ~11% extracted today.',
    fixId: "5a",
    fixLabel:
      "BuiltIn JSON-LD parser — decode &#x2B; in the script type, walk @graph, read baseSalary (minValue/maxValue and single-value scalar forms); fall back to the fa-sack-dollar strip labelled (est.).",
    sampleUrls: ["https://builtin.com/job/revenue-operations-manager/3596033"],
    compSourceTarget: "jsonld_basesalary",
  },
  "jobs.ashbyhq.com": {
    recoveryRate: 0.85,
    diagnosis:
      'Structured baseSalary is always null; the pay range lives in the JSON-LD "description" prose ("The salary range for this role is $X–$Y"). ~30% extracted today.',
    fixId: "5c",
    fixLabel: "Ashby description-prose regex — run the comp regex over the JSON-LD description field, not just the rendered page.",
    sampleUrls: ["https://jobs.ashbyhq.com/eliseai/7a74322c-415a-41cb-8956-ee170d3bb267"],
    compSourceTarget: "jsonld_description",
  },
  "job-boards.greenhouse.io": {
    recoveryRate: 0.75,
    diagnosis:
      'No JSON-LD at all; the pay range is a plain server-rendered <div> ("Pay Transparency Range", "Tier N Pay Range", "base salary range", "OTE"). 0% extracted today.',
    fixId: "5d",
    fixLabel: "Greenhouse server-rendered prose regex — pure text regex on the captured JD.",
    sampleUrls: ["https://job-boards.greenhouse.io/apolloio/jobs/5918855004"],
    compSourceTarget: "jd_prose",
  },
  "boards.greenhouse.io": {
    recoveryRate: 0.75,
    diagnosis: "Same as job-boards.greenhouse.io — no JSON-LD; pay range in a server-rendered <div>.",
    fixId: "5d",
    fixLabel: "Greenhouse server-rendered prose regex — pure text regex on the captured JD.",
    sampleUrls: ["https://boards.greenhouse.io/braze/jobs/7406001"],
    compSourceTarget: "jd_prose",
  },
  "revopscareers.com": {
    recoveryRate: 0.45,
    diagnosis:
      "Aggregator (quarantined). Emits JSON-LD JobPosting with baseSalary, often the single-value scalar form ($93,730/yr); many entries are thin re-scrapes with no baseSalary. 2% extracted today.",
    fixId: "5b",
    fixLabel: "revopscareers JSON-LD parser — same JSON-LD pattern, simpler script-type encoding; handle the single-value scalar baseSalary form.",
    sampleUrls: ["https://revopscareers.com/job/mural-revenue-operations-business-partner-united-states"],
    compSourceTarget: "jsonld_basesalary",
  },
  "jobs.insightpartners.com": {
    recoveryRate: 0.35,
    diagnosis:
      'Getro/Consider-powered SPA — JSON-LD JobPosting (incl. baseSalary when the underlying ATS has it) is in the *raw* HTML even though the page renders client-side; the pipeline scrapes the SPA shell and sees "completely broken HTML". 0% extracted, ~44% scrape errors.',
    fixId: "5e",
    fixLabel: "VC-portfolio JSON-LD parser — parse JSON-LD from raw HTML; also recovers the scrape-failure cases. Synergy with Fix #6.",
    sampleUrls: ["https://jobs.insightpartners.com/companies/camunda/jobs/47555852-director-revenue-operations"],
    compSourceTarget: "jsonld_basesalary",
  },
  "jobs.generalcatalyst.com": {
    recoveryRate: 0.3,
    diagnosis: "Same Getro/Consider SPA pattern as jobs.insightpartners.com; baseSalary is employer-dependent (fewer of these employers post ranges).",
    fixId: "5e",
    fixLabel: "VC-portfolio JSON-LD parser — parse JSON-LD from raw HTML.",
    sampleUrls: ["https://jobs.generalcatalyst.com/companies/ethos-life/jobs/37518699-consumer-revenue-operations-manager"],
    compSourceTarget: "jsonld_basesalary",
  },
  "jobs.8vc.com": {
    recoveryRate: 0.3,
    diagnosis: "Same Getro/Consider SPA pattern as jobs.insightpartners.com.",
    fixId: "5e",
    fixLabel: "VC-portfolio JSON-LD parser — parse JSON-LD from raw HTML.",
    sampleUrls: ["https://jobs.8vc.com/companies/prepared-2/jobs/73547723-business-solutions-architect-sales-operations"],
    compSourceTarget: "jsonld_basesalary",
  },
  "liveblog365.com": {
    recoveryRate: 0.4,
    diagnosis:
      'Spam-blocked (EXCLUDE_DOMAINS). Pages do carry JSON-LD JobPosting with comp in the description ("base compensation band $X–$Y", "Pay: $X–$Y/month"), but JD quality is otherwise poor — not worth recovering unless unquarantined.',
    fixId: "—",
    fixLabel: "No fix planned — host is spam-blocked. Recovery only meaningful if the block is lifted.",
    sampleUrls: ["https://hirevector.liveblog365.com/job/revenue-operations-analyst-26"],
    compSourceTarget: "jsonld_description",
  },
  "thesaraslist.com": {
    recoveryRate: 0.2,
    diagnosis: "SPA — job-specific pages expire fast (high dead-link rate). ~33% comp already extracted.",
    fixId: "—",
    fixLabel: "Low priority — already ~33% covered; remaining gaps are mostly dead postings.",
    sampleUrls: [],
    compSourceTarget: "jd_prose",
  },
};

/**
 * Best-effort registrable parent domain. Returns the last two labels, except for known
 * two-part public suffixes (co.uk etc.) where it returns three.
 */
const TWO_PART_TLDS = new Set(["co.uk", "com.au", "co.jp", "co.nz", "com.br", "co.in"]);
export function parentDomain(host: string): string {
  const labels = host.toLowerCase().split(".").filter(Boolean);
  if (labels.length <= 2) return labels.join(".");
  const lastTwo = labels.slice(-2).join(".");
  if (TWO_PART_TLDS.has(lastTwo)) return labels.slice(-3).join(".");
  return lastTwo;
}
```

- [ ] **Step 5: Run the test — verify it passes**

Run: `cd dashboard-web && npm test`
Expected: PASS (parentDomain + constants suites green).

- [ ] **Step 6: Commit**

```bash
git add dashboard-web/lib/data.ts dashboard-web/lib/source-health.ts dashboard-web/lib/source-health.test.ts
git commit -m "feat(dashboard): source-health constants — AUDIT_FINDINGS, EXCLUDE_DOMAINS, parentDomain"
```

---

## Task 4: `computeSourceHealth` pure function + `getSourceHealth` wrapper (TDD)

**Files:**
- Modify: `dashboard-web/lib/source-health.ts` (add the functions)
- Modify: `dashboard-web/lib/source-health.test.ts` (add fixture + real-data tests)

- [ ] **Step 1: Write the failing tests**

Append to `dashboard-web/lib/source-health.test.ts`:

```ts
import { computeSourceHealth, getSourceHealth } from "./source-health";
import type { SeenUrlsFile, EnrichmentsFile } from "./source-health";

const SEEN: SeenUrlsFile = {
  // builtin — broken-extractor: low comp coverage, audit finding with recoveryRate >= 0.5
  "https://builtin.com/job/a/1": { firstSeen: "2026-05-01", title: "RevOps Mgr", source: "BuiltIn", company: "A", location: "NYC" },
  "https://builtin.com/job/b/2": { firstSeen: "2026-05-10", title: "GTM Eng", source: "BuiltIn", company: "B", location: "Remote" },
  "https://builtin.com/job/c/3": { firstSeen: "2026-05-03", title: "RevOps", source: "Tier 6: Similar", company: "C", location: "NYC" },
  // ashby — broken-extractor at ~33% coverage
  "https://jobs.ashbyhq.com/x/1": { firstSeen: "2026-05-02", title: "GTM Eng", source: "Tier 1: Ashby", company: "X", location: "NYC" },
  "https://jobs.ashbyhq.com/x/2": { firstSeen: "2026-05-02", title: "RevOps", source: "Tier 1: Ashby", company: "X", location: "NYC" },
  "https://jobs.ashbyhq.com/x/3": { firstSeen: "2026-05-02", title: "Ops", source: "Tier 1: Ashby", company: "X", location: "NYC" },
  // insightpartners — broken-scrape: high error rate, low fit
  "https://jobs.insightpartners.com/companies/y/jobs/1": { firstSeen: "2026-05-04", title: "Dir RevOps", source: "Insight Partners", company: "Y", location: "Remote" },
  "https://jobs.insightpartners.com/companies/y/jobs/2": { firstSeen: "2026-05-04", title: "RevOps", source: "Insight Partners", company: "Y", location: "Remote" },
  "https://jobs.insightpartners.com/companies/y/jobs/3": { firstSeen: "2026-05-05", title: "RevOps", source: "Insight Partners", company: "Y", location: "Remote" },
  // revopscareers — quarantined
  "https://revopscareers.com/job/z-revops": { firstSeen: "2026-05-06", title: "RevOps - RevOps Careers", source: "Tier 2: Exa", company: "RevOps Careers", location: "Remote" },
  // hirevector.liveblog365 — spam-blocked (parent domain match)
  "https://hirevector.liveblog365.com/job/revops-1": { firstSeen: "2026-05-07", title: "RevOps", source: "Tier 2: Exa", company: "Hirevector", location: "Remote" },
  // healthy host — good coverage, no errors, decent fit
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
    expect(b.recoverableCount).toBe(Math.round(2 * 0.8)); // 2
    expect(b.status).toBe("broken-extractor");
    expect(b.auditFinding?.fixId).toBe("5a");
    expect(b.lastSeen).toBe("2026-05-10");
    expect(b.sourceTags.sort()).toEqual(["BuiltIn", "Tier 6: Similar"]);
  });

  it("flags Ashby broken-extractor at ~33% coverage (the < 50% gate)", () => {
    const a = byHost["jobs.ashbyhq.com"];
    expect(a.hasCompCoverage).toBeCloseTo(1 / 3, 5);
    expect(a.status).toBe("broken-extractor");
  });

  it("flags the VC board broken-scrape (error-rate > 30% && maxFit < 4)", () => {
    const v = byHost["jobs.insightpartners.com"];
    expect(v.scrapeFailures).toBe(2);
    expect(v.scrapeErrorRate).toBeCloseTo(2 / 3, 5);
    expect(v.maxFit).toBe(1);
    expect(v.status).toBe("broken-scrape");
  });

  it("flags aggregator hosts quarantined and spam hosts spam-blocked (parent-domain match)", () => {
    expect(byHost["revopscareers.com"].status).toBe("quarantined");
    expect(byHost["hirevector.liveblog365.com"].status).toBe("spam-blocked");
    expect(byHost["hirevector.liveblog365.com"].auditFinding?.recoveryRate).toBe(0.4); // parent-domain finding
  });

  it("leaves a clean host healthy", () => {
    const h = byHost["jobs.lever.co"];
    expect(h.hasCompCoverage).toBe(1);
    expect(h.status).toBe("healthy");
    expect(h.auditFinding).toBeNull();
    expect(h.recoverableCount).toBe(0); // no audit finding ⇒ no recovery estimate
  });

  it("summary excludes quarantined + spam-blocked from healthy/broken tallies", () => {
    expect(summary.totalSources).toBe(rows.length);
    expect(summary.healthySources).toBe(1); // jobs.lever.co only
    expect(summary.brokenSources).toBe(3); // builtin, ashby, insightpartners
    expect(summary.quarantinedSources).toBe(1);
    expect(summary.spamBlockedSources).toBe(1);
    expect(summary.totalHasComp).toBe(4); // a1, x1, lever1, lever2
    expect(summary.totalEnriched).toBe(11);
    expect(summary.overallRecoverable).toBeGreaterThan(0);
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
  });
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `cd dashboard-web && npm test`
Expected: FAIL — `computeSourceHealth` / `getSourceHealth` / `SeenUrlsFile` / `EnrichmentsFile` not exported.

- [ ] **Step 3: Implement in `lib/source-health.ts`**

Append to `dashboard-web/lib/source-health.ts`:

```ts
// ---------------------------------------------------------------------------
// Inputs (shapes of data/seen-urls.json and data/enrichments.json)
// ---------------------------------------------------------------------------
export interface SeenUrlEntry {
  firstSeen?: string;
  title?: string;
  source?: string;
  company?: string;
  location?: string;
  closed?: boolean;
  closedDate?: string;
}
export type SeenUrlsFile = Record<string, SeenUrlEntry>;
export type EnrichmentEntry = { error?: string; timestamp?: string } & Record<string, unknown>;
export type EnrichmentsFile = Record<string, EnrichmentEntry>;

// comp_range values that mean "no usable comp"
const EMPTY_COMP = new Set(["", "not listed", "none", "n/a", "na", "not specified", "not disclosed", "unknown"]);
// bare-qualitative comp strings (no $ amount) — count as "not listed" for coverage purposes
const QUALITATIVE_COMP_RE = /^(competitive|market|top of market|industry[- ]standard|commensurate|negotiable|doe\b|depends on experience)/i;

function hasRealComp(comp_range: unknown): boolean {
  if (typeof comp_range !== "string") return false;
  const c = comp_range.trim();
  if (!c) return false;
  if (EMPTY_COMP.has(c.toLowerCase())) return false;
  if (QUALITATIVE_COMP_RE.test(c) && !/[$\d]/.test(c)) return false;
  return /[$\d]/.test(c); // require a dollar sign or a digit
}

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

function matchesHostList(host: string, list: string[]): boolean {
  return list.some((h) => host === h || host.endsWith("." + h));
}

function findAuditFinding(host: string): AuditFinding | null {
  return AUDIT_FINDINGS[host] ?? AUDIT_FINDINGS[parentDomain(host)] ?? null;
}

interface HostAccumulator {
  host: string;
  urls: Set<string>;
  enrichedReal: number;
  scrapeFailures: number;
  fitScores: number[];
  hasCompCount: number;
  notListedCount: number;
  lastSeen: string;
  sourceTags: Set<string>;
}

function classifyStatus(args: {
  host: string;
  hasCompCoverage: number;
  scrapeErrorRate: number;
  maxFit: number | null;
  auditFinding: AuditFinding | null;
}): SourceStatus {
  const { host, hasCompCoverage, scrapeErrorRate, maxFit, auditFinding } = args;
  if (matchesHostList(host, AGGREGATOR_HOSTS)) return "quarantined";
  if (matchesHostList(host, EXCLUDE_DOMAINS)) return "spam-blocked";
  if (auditFinding && auditFinding.recoveryRate >= 0.5 && hasCompCoverage < 0.5) return "broken-extractor";
  if (scrapeErrorRate > 0.3 && (maxFit ?? 0) < 4) return "broken-scrape";
  return "healthy";
}

export function computeSourceHealth(
  seenUrls: SeenUrlsFile,
  enrichments: EnrichmentsFile
): { rows: SourceHealthRow[]; summary: SourceHealthSummary } {
  const acc = new Map<string, HostAccumulator>();
  const ensure = (host: string): HostAccumulator => {
    let a = acc.get(host);
    if (!a) {
      a = { host, urls: new Set(), enrichedReal: 0, scrapeFailures: 0, fitScores: [], hasCompCount: 0, notListedCount: 0, lastSeen: "", sourceTags: new Set() };
      acc.set(host, a);
    }
    return a;
  };

  for (const [url, meta] of Object.entries(seenUrls)) {
    const host = hostnameOf(url);
    if (!host) continue;
    const a = ensure(host);
    a.urls.add(url);
    if (meta?.source) a.sourceTags.add(meta.source);
    if (meta?.firstSeen && meta.firstSeen > a.lastSeen) a.lastSeen = meta.firstSeen;
  }

  for (const [url, entry] of Object.entries(enrichments)) {
    const host = hostnameOf(url);
    if (!host) continue;
    const a = ensure(host);
    a.urls.add(url);
    const isError = entry && typeof entry === "object" && "error" in entry && Object.keys(entry).every((k) => k === "error" || k === "timestamp");
    if (isError) {
      a.scrapeFailures++;
      continue;
    }
    a.enrichedReal++;
    const fit = (entry as Record<string, unknown>).fit_score;
    if (typeof fit === "number" && Number.isFinite(fit)) a.fitScores.push(fit);
    if (hasRealComp((entry as Record<string, unknown>).comp_range)) a.hasCompCount++;
    else a.notListedCount++;
  }

  const rows: SourceHealthRow[] = [];
  for (const a of acc.values()) {
    const totalUrls = a.urls.size;
    const enrichedReal = a.enrichedReal;
    const scrapeFailures = a.scrapeFailures;
    const avgFit = a.fitScores.length ? a.fitScores.reduce((s, n) => s + n, 0) / a.fitScores.length : null;
    const maxFit = a.fitScores.length ? Math.max(...a.fitScores) : null;
    const hitRate = a.fitScores.length ? a.fitScores.filter((n) => n >= 6).length / a.fitScores.length : null;
    const hasCompCoverage = enrichedReal ? a.hasCompCount / enrichedReal : 0;
    const scrapeErrorRate = enrichedReal + scrapeFailures ? scrapeFailures / (enrichedReal + scrapeFailures) : 0;
    const auditFinding = findAuditFinding(a.host);
    const recoverableCount = Math.round(a.notListedCount * (auditFinding?.recoveryRate ?? 0));
    const projectedCompCoverage = enrichedReal ? (a.hasCompCount + recoverableCount) / enrichedReal : 0;
    const status = classifyStatus({ host: a.host, hasCompCoverage, scrapeErrorRate, maxFit, auditFinding });
    rows.push({
      host: a.host,
      totalUrls,
      enrichedReal,
      scrapeFailures,
      enrichmentRate: totalUrls ? enrichedReal / totalUrls : 0,
      scrapeErrorRate,
      avgFit: avgFit === null ? null : Math.round(avgFit * 10) / 10,
      maxFit,
      hitRate,
      hasCompCount: a.hasCompCount,
      notListedCount: a.notListedCount,
      hasCompCoverage,
      recoverableCount,
      projectedCompCoverage,
      lastSeen: a.lastSeen,
      status,
      auditFinding,
      sourceTags: [...a.sourceTags].sort(),
    });
  }

  rows.sort((a, b) => b.totalUrls - a.totalUrls || a.host.localeCompare(b.host));

  const totalEnriched = rows.reduce((s, r) => s + r.enrichedReal, 0);
  const totalHasComp = rows.reduce((s, r) => s + r.hasCompCount, 0);
  const totalNotListed = rows.reduce((s, r) => s + r.notListedCount, 0);
  const overallRecoverable = rows.reduce((s, r) => s + r.recoverableCount, 0);
  const summary: SourceHealthSummary = {
    totalSources: rows.length,
    healthySources: rows.filter((r) => r.status === "healthy").length,
    brokenSources: rows.filter((r) => r.status === "broken-extractor" || r.status === "broken-scrape").length,
    quarantinedSources: rows.filter((r) => r.status === "quarantined").length,
    spamBlockedSources: rows.filter((r) => r.status === "spam-blocked").length,
    totalEnriched,
    totalHasComp,
    totalNotListed,
    overallCompCoverage: totalEnriched ? totalHasComp / totalEnriched : 0,
    overallRecoverable,
    overallProjectedCoverage: totalEnriched ? (totalHasComp + overallRecoverable) / totalEnriched : 0,
  };
  return { rows, summary };
}

export function getSourceHealth(): { rows: SourceHealthRow[]; summary: SourceHealthSummary } {
  const seenUrls = readJsonSafe<SeenUrlsFile>(join(ROOT, "data", "seen-urls.json"), {});
  const enrichments = readJsonSafe<EnrichmentsFile>(join(ROOT, "data", "enrichments.json"), {});
  return computeSourceHealth(seenUrls, enrichments);
}
```

- [ ] **Step 4: Run — verify it passes**

Run: `cd dashboard-web && npm test`
Expected: PASS (all suites). Then `npx tsc --noEmit` — no errors.

- [ ] **Step 5: Print a sample real row (for the user sanity-check)**

Run: `cd dashboard-web && node -e "require('tsx/cjs'); const {getSourceHealth}=require('./lib/source-health.ts'); const {rows,summary}=getSourceHealth(); console.log(summary); console.log(rows.slice(0,5));"` — or, if `tsx` isn't available, add a one-off `it("logs", ...)` in the test that `console.log`s `rows.slice(0,5)` and `summary`, run `npm test`, then remove it. **STOP here and report the test output + sample rows to the user before continuing.**

- [ ] **Step 6: Commit**

```bash
git add dashboard-web/lib/source-health.ts dashboard-web/lib/source-health.test.ts
git commit -m "feat(dashboard): computeSourceHealth — per-host aggregation + status classification"
```

---

## Task 5: Sidebar nav entry

**Files:**
- Modify: `dashboard-web/components/Sidebar.tsx`

- [ ] **Step 1: Add the import + nav item**

In `dashboard-web/components/Sidebar.tsx`, add `Activity` to the lucide import, and add to `nav[]` after the Companies entry:

```ts
{ href: "/sources", label: "Source Health", icon: Activity },
```

- [ ] **Step 2: Build check**

Run: `cd dashboard-web && npm run build`
Expected: build succeeds (the route doesn't exist yet — Sidebar `<Link>` to a non-existent route is fine at build time; it 404s at runtime until Task 6/7).

- [ ] **Step 3: Commit**

```bash
git add dashboard-web/components/Sidebar.tsx
git commit -m "feat(dashboard): add Source Health to sidebar nav"
```

---

## Task 6: `/sources` server component

**Files:**
- Create: `dashboard-web/app/sources/page.tsx`

- [ ] **Step 1: Create the page**

```tsx
import { getSourceHealth } from "@/lib/source-health";
import { getSignals, getStats, getConfig } from "@/lib/data";
import { SourcesPage } from "./sources-client";

export const dynamic = "force-dynamic";

export default function Page() {
  const { rows, summary } = getSourceHealth();
  const signals = getSignals();
  const stats = getStats();
  const config = getConfig();
  const highConviction = signals.filter((s) => s.result === "high").length;
  const companyCount = config.ashby.length + config.greenhouse.length;
  return (
    <SourcesPage
      rows={rows}
      summary={summary}
      highConviction={highConviction}
      companyCount={companyCount}
      signalCount={signals.length}
      hasWarmLeads={stats.hasWarmLeads}
      activePursuing={stats.activelyPursuing}
    />
  );
}
```

- [ ] **Step 2: Commit** (won't build until Task 7 creates `sources-client.tsx` — commit together with Task 7, or stub `sources-client.tsx` first; do Task 7 step 1 before committing this).

```bash
git add dashboard-web/app/sources/page.tsx dashboard-web/app/sources/sources-client.tsx
git commit -m "feat(dashboard): /sources route — server component + Shell"
```

---

## Task 7: `sources-client.tsx` step 1 — Shell + summary strip (static render)

**Files:**
- Create: `dashboard-web/app/sources/sources-client.tsx`

- [ ] **Step 1: Minimal client component — Shell + heading + summary strip**

```tsx
"use client";

import { Activity, ShieldCheck, AlertTriangle, DollarSign, ArchiveX } from "lucide-react";
import type { SourceHealthRow, SourceHealthSummary } from "@/lib/types";
import { Shell } from "@/components/Shell";

interface SourcesPageProps {
  rows: SourceHealthRow[];
  summary: SourceHealthSummary;
  highConviction: number;
  companyCount: number;
  signalCount: number;
  hasWarmLeads: boolean;
  activePursuing: number;
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

function StatCard({ icon, value, label, sub, color, dim }: { icon: React.ReactNode; value: string | number; label: string; sub?: string; color: string; dim: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg px-4 py-3" style={{ background: "var(--surface-2)", border: "1px solid var(--border-subtle)", boxShadow: "var(--shadow-sm)" }}>
      <div className="flex h-9 w-9 items-center justify-center rounded-lg" style={{ background: dim, color }}>{icon}</div>
      <div>
        <div className="text-xl font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>{value}</div>
        <div className="text-[12px]" style={{ color: "var(--text-tertiary)" }}>{label}{sub && <span className="ml-1" style={{ color: "var(--text-muted)" }}>{sub}</span>}</div>
      </div>
    </div>
  );
}

export function SourcesPage({ rows, summary, highConviction, companyCount, signalCount, hasWarmLeads, activePursuing }: SourcesPageProps) {
  return (
    <Shell activePursuing={activePursuing} highConviction={highConviction} companyCount={companyCount} signalCount={signalCount} hasWarmLeads={hasWarmLeads}>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>Source Health</h1>
          <div className="text-[12px]" style={{ color: "var(--text-muted)" }}>
            {summary.totalSources} sources &middot; {pct(summary.overallCompCoverage)} comp coverage today &rarr; ~{pct(summary.overallProjectedCoverage)} recoverable
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          <StatCard icon={<Activity size={18} />} value={summary.totalSources} label="Sources" color="var(--accent)" dim="var(--accent-dim)" />
          <StatCard icon={<ShieldCheck size={18} />} value={summary.healthySources} label="Healthy" color="var(--emerald)" dim="var(--emerald-dim)" />
          <StatCard icon={<AlertTriangle size={18} />} value={summary.brokenSources} label="Broken" sub="extractor + scrape" color="var(--amber)" dim="var(--amber-dim)" />
          <StatCard icon={<DollarSign size={18} />} value={pct(summary.overallCompCoverage)} label="Comp today" sub={`${summary.totalHasComp}/${summary.totalEnriched}`} color="var(--blue)" dim="var(--blue-dim)" />
          <StatCard icon={<DollarSign size={18} />} value={`~${pct(summary.overallProjectedCoverage)}`} label="Recoverable" sub={`+${summary.overallRecoverable} roles`} color="var(--violet)" dim="var(--violet-dim)" />
        </div>
        <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>
          <ArchiveX size={11} className="inline -mt-0.5" /> {summary.quarantinedSources} quarantined &middot; {summary.spamBlockedSources} spam-blocked (not counted in healthy/broken)
        </div>

        {/* table / filters / expand land in Tasks 8–11 */}
        <div className="text-[12px]" style={{ color: "var(--text-muted)" }}>{rows.length} source rows — table coming next.</div>
      </div>
    </Shell>
  );
}
```

- [ ] **Step 2: Build + manual smoke**

Run: `cd dashboard-web && npm run build && npm run lint`
Expected: clean. Then `npm run dev`, open `http://localhost:3000/sources` — see the heading + 5 stat cards + the quarantined/spam-blocked line. **STOP here and report what `/sources` looks like to the user before continuing.**

- [ ] **Step 3: Commit** (combined with Task 6 — see Task 6 Step 2).

---

## Task 8: Sortable table

**Files:**
- Modify: `dashboard-web/app/sources/sources-client.tsx`

- [ ] **Step 1: Add a `useState` sort key/direction + a `<table>`**

Columns (all numeric ones get a clickable ▲▼ header; default `sortKey = "totalUrls"`, `dir = "desc"`):
`Source host` | `Total URLs` | `Enriched` (`n` + `enrichmentRate%` muted) | `Avg fit` | `Hit ≥6` (`hitRate%`) | `Comp today` (`hasCompCount` + `hasCompCoverage%` muted) | `Recoverable` (`recoverableCount`, or `—` if no audit finding) | `Scrape fails` | `Last seen` | `Status` (badge) | `Diagnosis` (truncate to ~60 chars, title attr full).

Table styling: copy the `<table>` shell from `app/signals/signals-client.tsx` (`overflow-x-auto rounded-lg`, `surface-2` bg, `border-subtle`, alternating `surface-row` rows, hover `surface-3`). `tabular-nums` on numeric cells.

`StatusBadge` helper (inline in this file):

```tsx
const STATUS_META: Record<SourceStatus, { label: string; color: string; bg: string }> = {
  healthy: { label: "Healthy", color: "var(--emerald)", bg: "var(--emerald-dim)" },
  "broken-extractor": { label: "Broken: extractor", color: "var(--amber)", bg: "var(--amber-dim)" },
  "broken-scrape": { label: "Broken: scrape", color: "var(--red)", bg: "var(--red-dim)" },
  quarantined: { label: "Quarantined", color: "var(--violet)", bg: "var(--violet-dim)" },
  "spam-blocked": { label: "Spam-blocked", color: "var(--text-muted)", bg: "var(--surface-3)" },
};
function StatusBadge({ status }: { status: SourceStatus }) {
  const m = STATUS_META[status];
  return <span className="rounded-md px-2 py-0.5 text-[11px] whitespace-nowrap" style={{ color: m.color, background: m.bg, border: `1px solid ${m.color}33` }}>{m.label}</span>;
}
```

Sort helper: `const sorted = useMemo(() => [...filtered].sort((a,b) => { const va=a[sortKey], vb=b[sortKey]; const cmp = typeof va === "number" && typeof vb === "number" ? va-vb : String(va).localeCompare(String(vb)); return dir === "asc" ? cmp : -cmp; }), [filtered, sortKey, dir]);`

- [ ] **Step 2: Build + lint + smoke; commit**

```bash
git add dashboard-web/app/sources/sources-client.tsx
git commit -m "feat(dashboard): /sources sortable table"
```

---

## Task 9: Status filter chips

**Files:**
- Modify: `dashboard-web/app/sources/sources-client.tsx`

- [ ] **Step 1: Add a `statusFilter` state + chip row**

Chips above the table (FilterBar-style): `All` (count = rows.length), then one per status that has ≥1 row, each showing its count, coloured per `STATUS_META`. Clicking toggles `statusFilter` between `"all"` and that status; `filtered = statusFilter === "all" ? rows : rows.filter(r => r.status === statusFilter)`.

- [ ] **Step 2: Build + lint + smoke; commit**

```bash
git add dashboard-web/app/sources/sources-client.tsx
git commit -m "feat(dashboard): /sources status filter chips"
```

---

## Task 10: Expandable per-host detail rows

**Files:**
- Modify: `dashboard-web/app/sources/sources-client.tsx`

- [ ] **Step 1: Add an `expanded: Set<string>` state; clicking a row toggles its host**

Below the clicked `<tr>`, render a detail `<tr>` with `colSpan={11}` (pattern from `components/ExpandedRow.tsx` — `background: var(--surface-1)`, `animate-expand-in px-8 py-4`):

- **Diagnosis** — `row.auditFinding?.diagnosis` or *"Not yet audited — run the comp audit on a sample of this host before relying on its recoverable estimate."*
- **Proposed fix** — `row.auditFinding ? \`Fix #\${row.auditFinding.fixId} — \${row.auditFinding.fixLabel}\` : "—"` ; show `compSourceTarget` as a small chip.
- **Before / after** — if `row.auditFinding`: `\`Comp coverage: \${pct(row.hasCompCoverage)} today → ~\${pct(row.projectedCompCoverage)} after Fix #\${row.auditFinding.fixId} (+~\${row.recoverableCount} roles on this host)\``.
- **Sample URLs in this state** — `row.auditFinding?.sampleUrls` as external links (lucide `ExternalLink`); if empty, render *"(no audit exemplars captured)"*.
- **Source tags** — `row.sourceTags` as chips (`surface-3` bg, `border-subtle`).

- [ ] **Step 2: Build + lint + smoke; commit**

```bash
git add dashboard-web/app/sources/sources-client.tsx
git commit -m "feat(dashboard): /sources expandable per-host detail view"
```

---

## Task 11: (folded into Task 8–10 — no separate task)

---

## Task 12: Final verification

- [ ] **Step 1: Full check**

Run: `cd dashboard-web && npm run test && npm run lint && npm run build`
Expected: tests green, lint clean, build succeeds.

- [ ] **Step 2: Manual smoke against known audit values**

`npm run dev`, open `/sources`. Confirm: `builtin.com` row → status "Broken: extractor", `Comp today` < ~15%, diagnosis mentions `&#x2B;` / `@graph`, expand shows "Fix #5a"; `job-boards.greenhouse.io` → `Comp today` 0%, "Fix #5d"; `revopscareers.com` → "Quarantined" badge, large `Recoverable`; `jobs.insightpartners.com` → "Broken: scrape"; a Lever/Ashby/Greenhouse host with good coverage → "Healthy". Sort by `Recoverable` desc → BuiltIn near the top. Filter to "Broken: extractor" → only those rows. **Report the page state + summary stats + 3 sample rows (BuiltIn, a healthy host, a quarantined host) to the user.**

- [ ] **Step 3: Commit (if any cleanup) + done**

```bash
git add -A
git commit -m "chore(dashboard): /sources final cleanup"   # only if there's anything to commit
```

(Optional, instead of the 12 granular commits: squash to one `feat(dashboard): add /sources route — Source Health analytics page`.)

---

## Self-Review

- **Spec coverage:** route ✓ (Tasks 6–7), all columns ✓ (Task 8), read from seen-urls + enrichments, no new fields ✓ (Task 4), status logic ✓ (Task 4, sharper variants per the agreed decisions), filterable by status ✓ (Task 9), sortable numerics ✓ (Task 8), clickable rows → detail view with diagnosis / proposed fix / sample URLs / before-after ✓ (Task 10), AUDIT_FINDINGS with provenance comment ✓ (Task 3), sidebar entry ✓ (Task 5), vitest ✓ (Task 1).
- **Placeholder scan:** Task 11 intentionally empty (folded) — noted, not a TODO. `getSourceHealth` print step uses `tsx` *or* a temporary test `console.log` — both concrete.
- **Type consistency:** `SourceHealthRow` / `SourceHealthSummary` / `AuditFinding` / `SourceStatus` names match across types.ts ↔ source-health.ts ↔ sources-client.tsx; `computeSourceHealth` returns `{ rows, summary }` everywhere.
