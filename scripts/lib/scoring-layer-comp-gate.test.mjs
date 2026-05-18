import { test } from "node:test";
import assert from "node:assert/strict";
import { detectCompSourceDisagreement } from "./scoring-layer.mjs";

// Background: the comp trust gate was designed to suppress the below_floor
// penalty when comp_source=jsonld_basesalary AND Claude (in verdict/red_flags)
// reports "no comp listed." The premise: BuiltIn's JSON-LD baseSalary
// sometimes carries a generic role-class band rather than the actual posted
// comp.
//
// The Airtable bug (2026-05-18): Claude hallucinated `red_flags: ["No
// compensation listed"]` for a role whose JSON-LD clearly has $191K-$249.3K
// AND whose JD prose explicitly states the salary range. The gate fired and
// suppressed a legitimate penalty (comp_min $191K is below the $200K floor,
// not by much, but the penalty is real).
//
// Fix: when comp_range parses to a numeric band whose max value is clearly
// non-generic (>= $150K — well above typical placeholder bands of $80K-$130K),
// the gate should NOT trust Claude's "no comp" claim. Treat the JSON-LD as
// real data.

test("comp-gate — Airtable case: real range $191K-$249K + Claude 'no comp' → does NOT fire", () => {
  const result = detectCompSourceDisagreement({
    comp_source: "jsonld_basesalary",
    comp_range: "$191,000 – $249,300 /yr",
    verdict: "Exceptional fit.",
    red_flags: ["No compensation listed", "Public company likely means slower pace"],
  });
  assert.equal(result.disagrees, false,
    `gate should not fire when comp_range has real high-end value; got: ${result.reason}`);
});

test("comp-gate — generic low BuiltIn placeholder $80K-$120K + Claude 'no comp' → DOES fire", () => {
  // This is the original case the gate was designed for: BuiltIn's JSON-LD
  // shipped a generic level-band, and Claude (reading the JD) correctly said
  // "no comp listed." Gate should fire here.
  const result = detectCompSourceDisagreement({
    comp_source: "jsonld_basesalary",
    comp_range: "$80,000 – $120,000 /yr",
    verdict: "X",
    red_flags: ["No compensation listed"],
  });
  assert.equal(result.disagrees, true, "gate should still fire on generic low band");
});

test("comp-gate — edge: comp_max exactly at $150K threshold → does NOT fire (trust real data)", () => {
  const result = detectCompSourceDisagreement({
    comp_source: "jsonld_basesalary",
    comp_range: "$100K - $150K",
    verdict: "X",
    red_flags: ["No compensation listed"],
  });
  assert.equal(result.disagrees, false);
});

test("comp-gate — edge: comp_max just below threshold ($140K) → DOES fire", () => {
  const result = detectCompSourceDisagreement({
    comp_source: "jsonld_basesalary",
    comp_range: "$90K - $140K",
    verdict: "X",
    red_flags: ["No compensation listed"],
  });
  assert.equal(result.disagrees, true);
});

test("comp-gate — non-jsonld_basesalary source: gate doesn't fire regardless", () => {
  // The gate is source-scoped. Other comp_sources should never trigger it.
  const result = detectCompSourceDisagreement({
    comp_source: "claude_extracted",
    comp_range: "$50K - $80K",
    verdict: "X",
    red_flags: ["No compensation listed"],
  });
  assert.equal(result.disagrees, false);
});

test("comp-gate — no comp_range at all (existing behavior) → gate fires if Claude says no comp", () => {
  // When comp_range is absent we have no JSON-LD signal to defend with,
  // so the original conservative path stands.
  const result = detectCompSourceDisagreement({
    comp_source: "jsonld_basesalary",
    comp_range: "",
    verdict: "no comp listed",
    red_flags: [],
  });
  assert.equal(result.disagrees, true);
});

test("comp-gate — no comp_range + no Claude no-comp mention → gate doesn't fire", () => {
  const result = detectCompSourceDisagreement({
    comp_source: "jsonld_basesalary",
    comp_range: "",
    verdict: "Strong fit.",
    red_flags: ["Tech stack mismatch"],
  });
  assert.equal(result.disagrees, false);
});
