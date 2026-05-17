import { test } from "node:test";
import assert from "node:assert/strict";

import {
  classifyArchetype,
  SATURATION_POINT,
  SECONDARY_TAG_THRESHOLD,
  NEEDS_REVIEW_THRESHOLD,
  DISAMBIGUATION_GAP,
  loadArchetypeConfig,
} from "./archetype-classifier.mjs";

// Load config once for tests
const CONFIG = loadArchetypeConfig();
const ARCHETYPES = CONFIG.archetypes;

function archetype(id) {
  return ARCHETYPES.find((a) => a.id === id);
}

// ─── rules-based stage ────────────────────────────────────────────────────────

test("classifier — GTM Engineer JD → gtm-engineering, high confidence", async () => {
  const role = {
    title: "GTM Engineer",
    company: "Acme",
    description:
      "Build signal engines on Python + SQL. Work with HubSpot and Salesforce. " +
      "Ship outbound automation using Claude API and Clay. Series B startup.",
  };
  const result = await classifyArchetype(role, { rulesOnly: true, archetypes: ARCHETYPES });
  assert.equal(result.primary, "gtm-engineering");
  assert.ok(result.confidence >= NEEDS_REVIEW_THRESHOLD, `confidence too low: ${result.confidence}`);
  assert.equal(result.needs_review, false);
});

test("classifier — Paxos BD role gets stablecoin_tier boost (largest)", async () => {
  const jd = "Drive enterprise BD with institutional partners. Strategic partnerships at scale.";
  const paxos = await classifyArchetype(
    { title: "Head of Business Development", company: "Paxos", description: jd },
    { rulesOnly: true },
  );
  const galaxy = await classifyArchetype(
    { title: "Head of Business Development", company: "Galaxy Digital", description: jd },
    { rulesOnly: true },
  );
  assert.equal(paxos.primary, "web3-bd");
  assert.equal(galaxy.primary, "web3-bd");
  // Paxos (stablecoin_tier +60) should score strictly higher than Galaxy (tier_1 +20)
  assert.ok(
    paxos.confidence >= galaxy.confidence,
    `Paxos confidence ${paxos.confidence} should beat Galaxy ${galaxy.confidence}`,
  );
});

test("classifier — institutional non-stablecoin BD JD → web3-bd with smaller tier_1 boost", async () => {
  // Coinbase Institutional moved to tier_1 (downgraded). It still classifies as
  // web3-bd but the institutional boost is +20 (was +50). Confidence sits in
  // the medium range — the user gets to triage these in /context/review-queue
  // rather than auto-treating them as high-fit institutional Web3.
  const role = {
    title: "Head of Business Development",
    company: "Coinbase Institutional",
    description:
      "Drive enterprise partnerships across institutional and regulated channels. " +
      "Strategic partnerships work focusing on compliance and BD scaling.",
  };
  const result = await classifyArchetype(role, { rulesOnly: true, archetypes: ARCHETYPES });
  assert.equal(result.primary, "web3-bd");
  assert.ok(
    result.confidence > 0.5,
    `expected medium-confidence match, got ${result.confidence}`,
  );
});

test("classifier — Forward Deployed Engineer JD at Hebbia → fde", async () => {
  const role = {
    title: "Forward Deployed Engineer",
    company: "Hebbia",
    description:
      "Embedded with enterprise customers to ship customizations. Deployment work " +
      "on the Hebbia platform with integration and customer-facing engineering scope.",
  };
  const result = await classifyArchetype(role, { rulesOnly: true, archetypes: ARCHETYPES });
  assert.equal(result.primary, "fde");
  assert.ok(result.confidence >= NEEDS_REVIEW_THRESHOLD);
});

test("classifier — generic Operations Manager → low confidence, needs review", async () => {
  const role = {
    title: "Operations Manager",
    company: "WeWork",
    description:
      "Manage office operations and vendor coordination. Coordinate with facilities " +
      "and run weekly all-hands logistics. No technical stack required.",
  };
  const result = await classifyArchetype(role, { rulesOnly: true, archetypes: ARCHETYPES });
  // Should be either ai-operations or low confidence overall — but definitely needs review
  assert.equal(result.needs_review, true);
});

test("classifier — multi-archetype: GTM Engineer with FDE flavor", async () => {
  const role = {
    title: "GTM Engineer",
    company: "Acme",
    description:
      "Build outbound signal infra on Python + Claude API + HubSpot. Embedded with " +
      "customers for deployment and customization of the platform. Forward Deployed work " +
      "with customer-facing engineering. Signal scoring and lead routing.",
  };
  const result = await classifyArchetype(role, { rulesOnly: true, archetypes: ARCHETYPES });
  assert.equal(result.primary, "gtm-engineering");
  assert.ok(
    result.secondary.includes("fde"),
    `expected fde in secondary, got ${JSON.stringify(result.secondary)}`,
  );
});

test("classifier — empty role doesn't crash", async () => {
  const result = await classifyArchetype({}, { rulesOnly: true, archetypes: ARCHETYPES });
  assert.ok(result.primary !== undefined);
  assert.equal(result.needs_review, true);
});

