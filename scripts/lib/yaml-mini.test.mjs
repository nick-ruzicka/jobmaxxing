import { test } from "node:test";
import assert from "node:assert/strict";
import { parseYaml } from "./yaml-mini.mjs";

test("yaml-mini — empty input returns {}", () => {
  assert.deepEqual(parseYaml(""), {});
});

test("yaml-mini — flat mapping with scalars", () => {
  const result = parseYaml(`
name: Alice
age: 30
active: true
nickname: ~
notes: null
score: 4.5
`);
  assert.deepEqual(result, { name: "Alice", age: 30, active: true, nickname: null, notes: null, score: 4.5 });
});

test("yaml-mini — parses leading-plus integers (config readability)", () => {
  const result = parseYaml(`
boost: +5
penalty: -40
neutral: 0
big: +10
`);
  assert.equal(result.boost, 5);
  assert.equal(result.penalty, -40);
  assert.equal(result.neutral, 0);
  assert.equal(result.big, 10);
});

test("yaml-mini — parses leading-plus floats", () => {
  const result = parseYaml(`a: +1.5\nb: -2.5\n`);
  assert.equal(result.a, 1.5);
  assert.equal(result.b, -2.5);
});

test("yaml-mini — quoted strings preserve special chars", () => {
  const result = parseYaml(`title: "Hello: World"\nother: 'a single # quoted'`);
  assert.equal(result.title, "Hello: World");
  assert.equal(result.other, "a single # quoted");
});

test("yaml-mini — inline list", () => {
  const result = parseYaml(`tags: [a, b, c]`);
  assert.deepEqual(result.tags, ["a", "b", "c"]);
});

test("yaml-mini — inline list with quoted items", () => {
  const result = parseYaml(`items: ["hello, world", "x"]`);
  assert.deepEqual(result.items, ["hello, world", "x"]);
});

test("yaml-mini — block list of scalars", () => {
  const result = parseYaml(`
fruits:
  - apple
  - banana
  - cherry
`);
  assert.deepEqual(result.fruits, ["apple", "banana", "cherry"]);
});

test("yaml-mini — block list of mappings", () => {
  const result = parseYaml(`
people:
  - name: Alice
    age: 30
  - name: Bob
    age: 25
`);
  assert.deepEqual(result.people, [
    { name: "Alice", age: 30 },
    { name: "Bob", age: 25 },
  ]);
});

test("yaml-mini — nested mapping", () => {
  const result = parseYaml(`
config:
  database:
    host: localhost
    port: 5432
  cache:
    ttl: 60
`);
  assert.deepEqual(result.config, {
    database: { host: "localhost", port: 5432 },
    cache: { ttl: 60 },
  });
});

test("yaml-mini — list inside nested mapping inside list item", () => {
  const result = parseYaml(`
archetypes:
  - id: gtm
    keywords:
      - python
      - sql
  - id: ai
    keywords:
      - claude
`);
  assert.deepEqual(result.archetypes, [
    { id: "gtm", keywords: ["python", "sql"] },
    { id: "ai", keywords: ["claude"] },
  ]);
});

test("yaml-mini — mapping with inline list inside list item", () => {
  const result = parseYaml(`
groups:
  - keywords: [python, sql, clay]
    weight: 5
  - keywords: [claude, gpt]
    weight: 7
`);
  assert.deepEqual(result.groups, [
    { keywords: ["python", "sql", "clay"], weight: 5 },
    { keywords: ["claude", "gpt"], weight: 7 },
  ]);
});

test("yaml-mini — comments stripped", () => {
  const result = parseYaml(`
# leading comment
name: Alice  # trailing comment
# blank line below

age: 30
`);
  assert.deepEqual(result, { name: "Alice", age: 30 });
});

test("yaml-mini — comment hash inside quoted string preserved", () => {
  const result = parseYaml(`title: "this # is part of the string"`);
  assert.equal(result.title, "this # is part of the string");
});

test("yaml-mini — colon inside quoted list element does not split", () => {
  const result = parseYaml(`places: ["New York, NY", "San Francisco, CA"]`);
  assert.deepEqual(result.places, ["New York, NY", "San Francisco, CA"]);
});

test("yaml-mini — deep nesting (mapping > list > mapping > inline list)", () => {
  const result = parseYaml(`
archetypes:
  - id: gtm
    title_signals:
      high_match: ["GTM Engineer", "Revenue Engineer"]
      medium_match: ["Sales Engineer"]
  - id: ai
    title_signals:
      high_match: ["AI Ops Lead"]
`);
  assert.equal(result.archetypes[0].title_signals.high_match[0], "GTM Engineer");
  assert.equal(result.archetypes[0].title_signals.medium_match[0], "Sales Engineer");
  assert.equal(result.archetypes[1].title_signals.high_match[0], "AI Ops Lead");
});

test("yaml-mini — global_disqualifiers shape", () => {
  const result = parseYaml(`
global_disqualifiers:
  location:
    - "fully on-site SF"
    - "fully on-site LA"
  comp_below: 200000
  industries_blocked: [gambling, weapons]
`);
  assert.deepEqual(result.global_disqualifiers, {
    location: ["fully on-site SF", "fully on-site LA"],
    comp_below: 200000,
    industries_blocked: ["gambling", "weapons"],
  });
});
