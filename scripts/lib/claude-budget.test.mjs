import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  getBudget,
  hasBudget,
  trackCall,
  resetBudget,
  MAX_CALLS,
  MAX_COST_USD,
} from './claude-budget.mjs';

const BUDGET_FILE = path.resolve(
  new URL('../../data/budget/task-g-claude-calls.json', import.meta.url).pathname,
);

function snapshot() {
  return fs.existsSync(BUDGET_FILE) ? fs.readFileSync(BUDGET_FILE, 'utf8') : null;
}

function restore(saved) {
  if (saved === null) {
    if (fs.existsSync(BUDGET_FILE)) fs.unlinkSync(BUDGET_FILE);
  } else {
    fs.writeFileSync(BUDGET_FILE, saved);
  }
}

test('claude-budget — fresh state has 0 calls + 0 cost + budget remaining', (t) => {
  const saved = snapshot();
  t.after(() => restore(saved));
  resetBudget();
  const b = getBudget();
  assert.equal(b.calls, 0);
  assert.equal(b.totalCostUsd, 0);
  assert.equal(b.maxCalls, MAX_CALLS);
  assert.equal(b.maxCostUsd, MAX_COST_USD);
  assert.equal(b.exhausted, false);
  assert.equal(hasBudget(), true);
});

test('claude-budget — trackCall increments calls and accumulates cost', (t) => {
  const saved = snapshot();
  t.after(() => restore(saved));
  resetBudget();
  trackCall(0.01);
  trackCall(0.02);
  const b = getBudget();
  assert.equal(b.calls, 2);
  assert.equal(b.totalCostUsd, 0.03);
});

test('claude-budget — exhausted when calls reach MAX_CALLS', (t) => {
  const saved = snapshot();
  t.after(() => restore(saved));
  resetBudget();
  for (let i = 0; i < MAX_CALLS; i++) trackCall(0);
  assert.equal(hasBudget(), false);
  assert.equal(getBudget().exhausted, true);
});

test('claude-budget — exhausted when cost reaches MAX_COST_USD', (t) => {
  const saved = snapshot();
  t.after(() => restore(saved));
  resetBudget();
  trackCall(MAX_COST_USD);
  assert.equal(hasBudget(), false);
  assert.equal(getBudget().exhausted, true);
});

test('claude-budget — rejects invalid cost arguments', (t) => {
  const saved = snapshot();
  t.after(() => restore(saved));
  resetBudget();
  assert.throws(() => trackCall(-0.01));
  assert.throws(() => trackCall(NaN));
  assert.throws(() => trackCall(Infinity));
  assert.throws(() => trackCall('0.01'));
});

test('claude-budget — state persists across reads', (t) => {
  const saved = snapshot();
  t.after(() => restore(saved));
  resetBudget();
  trackCall(0.05);
  const a = getBudget();
  const b = getBudget();
  assert.equal(a.calls, b.calls);
  assert.equal(a.totalCostUsd, b.totalCostUsd);
});