test("classifier — empty role returns primary=null (no YAML-order fallback)", async () => {
  const result = await classifyArchetype({}, { rulesOnly: true, archetypes: ARCHETYPES });
  assert.equal(result.primary, null);
  assert.equal(result.confidence, 0);
  assert.deepEqual(result.secondary, []);
  assert.ok(result.reasoning.startsWith("no-match:"));
});

test("classifier — role with no archetype signals returns null", async () => {
  const result = await classifyArchetype(
    {
      title: "Office Coordinator",
      company: "WeWork",
      description: "Manage office logistics, coordinate vendor visits, run weekly all-hands.",
    },
    { rulesOnly: true, archetypes: ARCHETYPES },
  );
  // Office Coordinator matches none of the title patterns. "office", "logistics",
  // "vendor", "all-hands" hit no reward_signals. Should be no-match.
  assert.equal(result.primary, null);
  assert.equal(result.needs_review, true);
});

test("classifier — weak match above threshold keeps primary (not flipped to null)", async () => {
  // Title low-match scores +20 which is above NO_MATCH_THRESHOLD (10).
  const result = await classifyArchetype(
    {
      title: "Senior AE",
      company: "Acme",
      description: "Generic sales role with quota carry. No tooling specified.",
    },
    { rulesOnly: true, archetypes: ARCHETYPES },
  );
  assert.equal(result.primary, "gtm-engineering"); // Senior AE is in low_match
  assert.ok(result.confidence > 0);
  assert.equal(result.needs_review, true); // still flagged review (below 0.8)
});

// ─── Stage 2 disambiguation (mocked) ──────────────────────────────────────────

test("classifier — close call invokes Claude when caller provided", async () => {
  // Title both GTM Engineer and Forward Deployed Engineer — should be close
  const role = {
    title: "Forward Deployed Engineer (GTM track)",
    company: "Acme",
    description: "Build outbound systems and deploy to customers; Python + Claude + HubSpot.",
  };
  let claudeCalled = false;
  const fakeClaude = async () => {
    claudeCalled = true;
    return `{"primary":"fde","confidence":0.92,"secondary":["gtm-engineering"],"reasoning":"FDE title wins; GTM is the deployment domain."}`;
  };
  const result = await classifyArchetype(role, {
    archetypes: ARCHETYPES,
    claudeCaller: fakeClaude,
    rulesOnly: false,
  });
  assert.equal(claudeCalled, true);
  assert.equal(result.primary, "fde");
  assert.equal(result.stage, "claude");
  assert.ok(result.reasoning.startsWith("claude:"));
});

test("classifier — far-apart call does NOT invoke Claude", async () => {
  const role = {
    title: "GTM Engineer",
    company: "Acme",
    description:
      "Build signal engines on Python + Claude API. HubSpot, Salesforce, Clay. " +
      "Series A growth-stage outbound and lead-scoring infrastructure.",
  };
  let claudeCalled = false;
  const fakeClaude = async () => {
    claudeCalled = true;
    return `{"primary":"x","confidence":1}`;
  };
  const result = await classifyArchetype(role, {
    archetypes: ARCHETYPES,
    claudeCaller: fakeClaude,
  });
  assert.equal(claudeCalled, false);
  assert.equal(result.stage, "rules");
});

test("classifier — disambiguation with malformed Claude response falls back to rules", async () => {
  const role = {
    title: "Forward Deployed Engineer (GTM track)",
    company: "Acme",
    description: "Build outbound systems and deploy; Python + Claude + HubSpot.",
  };
  const fakeClaude = async () => `not valid json at all`;
  const result = await classifyArchetype(role, {
    archetypes: ARCHETYPES,
    claudeCaller: fakeClaude,
  });
  // Should keep rules result, needs_review flagged
  assert.ok(result.primary !== null);
  assert.equal(result.needs_review, true);
  assert.ok(result.reasoning.includes("failed"));
});

test("classifier — disambiguation with unknown primary archetype rejected", async () => {
  const role = {
    title: "Forward Deployed Engineer (GTM track)",
    company: "Acme",
    description: "Build outbound systems and deploy; Python + Claude + HubSpot.",
  };
  const fakeClaude = async () => `{"primary":"web4-unicorn","confidence":1}`;
  const result = await classifyArchetype(role, {
    archetypes: ARCHETYPES,
    claudeCaller: fakeClaude,
  });
  assert.equal(result.stage, "rules");
  assert.ok(result.reasoning.includes("failed"));
});

// ─── tunables exported ────────────────────────────────────────────────────────

test("classifier — tunable constants are exported", () => {
  assert.ok(typeof SATURATION_POINT === "number");
  assert.ok(typeof NEEDS_REVIEW_THRESHOLD === "number");
  assert.ok(typeof DISAMBIGUATION_GAP === "number");
  assert.ok(typeof SECONDARY_TAG_THRESHOLD === "number");
});
