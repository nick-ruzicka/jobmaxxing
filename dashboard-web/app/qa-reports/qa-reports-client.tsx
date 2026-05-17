"use client";

// /qa-reports — PersonaLab surface, design-system-conformant.
//
// Layout matches /context: PageHeader + a horizontal tab strip + a single
// content card per tab. Every visual primitive comes from components/ui/
// (no bespoke badge / empty state / inline-color escape hatches), and
// every color is a @theme token via the Badge primitive's color prop.

import { useMemo, useState } from "react";
import {
  Beaker,
  Users,
  Activity,
  Gauge,
  GitCompare,
  FileText,
  History,
  type LucideIcon,
} from "lucide-react";

import { Shell } from "@/components/Shell";
import {
  Badge,
  type BadgeColor,
  EmptyState,
  PageHeader,
  SectionLabel,
} from "@/components/ui";
import type {
  QaReportsData,
  PersonaSummary,
  PersonaReportView,
} from "@/lib/qa-reports";

interface QaReportsClientProps {
  data: QaReportsData;
  activePursuing: number;
  highConviction: number;
  companyCount: number;
  signalCount: number;
  hasWarmLeads: boolean;
}

type TabId =
  | "personas"
  | "latest-run"
  | "friction-patterns"
  | "scenarios"
  | "synthesis"
  | "replay";

const TABS: Array<{ id: TabId; label: string; icon: LucideIcon }> = [
  { id: "personas", label: "Personas", icon: Users },
  { id: "latest-run", label: "Latest Run", icon: Activity },
  { id: "friction-patterns", label: "Friction Patterns", icon: Gauge },
  { id: "scenarios", label: "Scenarios", icon: GitCompare },
  { id: "synthesis", label: "Synthesis", icon: FileText },
  { id: "replay", label: "Replay", icon: History },
];

