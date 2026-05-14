import { describe, it, expect } from "vitest";
import { analyzeUrlPatterns } from "./source-detail";

describe("analyzeUrlPatterns", () => {
  it("collapses numeric ids and hyphenated slugs", () => {
    const out = analyzeUrlPatterns([
      "https://builtin.com/job/revenue-operations-manager/3596033",
      "https://builtin.com/job/sales-engineer/4123456",
      "https://builtin.com/job/sales-engineer/4123457",
    ]);
    // All three roll up to one pattern: /job/{slug}/{id}
    expect(out).toHaveLength(1);
    expect(out[0].pattern).toBe("/job/{slug}/{id}");
    expect(out[0].count).toBe(3);
  });

  it("keeps short literal segments distinct (no over-collapsing)", () => {
    const out = analyzeUrlPatterns([
      "https://x.com/job/foo/1",
      "https://x.com/job/foo/2",
      "https://x.com/job/bar/3",
    ]);
    // foo and bar are short literal segments, treated as different fixed paths.
    expect(out).toHaveLength(2);
    expect(new Set(out.map((p) => p.pattern))).toEqual(
      new Set(["/job/foo/{id}", "/job/bar/{id}"]),
    );
  });

  it("collapses long hex ids to {uuid}", () => {
    const out = analyzeUrlPatterns([
      "https://jobs.ashbyhq.com/eliseai/7a74322c-415a-41cb-8956-ee170d3bb267",
      "https://jobs.ashbyhq.com/eliseai/8b85432d-526b-52cb-9866-ff180d4cc278",
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].pattern).toBe("/eliseai/{uuid}");
    expect(out[0].count).toBe(2);
  });

  it("returns separate buckets for genuinely different shapes", () => {
    const out = analyzeUrlPatterns([
      "https://x.com/job/foo-bar/1",
      "https://x.com/job/foo-bar/2",
      "https://x.com/jobs/listing/99",
    ]);
    expect(out).toHaveLength(2);
    // First is the high-count pattern
    expect(out[0].count).toBe(2);
    expect(out[0].pattern).toBe("/job/{slug}/{id}");
    expect(out[1].count).toBe(1);
    expect(out[1].pattern).toBe("/jobs/listing/{id}");
  });

  it("sorts by count descending", () => {
    const out = analyzeUrlPatterns([
      "https://x.com/rare/alpha-beta",
      "https://x.com/job/foo-bar/1",
      "https://x.com/job/foo-bar/2",
      "https://x.com/job/baz-qux/3",
    ]);
    expect(out[0].pattern).toBe("/job/{slug}/{id}");
    expect(out[0].count).toBe(3);
  });

  it("returns empty array on empty input", () => {
    expect(analyzeUrlPatterns([])).toEqual([]);
  });

  it("survives unparseable urls", () => {
    const out = analyzeUrlPatterns(["not a url", "https://x.com/foo-bar/1"]);
    expect(out).toHaveLength(1);
    expect(out[0].pattern).toBe("/{slug}/{id}");
  });
});
