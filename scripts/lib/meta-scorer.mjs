// meta-scorer.mjs — read patterns from data/score-overrides.json (READ-ONLY)
// and recent events, and propose new scoring rules that explain user behavior.
//
// READ-ONLY contract: this module MUST NEVER write to score-overrides.json.
// The Task G hard constraint is explicit. Rule proposals are emitted as
// backtest.rule_proposed events and saved to data/rule-proposals/ (NOT to
// score-overrides.json).

import { readFileSync, existsSync, mkdirSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

import { readEvents } from "./event-aggregator.mjs";
import { loadBacktestConfig } from "./backtest-engine.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const OVERRIDES_PATH = join(ROOT, "data", "score-overrides.json");
const PROPOSALS_DIR = join(ROOT, "data", "rule-proposals");

/**
 * Read the score-overrides file (READ-ONLY: never mutate or write back).
 */
export function readOverrides() {
  if (!existsSync(OVERRIDES_PATH)) return { boost: {}, penalize: {}, block: [] };
  return JSON.parse(readFileSync(OVERRIDES_PATH, "utf8"));
}

/**
 * Identify recurring patterns in score overrides + events.
 *
 * Returns an array of rule proposals — each one explains a pattern the
 * meta-scorer observed enough times to be worth proposing.
 *
 * @param {object} [opts]
 * @param {object} [opts.overrides] - inject for tests
 * @param {object[]} [opts.events] - inject for tests
 * @returns {object[]} rule proposals
 */
export function proposeRules({ overrides, events } = {}) {
  const config = loadBacktestConfig();
  const allOverrides = overrides ?? readOverrides();
  const allEvents = events ?? readEvents({});

  const proposals = [];

  // Pattern 1: persistent rejection in `penalize` — a company appears with
  // both an evaluator high score AND a rejection outcome. If many companies
  // do this in the same archetype/role family, the scoring layer is over-
  // rewarding something.
  const penalize = allOverrides?.penalize ?? {};
  const rejectedHighFit = Object.values(penalize).filter((entry) => {
    const reason = (entry?.reason ?? "").toLowerCase();
    return reason.includes("rejected") && /eval\s+\d/.test(reason);
  });
  if (rejectedHighFit.length >= config.sample_size_min) {
    proposals.push({
      id: `proposal-${Date.now()}-rejected-high-fit`,
      kind: "investigate-rejection-cluster",
      observation: `${rejectedHighFit.length} companies show high evaluation but ultimate rejection`,
      sample_size: rejectedHighFit.length,
      sample_companies: rejectedHighFit.slice(0, 5).map((e) => e.company),
      recommendation: "Surface this cluster in /context review — eval-vs-outcome divergence suggests scoring blind spot.",
    });
  }

  // Pattern 2: archetype-correction events. When users repeatedly correct
  // classifier output FROM one archetype TO another, the classifier rules
  // for that archetype likely need tuning.
  const corrections = allEvents.filter((e) => e.type === "role.archetype_corrected");
  const transitionCounts = new Map();
  for (const e of corrections) {
    const from = e.payload?.from_archetype;
    const to = e.payload?.to_archetype;
    if (!from || !to) continue;
    const key = `${from} → ${to}`;
    transitionCounts.set(key, (transitionCounts.get(key) || 0) + 1);
  }
  for (const [transition, count] of transitionCounts) {
    if (count >= config.sample_size_min) {
      proposals.push({
        id: `proposal-${Date.now()}-correction-${transition.replace(/\s+/g, "_")}`,
        kind: "classifier-tuning",
        observation: `User corrected ${count} roles from ${transition.split(" → ")[0]} to ${transition.split(" → ")[1]}`,
        sample_size: count,
        transition,
        recommendation: `Strengthen ${transition.split(" → ")[1]}'s reward signals or weaken ${transition.split(" → ")[0]}'s title overlap.`,
      });
    }
  }

  // Pattern 3: dismissed roles correlating with archetype. If many roles of
  // a particular archetype are dismissed, the archetype-side scoring may be
  // letting in false positives.
  const dismissals = allEvents.filter((e) => e.type === "role.dismissed");
  const dismissalsByArchetype = new Map();
  for (const e of dismissals) {
    const arch = e.archetype || e.payload?.archetype;
    if (!arch) continue;
    dismissalsByArchetype.set(arch, (dismissalsByArchetype.get(arch) || 0) + 1);
  }
  for (const [archetype, count] of dismissalsByArchetype) {
    if (count >= config.sample_size_min) {
      proposals.push({
        id: `proposal-${Date.now()}-dismissals-${archetype}`,
        kind: "false-positive-cluster",
        observation: `User dismissed ${count} roles tagged ${archetype}`,
        sample_size: count,
        archetype,
        recommendation: `Review ${archetype} reward keywords — likely letting weak matches through. Consider raising title-match weight or pruning low-signal keywords.`,
      });
    }
  }

  return proposals;
}

/**
 * Persist a proposal set to data/rule-proposals/YYYY-MM-DD.jsonl.
 *
 * Tests inject `dir` to avoid touching the real directory.
 */
export function persistProposals(proposals, { dir = PROPOSALS_DIR } = {}) {
  if (!proposals?.length) return null;
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const day = new Date().toISOString().slice(0, 10);
  const path = join(dir, `${day}.jsonl`);
  for (const p of proposals) {
    writeFileSync(path, JSON.stringify(p) + "\n", { flag: "a" });
  }
  return path;
}
