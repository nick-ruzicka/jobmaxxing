import { mkdirSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { describe, expect, it } from "vitest";

import {
  PATTERN_PERSONA_MINIMUM,
  computeFrictionPatterns,
  loadLatestReports,
  loadLatestSynthesis,
  loadPersonas,
  loadQaReportsData,
  loadScenarioResults,
} from "./qa-reports";

function makeTempQaRoot(): {
  qa: string;
  personas: string;
  reports: string;
  scenariosResults: string;
  regressions: string;
  synthesis: string;
} {
  const root = mkdtempSync(join(tmpdir(), "qa-reports-test-"));
  const qa = join(root, "qa");
  const personas = join(qa, "personas");
  const reports = join(qa, "reports");
  const scenariosResults = join(qa, "scenarios-results");
  const regressions = join(qa, "regressions");
  const synthesis = join(qa, "synthesis");
  for (const d of [personas, reports, scenariosResults, regressions, synthesis]) {
    mkdirSync(d, { recursive: true });
  }
  return { qa, personas, reports, scenariosResults, regressions, synthesis };
}

const personaYaml = `
identity:
  name: Senior GTM Engineer
  role: Senior GTM Engineer
  background: Background text.
target_archetypes:
  - gtm-engineering
  - fde
meta_attitude: Skeptical, time-pressed.
friction_sensitivities:
  - navigation
  - scoring_opacity
`;

const reportJson = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
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
    ...overrides,
  });

// ─── loadPersonas ───────────────────────────────────────────────────────────

describe("loadPersonas", () => {
  it("parses yaml + finds the latest report file for each persona", () => {
    const { personas, reports } = makeTempQaRoot();
    writeFileSync(join(personas, "senior-gtm-eng-nyc.yaml"), personaYaml);
    writeFileSync(
      join(reports, "senior-gtm-eng-nyc-20260517T080000Z.json"),
      reportJson(),
    );
    writeFileSync(
      join(reports, "senior-gtm-eng-nyc-20260517T090000Z.json"),
      reportJson(),
    );

    const result = loadPersonas(personas, reports);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("senior-gtm-eng-nyc");
    expect(result[0].name).toBe("Senior GTM Engineer");
    expect(result[0].metaAttitude).toContain("Skeptical");
    expect(result[0].targetArchetypes).toEqual(["gtm-engineering", "fde"]);
    expect(result[0].latestReportFile).toBe("senior-gtm-eng-nyc-20260517T090000Z.json");
  });

  it("returns null latestReportFile when no report exists", () => {
    const { personas, reports } = makeTempQaRoot();
    writeFileSync(join(personas, "alpha.yaml"), personaYaml);
    expect(loadPersonas(personas, reports)[0].latestReportFile).toBeNull();
  });
});

// ─── loadLatestReports ──────────────────────────────────────────────────────

describe("loadLatestReports", () => {
  it("returns the newest .json per persona", () => {
    const { reports } = makeTempQaRoot();
    writeFileSync(join(reports, "alpha-20260101T000000Z.json"), reportJson());
    writeFileSync(join(reports, "alpha-20260517T080000Z.json"), reportJson({
      overall_verdict: "newer",
    }));
    writeFileSync(join(reports, "beta-20260517T080000Z.json"), reportJson({
      overall_verdict: "beta only",
    }));
    const out = loadLatestReports(reports);
    const byId = Object.fromEntries(out.map((r) => [r.personaId, r]));
    expect(byId["alpha"].overallVerdict).toBe("newer");
    expect(byId["beta"].overallVerdict).toBe("beta only");
  });

  it("skips malformed json silently", () => {
    const { reports } = makeTempQaRoot();
    writeFileSync(join(reports, "ok-20260517T080000Z.json"), reportJson());
    writeFileSync(join(reports, "bad-20260517T080000Z.json"), "{ not json");
    const out = loadLatestReports(reports);
    expect(out.map((r) => r.personaId)).toEqual(["ok"]);
  });

  it("returns [] when the reports dir doesn't exist", () => {
    expect(loadLatestReports("/no/such/dir")).toEqual([]);
  });
});

// ─── computeFrictionPatterns ────────────────────────────────────────────────

function makeReport(personaId: string, signalTypes: string[], severity = "medium") {
  return {
    personaId,
    reportPath: `/r/${personaId}.json`,
    generatedAtIso: "2026-05-17T08:00:00Z",
    overallVerdict: "",
    frictionEvents: signalTypes.map((st) => ({
      severity,
      signalType: st,
      location: `/x — ${st}`,
      description: `${personaId} hit ${st}.`,
      whatPersonaExpected: "",
      whatActuallyHappened: "",
    })),
  };
}

