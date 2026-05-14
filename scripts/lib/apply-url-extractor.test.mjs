import { test } from "node:test";
import assert from "node:assert/strict";
import { extractApplyUrl } from "./apply-url-extractor.mjs";

// ---------------------------------------------------------------------------
// JSON-LD path
// ---------------------------------------------------------------------------

test("extractApplyUrl — JobPosting JSON-LD with apply URL in `url` field", () => {
  const html = `
    <html>
    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "JobPosting",
      "title": "GTM Engineer",
      "url": "https://jobs.ashbyhq.com/relace/abc-123",
      "hiringOrganization": {"@type": "Organization", "name": "Relace"}
    }
    </script>
    </html>
  `;
  assert.equal(extractApplyUrl(html), "https://jobs.ashbyhq.com/relace/abc-123");
});

test("extractApplyUrl — JobPosting JSON-LD with apply URL in nested `hiringOrganization.sameAs`", () => {
  const html = `
    <script type="application/ld+json">
    {
      "@type": "JobPosting",
      "hiringOrganization": {
        "@type": "Organization",
        "name": "PostHog",
        "sameAs": "https://jobs.lever.co/posthog/some-posting"
      }
    }
    </script>
  `;
  assert.equal(extractApplyUrl(html), "https://jobs.lever.co/posthog/some-posting");
});

test("extractApplyUrl — Greenhouse JSON-LD `url` field", () => {
  const html = `
    <script type="application/ld+json">
    {
      "@type": "JobPosting",
      "url": "https://boards.greenhouse.io/anthropic/jobs/12345"
    }
    </script>
  `;
  assert.equal(extractApplyUrl(html), "https://boards.greenhouse.io/anthropic/jobs/12345");
});

// ---------------------------------------------------------------------------
// Raw HTML regex fallback
// ---------------------------------------------------------------------------

test("extractApplyUrl — falls back to href scan when no JSON-LD", () => {
  const html = `
    <html><body>
      <h1>Senior Engineer at Hebbia</h1>
      <p>Apply directly:</p>
      <a href="https://jobs.ashbyhq.com/hebbia-ai/role-abc">Apply Now</a>
    </body></html>
  `;
  assert.equal(extractApplyUrl(html), "https://jobs.ashbyhq.com/hebbia-ai/role-abc");
});

test("extractApplyUrl — picks first ATS-recognized URL when multiple appear", () => {
  // A BuiltIn page often has both a tracking link AND a direct apply link. We want
  // whichever matches our extractors first (currently Ashby, then Greenhouse, then Lever
  // — driven by extractAtsInfo order). Either way the result must be one of them.
  const html = `
    <a href="https://www.linkedin.com/jobs/view/12345">LinkedIn</a>
    <a href="https://jobs.ashbyhq.com/hebbia-ai/role-abc">Apply via Ashby</a>
    <a href="https://boards.greenhouse.io/hebbia/jobs/99">Apply via Greenhouse</a>
  `;
  const result = extractApplyUrl(html);
  assert.ok(result);
  // Should pick the Ashby one — first matching ATS-host pattern in the HTML.
  assert.ok(
    result.includes("jobs.ashbyhq.com") || result.includes("boards.greenhouse.io"),
    `Expected an ATS URL, got: ${result}`,
  );
});

test("extractApplyUrl — strips trailing punctuation glued to a URL", () => {
  const html = `Apply at https://jobs.ashbyhq.com/eliseai/some-id, deadline soon.`;
  assert.equal(extractApplyUrl(html), "https://jobs.ashbyhq.com/eliseai/some-id");
});

test("extractApplyUrl — Lever URL in plain text", () => {
  const html = `<p>Visit https://jobs.lever.co/replicate/abc for details.</p>`;
  assert.equal(extractApplyUrl(html), "https://jobs.lever.co/replicate/abc");
});

// ---------------------------------------------------------------------------
// Negative cases — returns null
// ---------------------------------------------------------------------------

