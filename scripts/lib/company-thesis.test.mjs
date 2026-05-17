// company-thesis.test.mjs — tests for cached per-company thesis generation.
//
// We never hit the real Claude API — `claudeCall` is injected. Cache lives
// in a tmp directory per-test so runs are independent and we never touch
// data/company-theses/.

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import {
  generateThesis,
  buildThesisPrompt,
  parseThesisResponse,
  thesisStale,
} from "./company-thesis.mjs";

const SAMPLE_AGG = {
  identity: {
    name: "Acme AI",
    slug: "acmeai",
    funding_amount: "$50M",
    funding_date: "2026-05-12",
    ats: "ashby",
    employee_count: null,
  },
  roles: [
    { id: "r1", title: "GTM Engineer", archetype_primary: "gtm-engineering", score_adjusted: 8, score_base: 7, link: "https://j.com/r1" },
  ],
  hiring_velocity: "warming",
  enrichment_summary: {
    green_flags: [{ flag: "AI-native company", count: 2 }],
    red_flags: [{ flag: "No remote option", count: 1 }],
    team_context: [{ theme: "Founding role, building from zero", count: 1 }],
    company_stage: { mode: "Series B", count: 2 },
    build_component: [{ value: true, count: 1 }],
    ai_signal: [{ value: true, count: 2 }],
  },
  archetype_distribution: { "gtm-engineering": 1 },
  last_role_seen_date: "2026-05-10",
};

let CACHE_DIR;

beforeEach(() => {
  CACHE_DIR = mkdtempSync(join(tmpdir(), "company-thesis-test-"));
});

after(() => {
  // beforeEach mints a fresh dir per test; we just leave them in the OS tmp.
});

// ---------------------------------------------------------------------------
// buildThesisPrompt — pure
// ---------------------------------------------------------------------------

describe("buildThesisPrompt", () => {
  it("includes the company name, funding, stage, and aggregated flags", () => {
    const prompt = buildThesisPrompt(SAMPLE_AGG);
    assert.match(prompt, /Acme AI/);
    assert.match(prompt, /\$50M/);
    assert.match(prompt, /Series B/);
    assert.match(prompt, /AI-native company/);
    assert.match(prompt, /Founding role/);
  });

  it("asks for 2 sentences, ~50 words, no platitudes", () => {
    const prompt = buildThesisPrompt(SAMPLE_AGG);
    assert.match(prompt, /2 sentences|two sentences/i);
    assert.match(prompt, /50 words/);
    assert.match(prompt, /platitudes|specific/i);
  });
});

// ---------------------------------------------------------------------------
// parseThesisResponse — tolerates markdown fences and chatter
// ---------------------------------------------------------------------------

describe("parseThesisResponse", () => {
  it("returns the trimmed body for a plain response", () => {
    const out = parseThesisResponse("Acme AI is betting on X. They matter because Y.");
    assert.equal(out, "Acme AI is betting on X. They matter because Y.");
  });

  it("strips markdown code fences", () => {
    const out = parseThesisResponse("```\nAcme AI is betting on X. They matter because Y.\n```");
    assert.equal(out, "Acme AI is betting on X. They matter because Y.");
  });

  it("strips leading 'Thesis:' label if Claude adds one", () => {
    const out = parseThesisResponse("Thesis: Acme AI is betting on X.");
    assert.equal(out, "Acme AI is betting on X.");
  });
});

// ---------------------------------------------------------------------------
// thesisStale — cache invalidation
// ---------------------------------------------------------------------------

describe("thesisStale", () => {
  it("returns true when last_role_seen_date is newer than thesis generated_at", () => {
    assert.equal(thesisStale("2026-05-10", "2026-05-09T00:00:00.000Z"), true);
  });

  it("returns false when last_role_seen_date is older", () => {
    assert.equal(thesisStale("2026-05-08", "2026-05-09T00:00:00.000Z"), false);
  });

  it("returns false when last_role_seen_date is null (signal-only company)", () => {
    assert.equal(thesisStale(null, "2026-05-09T00:00:00.000Z"), false);
  });

  it("returns true when there is no prior thesis at all", () => {
    assert.equal(thesisStale("2026-05-10", null), true);
  });
});

// ---------------------------------------------------------------------------
// generateThesis — cache hit, miss, stale, error paths
// ---------------------------------------------------------------------------

describe("generateThesis — cache miss", () => {
  it("calls Claude, writes the cache file, and returns the thesis", async () => {
    let calls = 0;
    const claudeCall = async (prompt) => {
      calls++;
      assert.match(prompt, /Acme AI/);
      return "Acme AI is betting on AI-native GTM ops. Matters because Series B + founding role.";
    };
    const result = await generateThesis(SAMPLE_AGG, {
      cacheDir: CACHE_DIR,
      claudeCall,
      now: () => new Date("2026-05-15T12:00:00.000Z"),
    });
    assert.equal(calls, 1);
    assert.equal(result.cached, false);
    assert.match(result.thesis, /Acme AI/);
    assert.equal(result.generated_at, "2026-05-15T12:00:00.000Z");

    // Cache file written
    const cachePath = join(CACHE_DIR, "acmeai.json");
    assert.equal(existsSync(cachePath), true);
    const cached = JSON.parse(readFileSync(cachePath, "utf-8"));
    assert.match(cached.thesis, /Acme AI/);
    assert.equal(cached.generated_at, "2026-05-15T12:00:00.000Z");
  });
});

