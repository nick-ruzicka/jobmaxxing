// Claude API budget tracker for Task G autonomous session.
// Hard caps: 200 calls / $5.00 total. Persists across processes via JSON file.

import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
const BUDGET_DIR = path.join(REPO_ROOT, 'data', 'budget');
const BUDGET_FILE = path.join(BUDGET_DIR, 'task-g-claude-calls.json');

export const MAX_CALLS = 200;
export const MAX_COST_USD = 5.0;

function readState() {
  try {
    const raw = fs.readFileSync(BUDGET_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      calls: Number(parsed.calls) || 0,
      totalCostUsd: Number(parsed.totalCostUsd) || 0,
      lastUpdated: parsed.lastUpdated || null,
    };
  } catch (err) {
    if (err.code === 'ENOENT') return { calls: 0, totalCostUsd: 0, lastUpdated: null };
    throw err;
  }
}

function writeState(state) {
  fs.mkdirSync(BUDGET_DIR, { recursive: true });
  const tmp = `${BUDGET_FILE}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n');
  fs.renameSync(tmp, BUDGET_FILE);
}

export function getBudget() {
  const state = readState();
  return {
    calls: state.calls,
    totalCostUsd: Number(state.totalCostUsd.toFixed(4)),
    maxCalls: MAX_CALLS,
    maxCostUsd: MAX_COST_USD,
    exhausted: state.calls >= MAX_CALLS || state.totalCostUsd >= MAX_COST_USD,
    remainingCalls: Math.max(0, MAX_CALLS - state.calls),
    remainingCostUsd: Math.max(0, MAX_COST_USD - state.totalCostUsd),
  };
}

export function hasBudget() {
  return !getBudget().exhausted;
}

export function trackCall(costUsd) {
  if (typeof costUsd !== 'number' || costUsd < 0 || !Number.isFinite(costUsd)) {
    throw new Error(`trackCall requires non-negative finite number, got ${costUsd}`);
  }
  const state = readState();
  state.calls += 1;
  state.totalCostUsd = Number((state.totalCostUsd + costUsd).toFixed(4));
  state.lastUpdated = new Date().toISOString();
  writeState(state);
  return getBudget();
}

export function resetBudget() {
  writeState({ calls: 0, totalCostUsd: 0, lastUpdated: null });
}
