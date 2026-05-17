// PersonaLab dashboard data loader.
//
// Reads what PersonaLab writes to disk under qa/ (or wherever the test
// fixtures live). All file paths are explicit so the unit tests can
// inject a temp directory.
//
// Everything here is server-side (Next.js server component territory) —
// no React, no `use client`.

import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

import yaml from "js-yaml";

export interface PersonaSummary {
  /** filename stem, e.g. "senior-gtm-eng-nyc" */
  id: string;
  name: string;
  role: string;
  metaAttitude: string;
  targetArchetypes: string[];
  frictionSensitivities: string[];
  /** filename of the most-recent JSON friction report for this persona,
   *  or null if no report exists yet. */
  latestReportFile: string | null;
}

export interface FrictionEventView {
  severity: string;
  signalType: string;
  location: string;
  description: string;
  whatPersonaExpected: string;
  whatActuallyHappened: string;
}

export interface PersonaReportView {
  personaId: string;
  reportPath: string;
  generatedAtIso: string;
  overallVerdict: string;
  frictionEvents: FrictionEventView[];
}

export interface FrictionPatternView {
  /** signal_type from the analyzer, e.g. "scoring_opacity" */
  signalType: string;
  /** raw shared description (we just take the first persona's wording) */
  description: string;
  /** route or surface, taken from the first contributing report */
  location: string;
  /** how many personas surfaced this pattern */
  personasAffected: string[];
  /** highest severity observed across contributors */
  topSeverity: string;
}

export interface ScenarioResultView {
  filename: string;
  modifiedAtIso: string;
  /** raw markdown content for the tab to render */
  markdown: string;
}

export interface ReplayResultView {
  filename: string;
  modifiedAtIso: string;
  /** raw markdown content for the tab to render */
  markdown: string;
}

export interface SynthesisView {
  filename: string;
  modifiedAtIso: string;
  markdown: string;
}

export interface QaReportsData {
  personas: PersonaSummary[];
  latestReports: PersonaReportView[];
  frictionPatterns: FrictionPatternView[];
  scenarios: ScenarioResultView[];
  replays: ReplayResultView[];
  synthesis: SynthesisView | null;
  /** any qa/ dir paths that didn't exist — surfaced as a soft warning
   *  in the UI so the user knows the orchestrator hasn't run yet. */
  missingDirs: string[];
}

/** How many personas must surface a pattern for it to count as cross-persona. */
export const PATTERN_PERSONA_MINIMUM = 3;

// ─── Filesystem helpers ─────────────────────────────────────────────────────

function safeReadJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

function safeReadFile(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function safeMtime(path: string): string {
  try {
    return statSync(path).mtime.toISOString();
  } catch {
    return new Date(0).toISOString();
  }
}

function listSorted(dir: string, predicate: (name: string) => boolean): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(predicate).sort();
}

/** Strip the trailing `-<YYYYMMDDTHHMMSSZ>` slug if present. */
function personaIdFromReportStem(stem: string): string {
  // matches a timestamp tail like -20260517T084200Z
  return stem.replace(/-\d{8}T\d{6}Z$/, "");
}

// ─── Personas ───────────────────────────────────────────────────────────────

interface RawPersonaYaml {
  identity?: { name?: string; role?: string };
  target_archetypes?: string[];
  meta_attitude?: string;
  friction_sensitivities?: string[];
}

export function loadPersonas(personasDir: string, reportsDir: string): PersonaSummary[] {
  const files = listSorted(personasDir, (n) => n.endsWith(".yaml"));
  return files.map((file) => {
    const id = file.replace(/\.yaml$/, "");
    const raw = safeReadFile(join(personasDir, file)) ?? "";
    const parsed = yaml.load(raw) as RawPersonaYaml;
    return {
      id,
      name: parsed?.identity?.name ?? id,
      role: parsed?.identity?.role ?? "",
      metaAttitude: parsed?.meta_attitude ?? "",
      targetArchetypes: parsed?.target_archetypes ?? [],
      frictionSensitivities: parsed?.friction_sensitivities ?? [],
      latestReportFile: latestReportFileFor(id, reportsDir),
    };
  });
}

function latestReportFileFor(personaId: string, reportsDir: string): string | null {
  if (!existsSync(reportsDir)) return null;
  let bestFile: string | null = null;
  let bestMtime = -1;
  for (const name of readdirSync(reportsDir)) {
    if (!name.endsWith(".json")) continue;
    const stem = name.replace(/\.json$/, "");
    if (personaIdFromReportStem(stem) !== personaId) continue;
    const m = statSync(join(reportsDir, name)).mtimeMs;
    if (m > bestMtime) {
      bestMtime = m;
      bestFile = name;
    }
  }
  return bestFile;
}

// ─── Latest reports (one per persona) ───────────────────────────────────────

interface RawReportJson {
  overall_verdict?: string;
  friction_events?: Array<{
    severity?: string;
    signal_type?: string;
    location?: string;
    description?: string;
    what_persona_expected?: string;
    what_actually_happened?: string;
  }>;
}