describe("generateThesis — cache hit", () => {
  it("returns cached thesis without calling Claude", async () => {
    const cachePath = join(CACHE_DIR, "acmeai.json");
    writeFileSync(
      cachePath,
      JSON.stringify({
        thesis: "Cached thesis text.",
        generated_at: "2026-05-12T10:00:00.000Z",
      }) + "\n"
    );
    let calls = 0;
    const claudeCall = async () => { calls++; return "should not be called"; };
    const result = await generateThesis(SAMPLE_AGG, {
      cacheDir: CACHE_DIR,
      claudeCall,
      now: () => new Date("2026-05-15T12:00:00.000Z"),
    });
    assert.equal(calls, 0);
    assert.equal(result.cached, true);
    assert.equal(result.thesis, "Cached thesis text.");
  });
});

describe("generateThesis — cache stale (new role seen after cache)", () => {
  it("regenerates when last_role_seen_date is newer than cached generated_at", async () => {
    const cachePath = join(CACHE_DIR, "acmeai.json");
    writeFileSync(
      cachePath,
      JSON.stringify({
        thesis: "Old cached thesis.",
        generated_at: "2026-05-01T10:00:00.000Z", // older than the agg's last_role_seen_date
      }) + "\n"
    );
    let calls = 0;
    const claudeCall = async () => { calls++; return "Fresh thesis content."; };
    const result = await generateThesis(SAMPLE_AGG, {
      cacheDir: CACHE_DIR,
      claudeCall,
      now: () => new Date("2026-05-15T12:00:00.000Z"),
    });
    assert.equal(calls, 1);
    assert.equal(result.cached, false);
    assert.equal(result.thesis, "Fresh thesis content.");
  });
});

describe("generateThesis — Claude error path", () => {
  it("returns a result with thesis=null and an error field when claudeCall throws", async () => {
    const claudeCall = async () => { throw new Error("budget exhausted"); };
    const result = await generateThesis(SAMPLE_AGG, {
      cacheDir: CACHE_DIR,
      claudeCall,
      now: () => new Date("2026-05-15T12:00:00.000Z"),
    });
    assert.equal(result.thesis, null);
    assert.equal(result.cached, false);
    assert.match(result.error, /budget exhausted/);
    // No cache file written on error.
    assert.equal(existsSync(join(CACHE_DIR, "acmeai.json")), false);
  });
});

describe("generateThesis — force regenerate", () => {
  it("ignores the cache and regenerates when opts.force=true", async () => {
    const cachePath = join(CACHE_DIR, "acmeai.json");
    writeFileSync(
      cachePath,
      JSON.stringify({
        thesis: "Old cached thesis.",
        generated_at: "2026-05-12T10:00:00.000Z",
      }) + "\n"
    );
    let calls = 0;
    const claudeCall = async () => { calls++; return "Forced regen thesis."; };
    const result = await generateThesis(SAMPLE_AGG, {
      cacheDir: CACHE_DIR,
      claudeCall,
      now: () => new Date("2026-05-15T12:00:00.000Z"),
      force: true,
    });
    assert.equal(calls, 1);
    assert.equal(result.cached, false);
    assert.equal(result.thesis, "Forced regen thesis.");
  });
});

describe("generateThesis — readOnly", () => {
  it("returns cached value without calling Claude when readOnly=true (cache hit)", async () => {
    const cachePath = join(CACHE_DIR, "acmeai.json");
    writeFileSync(
      cachePath,
      JSON.stringify({
        thesis: "Cached thesis.",
        generated_at: "2026-05-12T10:00:00.000Z",
      }) + "\n"
    );
    let calls = 0;
    const claudeCall = async () => { calls++; return "should not run"; };
    const result = await generateThesis(SAMPLE_AGG, {
      cacheDir: CACHE_DIR,
      claudeCall,
      readOnly: true,
    });
    assert.equal(calls, 0);
    assert.equal(result.cached, true);
    assert.equal(result.thesis, "Cached thesis.");
  });

  it("returns thesis=null without calling Claude when readOnly=true and no cache", async () => {
    let calls = 0;
    const claudeCall = async () => { calls++; return "should not run"; };
    const result = await generateThesis(SAMPLE_AGG, {
      cacheDir: CACHE_DIR,
      claudeCall,
      readOnly: true,
    });
    assert.equal(calls, 0);
    assert.equal(result.thesis, null);
    assert.equal(result.cached, false);
  });
});
