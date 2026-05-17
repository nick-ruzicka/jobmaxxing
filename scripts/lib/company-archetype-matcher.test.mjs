import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { matchSignalCompanies, classifyVelocity, passesArchetypeFilter, matchStatus } from "./company-archetype-matcher.mjs";

const TEST_ARCHETYPES = [
  {
    id: "gtm-engineering",
    name: "GTM Engineer",
    maturity: "primary",
    institutional_companies_boost: null,
  },
  {
    id: "ai-operations",
    name: "AI Operations",
    maturity: "primary",
    institutional_companies_boost: null,
  },
  {
    id: "fde",
    name: "Forward Deployed Engineer",
    maturity: "primary",
    institutional_companies_boost: null,
  },
  {
    id: "web3-bd",
    name: "Web3 BD",
    maturity: "fallback",
    institutional_companies_boost: {
      stablecoin_tier: ["Paxos", "Circle"],
      tier_1: ["Fireblocks", "Chainalysis"],
      tier_2: ["Uniswap Labs"],
    },
  },
  {
    id: "web3-bizops",
    name: "Web3 BizOps",
    maturity: "fallback",
    institutional_companies_boost: { inherit_from: "web3-bd" },
  },
];

// Test signals
const SIGNALS = [
  { slug: "acmeinc", name: "Acme Inc" },        // has roles with gtm-engineering
  { slug: "betacorp", name: "Beta Corp" },       // has roles but no matching archetype
  { slug: "paxos", name: "Paxos" },             // no roles but institutional match (fallback, should NOT match primary)
  { slug: "fireblocks", name: "Fireblocks" },   // no roles, institutional tier_1 (fallback archetype)
  { slug: "ghostco", name: "Ghost Co" },         // no roles, no institutional match
];

// Seen URLs with company data
const SEEN_URLS = {
  "https://acme.com/jobs/1": { company: "Acme Inc", title: "GTM Engineer" },
  "https://acme.com/jobs/2": { company: "Acme Inc", title: "AI Ops Lead" },
  "https://acme.com/jobs/3": { company: "Acme Inc", title: "Sales Rep" },
  "https://beta.com/jobs/1": { company: "Beta Corp", title: "Backend Engineer" },
  "https://beta.com/jobs/2": { company: "Beta Corp", title: "Product Manager" },
};

// Enrichments with archetype data
const ENRICHMENTS = {
  "https://acme.com/jobs/1": { archetype_primary: "gtm-engineering" },
  "https://acme.com/jobs/2": { archetype_primary: "ai-operations" },
  "https://acme.com/jobs/3": { archetype_primary: null },  // no match
  "https://beta.com/jobs/1": { archetype_primary: null },
  "https://beta.com/jobs/2": { archetype_primary: null },
};

describe("classifyVelocity", () => {
  it("returns cold for 0", () => assert.equal(classifyVelocity(0), "cold"));
  it("returns warming for 1-2", () => {
    assert.equal(classifyVelocity(1), "warming");
    assert.equal(classifyVelocity(2), "warming");
  });
  it("returns hot for 3-9", () => {
    assert.equal(classifyVelocity(3), "hot");
    assert.equal(classifyVelocity(9), "hot");
  });
  it("returns on_fire for 10+", () => {
    assert.equal(classifyVelocity(10), "on_fire");
    assert.equal(classifyVelocity(50), "on_fire");
  });
});

describe("matchSignalCompanies", () => {
  const results = matchSignalCompanies(SIGNALS, SEEN_URLS, ENRICHMENTS, {
    archetypes: TEST_ARCHETYPES,
  });

  it("matches company with pipeline roles that have primary archetypes", () => {
    const acme = results.get("acmeinc");
    assert.ok(acme);
    assert.deepEqual(acme.archetypes_matched.sort(), ["ai-operations", "gtm-engineering"]);
    assert.equal(acme.archetype_roles_count, 2);
    assert.equal(acme.total_roles, 3);
    assert.equal(acme.has_pipeline_roles, true);
    assert.equal(acme.hiring_velocity, "warming");
  });

  it("does not match company with pipeline roles but no primary archetype", () => {
    const beta = results.get("betacorp");
    assert.ok(beta);
    assert.deepEqual(beta.archetypes_matched, []);
    assert.equal(beta.archetype_roles_count, 0);
    assert.equal(beta.total_roles, 2);
    assert.equal(beta.hiring_velocity, "cold");
  });

  it("does NOT match institutional companies on fallback archetypes (only primary)", () => {
    // web3-bd is a fallback archetype — Paxos/Fireblocks should NOT pass
    const paxos = results.get("paxos");
    assert.ok(paxos);
    assert.deepEqual(paxos.archetypes_matched, []);
    assert.equal(paxos.has_pipeline_roles, false);
  });

  it("does not match unknown company with no data", () => {
    const ghost = results.get("ghostco");
    assert.ok(ghost);
    assert.deepEqual(ghost.archetypes_matched, []);
    assert.equal(ghost.archetype_roles_count, 0);
    assert.equal(ghost.hiring_velocity, "cold");
    assert.equal(ghost.has_pipeline_roles, false);
  });
});

describe("passesArchetypeFilter", () => {
  it("passes when archetypes_matched is non-empty", () => {
    assert.ok(passesArchetypeFilter({ archetypes_matched: ["gtm-engineering"] }));
  });
  it("fails when archetypes_matched is empty", () => {
    assert.ok(!passesArchetypeFilter({ archetypes_matched: [] }));
  });
});

describe("matchStatus", () => {
  it("returns confirmed_match when archetypes matched", () => {
    assert.equal(matchStatus({ archetypes_matched: ["fde"], has_pipeline_roles: true, total_roles: 3 }), "confirmed_match");
  });
  it("returns confirmed_no_match when has roles but none match", () => {
    assert.equal(matchStatus({ archetypes_matched: [], has_pipeline_roles: true, total_roles: 2 }), "confirmed_no_match");
  });
  it("returns unknown when no pipeline roles", () => {
    assert.equal(matchStatus({ archetypes_matched: [], has_pipeline_roles: false, total_roles: 0 }), "unknown");
  });
});