export function QaReportsClient({
  data,
  activePursuing,
  highConviction,
  companyCount,
  signalCount,
  hasWarmLeads,
}: QaReportsClientProps) {
  const [tab, setTab] = useState<TabId>("personas");

  // Tab badges — small affordance so the user sees coverage at a glance.
  const counts: Partial<Record<TabId, number>> = {
    personas: data.personas.length,
    "latest-run": data.latestReports.length,
    "friction-patterns": data.frictionPatterns.length,
    scenarios: data.scenarios.length,
    replay: data.replays.length,
  };

  return (
    <Shell
      activePursuing={activePursuing}
      highConviction={highConviction}
      companyCount={companyCount}
      signalCount={signalCount}
      hasWarmLeads={hasWarmLeads}
    >
      <div className="space-y-6">
        <PageHeader
          title="QA Reports"
          subtitle="PersonaLab — multi-persona dashboard QA"
          icon={<Beaker size={18} className="text-text-tertiary" />}
        />

        {data.missingDirs.length > 0 && <MissingDirsNotice missing={data.missingDirs} />}

        {/* Tab strip — same pattern as /context. */}
        <div className="flex flex-wrap gap-2">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = t.id === tab;
            const badge = counts[t.id];
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                aria-selected={active}
                role="tab"
                className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-[13px] font-medium transition-colors ${
                  active
                    ? "border-accent bg-accent-dim text-accent"
                    : "border-border-subtle bg-surface-1 text-text-tertiary hover:bg-surface-3 hover:text-text-secondary"
                }`}
              >
                <Icon size={14} />
                {t.label}
                {badge !== undefined && badge > 0 && (
                  <Badge color={active ? "accent" : "neutral"} className="ml-1">
                    {badge}
                  </Badge>
                )}
              </button>
            );
          })}
        </div>

        {/* Section body */}
        <div className="rounded-lg border border-border-subtle bg-surface-1 p-6">
          {tab === "personas" && (
            <PersonasTab personas={data.personas} reports={data.latestReports} />
          )}
          {tab === "latest-run" && <LatestRunTab reports={data.latestReports} />}
          {tab === "friction-patterns" && (
            <FrictionPatternsTab patterns={data.frictionPatterns} />
          )}
          {tab === "scenarios" && <ScenariosTab scenarios={data.scenarios} />}
          {tab === "synthesis" && <SynthesisTab synthesis={data.synthesis} />}
          {tab === "replay" && <ReplayTab replays={data.replays} />}
        </div>
      </div>
    </Shell>
  );
}

// ─── Missing-dirs notice ────────────────────────────────────────────────────

function MissingDirsNotice({ missing }: { missing: string[] }) {
  // Compact, single-line warning. Token classes only — no raw color/value.
  return (
    <div className="flex items-start gap-2 rounded-md border border-amber-border bg-amber-dim px-3 py-2 text-[12px] text-text-secondary">
      <Badge color="amber" className="shrink-0">setup</Badge>
      <div className="flex-1">
        <strong className="text-text-primary">PersonaLab outputs not found yet.</strong>{" "}
        Run the orchestrator (
        <code className="font-mono text-[11px] text-text-primary">
          python -m personalab.core.orchestrator --app qa/app.yaml
        </code>
        ) to populate this surface.
        <div className="mt-1 text-[11px] text-text-muted">
          Missing: {missing.map((m) => m.split(": ")[0]).join(", ")}
        </div>
      </div>
    </div>
  );
}

// ─── Severity → Badge color ─────────────────────────────────────────────────

function severityColor(severity: string): BadgeColor {
  const s = severity.toLowerCase();
  if (s === "high") return "red";
  if (s === "medium") return "amber";
  if (s === "low") return "blue";
  return "neutral";
}

function SeverityBadge({ severity }: { severity: string }) {
  return (
    <Badge color={severityColor(severity)}>
      {severity.toUpperCase()}
    </Badge>
  );
}

// ─── Personas ───────────────────────────────────────────────────────────────

function PersonasTab({
  personas,
  reports,
}: {
  personas: PersonaSummary[];
  reports: PersonaReportView[];
}) {
  // Per-persona summary stats from the latest reports.
  const summaryByPersona = useMemo(() => {
    const out: Record<string, { friction: number; high: number }> = {};
    for (const r of reports) {
      const events = r.frictionEvents;
      out[r.personaId] = {
        friction: events.length,
        high: events.filter((e) => e.severity.toLowerCase() === "high").length,
      };
    }
    return out;
  }, [reports]);

  if (personas.length === 0) {
    return (
      <EmptyState
        icon={<Users size={28} />}
        title="No personas configured"
        description="Add persona YAML files under qa/personas/."
      />
    );
  }

  return (
    <div className="space-y-4">
      <SectionLabel>{personas.length} personas — primed by the orchestrator</SectionLabel>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        {personas.map((p) => {
          const summary = summaryByPersona[p.id];
          return (
            <article
              key={p.id}
              className="rounded-lg border border-border-subtle bg-surface-2 p-4"
            >
              <div className="mb-2 flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-[14px] font-semibold text-text-primary">
                    {p.name}
                  </h3>
                  <div className="truncate text-[11px] text-text-muted">{p.role}</div>
                </div>
                {summary ? (
                  <Badge color={summary.high > 0 ? "red" : "neutral"}>
                    {summary.friction}
                  </Badge>
                ) : (
                  <Badge color="neutral">—</Badge>
                )}
              </div>

              <p className="mb-3 text-[12px] text-text-secondary">
                {p.metaAttitude || <span className="italic text-text-muted">no attitude set</span>}
              </p>

              <div className="mb-3 flex flex-wrap gap-1">
                {p.targetArchetypes.length > 0 ? (
                  p.targetArchetypes.map((a) => (
                    <Badge key={a} color="neutral">
                      {a}
                    </Badge>
                  ))
                ) : (
                  <span className="text-[11px] italic text-text-muted">open to all</span>
                )}
              </div>

              <div className="text-[11px] text-text-muted">
                {summary ? (
                  <span className="tabular-nums">
                    {summary.friction} friction · {summary.high} high
                  </span>
                ) : p.latestReportFile ? (
                  <span className="italic">report present, not loaded</span>
                ) : (
                  <span className="italic">no report yet</span>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

// ─── Latest Run ─────────────────────────────────────────────────────────────

const SEVERITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

function LatestRunTab({ reports }: { reports: PersonaReportView[] }) {
  // Group friction events by persona, sort severity desc inside each group.
  const grouped = useMemo(() => {
    return reports
      .map((r) => ({
        personaId: r.personaId,
        overallVerdict: r.overallVerdict,
        events: [...r.frictionEvents].sort(
          (a, b) =>
            (SEVERITY_RANK[a.severity.toLowerCase()] ?? 9) -
            (SEVERITY_RANK[b.severity.toLowerCase()] ?? 9),
        ),
      }))
      .sort((a, b) => {
        // Heaviest reports first
        const aHigh = a.events.filter((e) => e.severity.toLowerCase() === "high").length;
        const bHigh = b.events.filter((e) => e.severity.toLowerCase() === "high").length;
        if (aHigh !== bHigh) return bHigh - aHigh;
        return b.events.length - a.events.length;
      });
  }, [reports]);

  if (grouped.length === 0) {
    return (
      <EmptyState
        icon={<Activity size={28} />}
        title="No PersonaLab runs yet"
        description={
          <>
            Run{" "}
            <code className="font-mono text-text-primary">
              python -m personalab.core.orchestrator --app qa/app.yaml
            </code>{" "}
            to capture your first session.
          </>
        }
      />
    );
  }

  return (
    <div className="space-y-6">
      {grouped.map((g) => (
        <section key={g.personaId} className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <SectionLabel>{g.personaId}</SectionLabel>
            <span className="text-[11px] tabular-nums text-text-muted">
              {g.events.length} {g.events.length === 1 ? "event" : "events"}
            </span>
          </div>
          {g.overallVerdict && (
            <p className="text-[12px] italic text-text-secondary">{g.overallVerdict}</p>
          )}
          {g.events.length === 0 ? (
            <p className="text-[12px] text-text-muted">No friction in this run.</p>
          ) : (
            <div className="space-y-3">
              {g.events.map((ev, i) => (
                <article
                  key={`${g.personaId}-${i}`}
                  className="rounded-lg border border-border-subtle bg-surface-2 p-4"
                >
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <SeverityBadge severity={ev.severity} />
                    <Badge color="neutral">{ev.signalType}</Badge>
                    <span className="ml-auto font-mono text-[11px] text-text-muted">
                      {ev.location}
                    </span>
                  </div>
                  <p className="mb-2 text-[13px] text-text-primary">{ev.description}</p>
                  <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                    <div className="text-[12px] text-text-secondary">
                      <span className="font-semibold text-text-primary">Expected:</span>{" "}
                      {ev.whatPersonaExpected}
                    </div>
                    <div className="text-[12px] text-text-secondary">
                      <span className="font-semibold text-text-primary">Actually:</span>{" "}
                      {ev.whatActuallyHappened}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

// ─── Friction Patterns ──────────────────────────────────────────────────────

function FrictionPatternsTab({
  patterns,
}: {
  patterns: QaReportsData["frictionPatterns"];
}) {
  if (patterns.length === 0) {
    return (
      <EmptyState
        icon={<Gauge size={28} />}
        title="No cross-persona patterns surfaced"
        description="A pattern needs to hit 3+ personas before it lands here. Run the analyzer on more personas."
      />
    );
  }
  return (
    <div className="space-y-3">
      {patterns.map((p) => (
        <article
          key={p.signalType}
          className="rounded-lg border border-border-subtle bg-surface-2 p-4"
        >
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <SeverityBadge severity={p.topSeverity} />
            <h3 className="text-[14px] font-semibold text-text-primary">{p.signalType}</h3>
            <Badge color="neutral" className="ml-auto">
              {p.personasAffected.length} personas
            </Badge>
          </div>
          {p.description && (
            <p className="mb-2 text-[13px] text-text-primary">{p.description}</p>
          )}
          {p.location && (
            <div className="mb-2 font-mono text-[11px] text-text-muted">{p.location}</div>
          )}
          <div className="flex flex-wrap gap-1">
            {p.personasAffected.map((id) => (
              <Badge key={id} color="neutral">
                {id}
              </Badge>
            ))}
          </div>
        </article>
      ))}
    </div>
  );
}

// ─── Scenarios ──────────────────────────────────────────────────────────────

function ScenariosTab({
  scenarios,
}: {
  scenarios: QaReportsData["scenarios"];
}) {
  if (scenarios.length === 0) {
    return (
      <EmptyState
        icon={<GitCompare size={28} />}
        title="No scenario diffs yet"
        description={
          <>
            Run{" "}
            <code className="font-mono text-text-primary">
              python -m personalab.core.scenario_runner &lt;scenario&gt;
            </code>{" "}
            against any scenario in <code className="font-mono text-text-primary">qa/scenarios/</code>.
          </>
        }
      />
    );
  }
  return (
    <div className="space-y-3">
      {scenarios.map((s) => (
        <article
          key={s.filename}
          className="rounded-lg border border-border-subtle bg-surface-2 p-4"
        >
          <header className="mb-2 flex items-center justify-between gap-2">
            <code className="font-mono text-[12px] text-text-primary">{s.filename}</code>
            <time className="text-[11px] tabular-nums text-text-muted">{s.modifiedAtIso}</time>
          </header>
          <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-[12px] leading-relaxed text-text-secondary">
            {s.markdown}
          </pre>
        </article>
      ))}
    </div>
  );
}

// ─── Synthesis ──────────────────────────────────────────────────────────────

function SynthesisTab({
  synthesis,
}: {
  synthesis: QaReportsData["synthesis"];
}) {
  if (!synthesis) {
    return (
      <EmptyState
        icon={<FileText size={28} />}
        title="No polish spec generated yet"
        description={
          <>
            Run{" "}
            <code className="font-mono text-text-primary">
              python -m personalab.core.synthesizer
            </code>{" "}
            after at least one analyzer pass across multiple personas.
          </>
        }
      />
    );
  }
  return (
    <article className="rounded-lg border border-border-subtle bg-surface-2 p-4">
      <header className="mb-3 flex items-center justify-between gap-2">
        <code className="font-mono text-[12px] text-text-primary">{synthesis.filename}</code>
        <time className="text-[11px] tabular-nums text-text-muted">{synthesis.modifiedAtIso}</time>
      </header>
      <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-[12px] leading-relaxed text-text-secondary">
        {synthesis.markdown}
      </pre>
    </article>
  );
}

// ─── Replay ─────────────────────────────────────────────────────────────────

function ReplayTab({ replays }: { replays: QaReportsData["replays"] }) {
  if (replays.length === 0) {
    return (
      <EmptyState
        icon={<History size={28} />}
        title="No replay reports yet"
        description={
          <>
            Run{" "}
            <code className="font-mono text-text-primary">
              python -m personalab.core.replayer &lt;session.jsonl&gt;
            </code>{" "}
            against a captured session to compare against the current app.
          </>
        }
      />
    );
  }
  return (
    <div className="space-y-3">
      {replays.map((r) => (
        <article
          key={r.filename}
          className="rounded-lg border border-border-subtle bg-surface-2 p-4"
        >
          <header className="mb-2 flex items-center justify-between gap-2">
            <code className="font-mono text-[12px] text-text-primary">{r.filename}</code>
            <time className="text-[11px] tabular-nums text-text-muted">{r.modifiedAtIso}</time>
          </header>
          <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-[12px] leading-relaxed text-text-secondary">
            {r.markdown}
          </pre>
        </article>
      ))}
    </div>
  );
}