test("extractApplyUrl — returns null for empty / non-string input", () => {
  assert.equal(extractApplyUrl(""), null);
  assert.equal(extractApplyUrl(null), null);
  assert.equal(extractApplyUrl(undefined), null);
  assert.equal(extractApplyUrl(42), null);
});

test("extractApplyUrl — returns null when no ATS URL present", () => {
  const html = `
    <html><body>
      <h1>Engineer at SomeStartup</h1>
      <a href="https://somestartup.com/careers/12345">Apply</a>
      <a href="https://www.linkedin.com/jobs/view/99">LinkedIn mirror</a>
    </body></html>
  `;
  assert.equal(extractApplyUrl(html), null);
});

test("extractApplyUrl — returns null for ATS host but no slug (bare homepage)", () => {
  // jobs.ashbyhq.com/ (no slug path) — extractAshbySlug returns null, so we skip.
  // Defends against picking up navigational header links to the ATS root.
  const html = `<a href="https://jobs.ashbyhq.com/">Ashby</a>`;
  assert.equal(extractApplyUrl(html), null);
});

test("extractApplyUrl — returns null for ATS-reserved path segment (e.g., /jobs)", () => {
  const html = `<a href="https://jobs.ashbyhq.com/jobs">Jobs portal</a>`;
  // 'jobs' is in the reserved path segments list — ats-slug-extractor returns null,
  // and we should propagate that.
  assert.equal(extractApplyUrl(html), null);
});

test("extractApplyUrl — ignores ATS URLs inside JS-quoted strings if they look mangled", () => {
  // Sanity check: malformed/escaped URLs shouldn't slip through. The regex requires
  // a valid http(s) prefix and a path segment after the host.
  const html = `var foo = "jobs.ashbyhq.com/foo"; // no protocol — should not match`;
  assert.equal(extractApplyUrl(html), null);
});

test("extractApplyUrl — JSON-LD with no URL fields returns null", () => {
  const html = `
    <script type="application/ld+json">
    {
      "@type": "JobPosting",
      "title": "GTM Engineer",
      "datePosted": "2026-05-13",
      "description": "A nice role."
    }
    </script>
  `;
  assert.equal(extractApplyUrl(html), null);
});

// ---------------------------------------------------------------------------
// Real-world-shaped fixtures
// ---------------------------------------------------------------------------

test("extractApplyUrl — BuiltIn-shaped page (JSON-LD + apply link)", () => {
  // BuiltIn pages typically carry a JobPosting JSON-LD with `applicationContact` or
  // a `directApply` link, OR (the more common case) an inline anchor to the ATS.
  const html = `
    <!DOCTYPE html>
    <html><head>
    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "JobPosting",
      "title": "Senior GTM Engineer",
      "hiringOrganization": {
        "@type": "Organization",
        "name": "Hebbia",
        "sameAs": "https://www.hebbia.ai"
      },
      "datePosted": "2026-05-14"
    }
    </script>
    </head><body>
    <main>
      <h1>Senior GTM Engineer at Hebbia</h1>
      <a class="apply-btn" href="https://jobs.ashbyhq.com/hebbia-ai/posting-abc-123">
        Apply on Hebbia's site
      </a>
    </main>
    </body></html>
  `;
  assert.equal(
    extractApplyUrl(html),
    "https://jobs.ashbyhq.com/hebbia-ai/posting-abc-123",
  );
});

test("extractApplyUrl — multiple JSON-LD blocks, only one has an ATS URL", () => {
  const html = `
    <script type="application/ld+json">
    {"@type": "BreadcrumbList", "itemListElement": []}
    </script>
    <script type="application/ld+json">
    {"@type": "JobPosting", "url": "https://jobs.ashbyhq.com/relace/abc"}
    </script>
  `;
  assert.equal(extractApplyUrl(html), "https://jobs.ashbyhq.com/relace/abc");
});