describe("computeFrictionPatterns", () => {
  it("surfaces patterns that meet the persona threshold", () => {
    const reports = [
      makeReport("a", ["navigation"]),
      makeReport("b", ["navigation"]),
      makeReport("c", ["navigation"]),
      makeReport("d", ["scoring_opacity"]),  // single persona, dropped
    ];
    const patterns = computeFrictionPatterns(reports, 3);
    expect(patterns).toHaveLength(1);
    expect(patterns[0].signalType).toBe("navigation");
    expect(patterns[0].personasAffected).toEqual(["a", "b", "c"]);
  });

  it("ranks patterns by persona count desc", () => {
    const reports = [
      makeReport("a", ["nav", "score"]),
      makeReport("b", ["nav", "score"]),
      makeReport("c", ["nav"]),
    ];
    const patterns = computeFrictionPatterns(reports, 2);
    expect(patterns.map((p) => p.signalType)).toEqual(["nav", "score"]);
  });

  it("tracks the highest severity across contributors", () => {
    const reports = [
      makeReport("a", ["navigation"], "low"),
      makeReport("b", ["navigation"], "high"),
    ];
    const [pattern] = computeFrictionPatterns(reports, 2);
    expect(pattern.topSeverity).toBe("high");
  });

  it("uses PATTERN_PERSONA_MINIMUM as the default minimum", () => {
    // Two contributors when default is three → no patterns surface.
    const reports = [
      makeReport("a", ["navigation"]),
      makeReport("b", ["navigation"]),
    ];
    expect(PATTERN_PERSONA_MINIMUM).toBe(3);
    expect(computeFrictionPatterns(reports)).toEqual([]);
  });
});

// ─── scenarios + replays + synthesis ────────────────────────────────────────

describe("loadScenarioResults / loadReplayResults", () => {
  it("loads markdown files sorted by name", () => {
    const { scenariosResults } = makeTempQaRoot();
    writeFileSync(join(scenariosResults, "z-result.md"), "# z");
    writeFileSync(join(scenariosResults, "a-result.md"), "# a");
    const out = loadScenarioResults(scenariosResults);
    expect(out.map((r) => r.filename)).toEqual(["a-result.md", "z-result.md"]);
    expect(out[0].markdown).toBe("# a");
  });
});

describe("loadLatestSynthesis", () => {
  it("returns the newest polish-spec-draft markdown", () => {
    const { synthesis } = makeTempQaRoot();
    writeFileSync(join(synthesis, "polish-spec-draft-20260101.md"), "# old");
    writeFileSync(join(synthesis, "polish-spec-draft-20260517.md"), "# new");
    // Other files in the dir are ignored.
    writeFileSync(join(synthesis, "notes.md"), "# scratch");
    const out = loadLatestSynthesis(synthesis);
    expect(out?.filename).toBe("polish-spec-draft-20260517.md");
    expect(out?.markdown).toBe("# new");
  });

  it("returns null when nothing matches", () => {
    const { synthesis } = makeTempQaRoot();
    expect(loadLatestSynthesis(synthesis)).toBeNull();
  });
});

// ─── loadQaReportsData top-level ────────────────────────────────────────────

describe("loadQaReportsData", () => {
  it("returns a complete picture across all qa subdirs", () => {
    const dirs = makeTempQaRoot();
    writeFileSync(join(dirs.personas, "alpha.yaml"), personaYaml);
    writeFileSync(join(dirs.personas, "beta.yaml"), personaYaml);
    writeFileSync(join(dirs.personas, "gamma.yaml"), personaYaml);
    // Three reports → enough for a single-pattern surfacing.
    for (const id of ["alpha", "beta", "gamma"]) {
      writeFileSync(join(dirs.reports, `${id}-20260517T080000Z.json`), reportJson());
    }
    writeFileSync(join(dirs.scenariosResults, "s1.md"), "# s1");
    writeFileSync(join(dirs.regressions, "r1.md"), "# r1");
    writeFileSync(join(dirs.synthesis, "polish-spec-draft-20260517.md"), "# synth");

    const data = loadQaReportsData({
      personasDir: dirs.personas,
      reportsDir: dirs.reports,
      scenariosResultsDir: dirs.scenariosResults,
      regressionsDir: dirs.regressions,
      synthesisDir: dirs.synthesis,
    });

    expect(data.personas).toHaveLength(3);
    expect(data.latestReports).toHaveLength(3);
    expect(data.frictionPatterns).toHaveLength(1);
    expect(data.frictionPatterns[0].signalType).toBe("navigation");
    expect(data.scenarios).toHaveLength(1);
    expect(data.replays).toHaveLength(1);
    expect(data.synthesis?.filename).toBe("polish-spec-draft-20260517.md");
    expect(data.missingDirs).toEqual([]);
  });

  it("reports missing dirs without throwing", () => {
    const data = loadQaReportsData({
      personasDir: "/no/personas",
      reportsDir: "/no/reports",
      scenariosResultsDir: "/no/scenarios",
      regressionsDir: "/no/regressions",
      synthesisDir: "/no/synthesis",
    });
    expect(data.personas).toEqual([]);
    expect(data.latestReports).toEqual([]);
    expect(data.scenarios).toEqual([]);
    expect(data.replays).toEqual([]);
    expect(data.synthesis).toBeNull();
    expect(data.missingDirs.length).toBeGreaterThan(0);
  });
});