export function loadLatestReports(reportsDir: string): PersonaReportView[] {
  if (!existsSync(reportsDir)) return [];
  // newest-per-persona discovery
  const byPersona: Record<string, { mtime: number; path: string }> = {};
  for (const name of readdirSync(reportsDir)) {
    if (!name.endsWith(".json")) continue;
    const stem = name.replace(/\.json$/, "");
    const personaId = personaIdFromReportStem(stem);
    const path = join(reportsDir, name);
    const m = statSync(path).mtimeMs;
    if (!byPersona[personaId] || byPersona[personaId].mtime < m) {
      byPersona[personaId] = { mtime: m, path };
    }
  }
  const out: PersonaReportView[] = [];
  for (const [personaId, { path }] of Object.entries(byPersona).sort()) {
    const raw = safeReadJson<RawReportJson>(path);
    if (!raw) continue;
    out.push({
      personaId,
      reportPath: path,
      generatedAtIso: safeMtime(path),
      overallVerdict: raw.overall_verdict ?? "",
      frictionEvents: (raw.friction_events ?? []).map((ev) => ({
        severity: ev.severity ?? "unknown",
        signalType: ev.signal_type ?? "unknown",
        location: ev.location ?? "",
        description: ev.description ?? "",
        whatPersonaExpected: ev.what_persona_expected ?? "",
        whatActuallyHappened: ev.what_actually_happened ?? "",
      })),
    });
  }
  return out;
}

// ─── Friction patterns (cross-persona, ≥ N personas) ────────────────────────

export function computeFrictionPatterns(
  reports: PersonaReportView[],
  minPersonas: number = PATTERN_PERSONA_MINIMUM,
): FrictionPatternView[] {
  // Group by signal_type — that's the deduplication key. Multiple
  // descriptions for the same signal_type collapse to the first one
  // (the analyzer's output is already deduped within a persona's report).
  const bySignal: Record<string, {
    personas: Set<string>;
    description: string;
    location: string;
    topSeverity: string;
  }> = {};

  const sevRank = (s: string): number => ({ high: 0, medium: 1, low: 2 }[s.toLowerCase()] ?? 3);

  for (const report of reports) {
    for (const ev of report.frictionEvents) {
      const key = ev.signalType;
      if (!bySignal[key]) {
        bySignal[key] = {
          personas: new Set(),
          description: ev.description,
          location: ev.location,
          topSeverity: ev.severity,
        };
      }
      const slot = bySignal[key];
      slot.personas.add(report.personaId);
      if (sevRank(ev.severity) < sevRank(slot.topSeverity)) {
        slot.topSeverity = ev.severity;
      }
    }
  }

  const patterns: FrictionPatternView[] = [];
  for (const [signalType, slot] of Object.entries(bySignal)) {
    if (slot.personas.size < minPersonas) continue;
    patterns.push({
      signalType,
      description: slot.description,
      location: slot.location,
      personasAffected: [...slot.personas].sort(),
      topSeverity: slot.topSeverity,
    });
  }
  return patterns.sort(
    (a, b) => b.personasAffected.length - a.personasAffected.length,
  );
}

// ─── Scenarios + replays + synthesis ────────────────────────────────────────

export function loadScenarioResults(dir: string): ScenarioResultView[] {
  return listSorted(dir, (n) => n.endsWith(".md")).map((name) => ({
    filename: name,
    modifiedAtIso: safeMtime(join(dir, name)),
    markdown: safeReadFile(join(dir, name)) ?? "",
  }));
}

export function loadReplayResults(dir: string): ReplayResultView[] {
  return listSorted(dir, (n) => n.endsWith(".md")).map((name) => ({
    filename: name,
    modifiedAtIso: safeMtime(join(dir, name)),
    markdown: safeReadFile(join(dir, name)) ?? "",
  }));
}

export function loadLatestSynthesis(dir: string): SynthesisView | null {
  if (!existsSync(dir)) return null;
  const candidates = readdirSync(dir)
    .filter((n) => n.startsWith("polish-spec-draft-") && n.endsWith(".md"))
    .map((n) => ({ name: n, mtime: statSync(join(dir, n)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  if (candidates.length === 0) return null;
  const { name } = candidates[0];
  return {
    filename: name,
    modifiedAtIso: safeMtime(join(dir, name)),
    markdown: safeReadFile(join(dir, name)) ?? "",
  };
}

// ─── Top-level loader ───────────────────────────────────────────────────────

export interface QaPaths {
  personasDir: string;
  reportsDir: string;
  scenariosResultsDir: string;
  regressionsDir: string;
  synthesisDir: string;
}

export function loadQaReportsData(paths: QaPaths): QaReportsData {
  const missingDirs: string[] = [];
  for (const [label, p] of Object.entries(paths)) {
    if (!existsSync(p)) missingDirs.push(`${label}: ${p}`);
  }

  const reports = loadLatestReports(paths.reportsDir);
  return {
    personas: loadPersonas(paths.personasDir, paths.reportsDir),
    latestReports: reports,
    frictionPatterns: computeFrictionPatterns(reports),
    scenarios: loadScenarioResults(paths.scenariosResultsDir),
    replays: loadReplayResults(paths.regressionsDir),
    synthesis: loadLatestSynthesis(paths.synthesisDir),
    missingDirs,
  };
}

// Default QA paths resolution — dashboard-web's cwd is the dashboard-web
// directory at runtime, so the project root is one up.
export function defaultQaPaths(repoRoot: string): QaPaths {
  const qa = join(repoRoot, "qa");
  return {
    personasDir: join(qa, "personas"),
    reportsDir: join(qa, "reports"),
    scenariosResultsDir: join(qa, "scenarios-results"),
    regressionsDir: join(qa, "regressions"),
    synthesisDir: join(qa, "synthesis"),
  };
}
