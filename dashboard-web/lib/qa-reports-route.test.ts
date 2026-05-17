// Route-handler smoke test for GET /api/qa-reports.
//
// Lives under lib/ so the vitest config picks it up (the dashboard's
// vitest.config.ts globs `lib/**/*.test.ts` to keep React-heavy app
// code out of the pure-logic test suite).

import { mkdirSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { describe, expect, it } from "vitest";

import { buildResponse } from "../app/api/qa-reports/route";
import type { QaReportsData } from "./qa-reports";

function makeTempQaRoot() {
  const root = mkdtempSync(join(tmpdir(), "qa-route-test-"));
  const qa = join(root, "qa");
  const personasDir = join(qa, "personas");
  const reportsDir = join(qa, "reports");
  const scenariosResultsDir = join(qa, "scenarios-results");
  const regressionsDir = join(qa, "regressions");
  const synthesisDir = join(qa, "synthesis");
  for (const d of [
    personasDir,
    reportsDir,
    scenariosResultsDir,
    regressionsDir,
    synthesisDir,
  ]) {
    mkdirSync(d, { recursive: true });
  }
  return { personasDir, reportsDir, scenariosResultsDir, regressionsDir, synthesisDir };
}

const PERSONA_YAML = `
identity:
  name: Senior GTM Engineer
  role: Senior GTM Engineer
  background: Background.
target_archetypes:
  - gtm-engineering
meta_attitude: Skeptical.
friction_sensitivities:
  - navigation
`;

const REPORT_JSON = JSON.stringify({
  overall_verdict: "OK with caveats.",
  friction_events: [
    {
      severity: "medium",
      signal_type: "navigation",
      location: "/pipeline",
      description: "No back link.",
      what_persona_expected: "Quick return",
      what_actually_happened: "Stuck",
    },
  ],
});

describe("GET /api/qa-reports", () => {
  it("returns a 200 JSON snapshot when every qa/ subdir exists", async () => {
    const dirs = makeTempQaRoot();
    writeFileSync(join(dirs.personasDir, "senior-gtm-eng-nyc.yaml"), PERSONA_YAML);
    writeFileSync(
      join(dirs.reportsDir, "senior-gtm-eng-nyc-20260517T080000Z.json"),
      REPORT_JSON,
    );

    const res = buildResponse(dirs);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);

    const body = (await res.json()) as QaReportsData;
    expect(body.personas).toHaveLength(1);
    expect(body.personas[0].id).toBe("senior-gtm-eng-nyc");
    expect(body.latestReports).toHaveLength(1);
    expect(body.latestReports[0].frictionEvents).toHaveLength(1);
    expect(body.frictionPatterns).toEqual([]);  // only 1 persona — no cross-pattern
    expect(body.scenarios).toEqual([]);
    expect(body.replays).toEqual([]);
    expect(body.synthesis).toBeNull();
    expect(body.missingDirs).toEqual([]);
  });

  it("does not throw when every qa/ subdir is missing", async () => {
    const res = buildResponse({
      personasDir: "/no/personas",
      reportsDir: "/no/reports",
      scenariosResultsDir: "/no/scenarios",
      regressionsDir: "/no/regressions",
      synthesisDir: "/no/synthesis",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as QaReportsData;
    expect(body.personas).toEqual([]);
    expect(body.latestReports).toEqual([]);
    expect(body.frictionPatterns).toEqual([]);
    expect(body.scenarios).toEqual([]);
    expect(body.replays).toEqual([]);
    expect(body.synthesis).toBeNull();
    expect(body.missingDirs.length).toBeGreaterThanOrEqual(5);
  });
});
