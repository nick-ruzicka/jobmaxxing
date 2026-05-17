"use client";

import { useMemo, useState } from "react";

import { Shell } from "@/components/Shell";
import { PageHeader } from "@/components/ui";
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

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "personas", label: "Personas" },
  { id: "latest-run", label: "Latest Run" },
  { id: "friction-patterns", label: "Friction Patterns" },
  { id: "scenarios", label: "Scenarios" },
  { id: "synthesis", label: "Synthesis" },
  { id: "replay", label: "Replay" },
];

// ─── Avatar emoji per persona — deterministic mapping by id stem ────────────
// Small extra-textual signal so the personas tab reads at a glance.
const PERSONA_AVATAR: Record<string, string> = {
  "senior-gtm-eng-nyc": "🛠️",
  "mid-revops-crossover": "🌱",
  "fde-from-palantir": "⚡",
  "web3-bd-exiting": "🔁",
  "ai-ops-lead-early-stage": "🧪",
  "ambivalent-explorer": "🧭",
};

function avatarFor(id: string): string {
  return PERSONA_AVATAR[id] ?? "👤";
}

export function QaReportsClient({
  data,
  activePursuing,
  highConviction,
  companyCount,
  signalCount,
  hasWarmLeads,
}: QaReportsClientProps) {
  const [tab, setTab] = useState<TabId>("personas");

  return (
    <Shell
      activePursuing={activePursuing}
      highConviction={highConviction}
      companyCount={companyCount}
      signalCount={signalCount}
      hasWarmLeads={hasWarmLeads}
    >
      <PageHeader
        title="QA Reports"
        subtitle="PersonaLab: multi-persona QA framework"
      />

      {data.missingDirs.length > 0 && (
        <div className="mb-4 rounded-md border border-amber/40 bg-amber/10 px-4 py-2 text-[12px] text-text-secondary">
          PersonaLab outputs not found yet. Run the orchestrator
          (<code className="font-mono">python personalab/core/orchestrator.py</code>)
          to populate this surface. Missing: {data.missingDirs.join(", ")}.
        </div>
      )}

      <nav
        className="mb-6 flex flex-wrap gap-1 border-b border-border-subtle"
        role="tablist"
      >
        {TABS.map((t) => {
          const active = t.id === tab;
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={active}
              onClick={() => setTab(t.id)}
              className={`-mb-px border-b-2 px-3 py-2 text-[13px] font-medium transition-colors ${
                active
                  ? "border-accent text-accent"
                  : "border-transparent text-text-tertiary hover:text-text-secondary"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </nav>

      {tab === "personas" && <PersonasTab personas={data.personas} />}
      {tab === "latest-run" && <LatestRunTab reports={data.latestReports} />}
      {tab === "friction-patterns" && (
        <FrictionPatternsTab patterns={data.frictionPatterns} />
      )}
      {tab === "scenarios" && <ScenariosTab scenarios={data.scenarios} />}
      {tab === "synthesis" && <SynthesisTab synthesis={data.synthesis} />}
      {tab === "replay" && <ReplayTab replays={data.replays} />}
    </Shell>
  );
}

// ─── Personas ───────────────────────────────────────────────────────────────

function PersonasTab({ personas }: { personas: PersonaSummary[] }) {
  if (personas.length === 0) {
    return <EmptyState text="No personas configured. Add YAML files to qa/personas/." />;
  }
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
      {personas.map((p) => (
        <article
          key={p.id}
          className="rounded-lg border border-border-subtle bg-surface-2 p-4"
        >
          <div className="mb-2 flex items-center gap-2">
            <span className="text-2xl" aria-hidden>
              {avatarFor(p.id)}
            </span>
            <div className="flex-1">
              <h3 className="text-[13px] font-semibold text-text-primary">
                {p.name}
              </h3>
              <div className="text-[11px] text-text-muted">{p.role}</div>
            </div>
          </div>
          <p className="mb-3 text-[12px] italic text-text-secondary">
            “{p.metaAttitude}”
          </p>
          <div className="mb-2 flex flex-wrap gap-1">
            {p.targetArchetypes.map((a) => (
              <span
                key={a}
                className="rounded-full bg-surface-3 px-2 py-[2px] text-[10px] text-text-tertiary"
              >
                {a}
              </span>
            ))}
            {p.targetArchetypes.length === 0 && (
              <span className="text-[10px] text-text-muted">open to all</span>
            )}
          </div>
          <div className="text-[11px] text-text-muted">
            {p.latestReportFile ? (
              <>
                Latest report:{" "}
                <code className="font-mono">{p.latestReportFile}</code>
              </>
            ) : (
              <span className="italic">no report yet</span>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}

// ─── Latest Run ─────────────────────────────────────────────────────────────

const SEVERITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

function LatestRunTab({ reports }: { reports: PersonaReportView[] }) {
  // Flatten every persona's friction events, sort by severity desc.
  const events = useMemo(() => {
    const out: Array<{ persona: string; ev: PersonaReportView["frictionEvents"][number] }> = [];
    for (const r of reports) {
      for (const ev of r.frictionEvents) {
        out.push({ persona: r.personaId, ev });
      }
    }
    return out.sort(
      (a, b) =>
        (SEVERITY_RANK[a.ev.severity.toLowerCase()] ?? 9) -
        (SEVERITY_RANK[b.ev.severity.toLowerCase()] ?? 9),
    );
  }, [reports]);

  if (events.length === 0) {
    return <EmptyState text="No friction events yet. Run the analyzer." />;
  }
  return (
    <div className="space-y-3">
      {events.map(({ persona, ev }, i) => (
        <article
          key={`${persona}-${i}`}
          className="rounded-lg border border-border-subtle bg-surface-2 p-4"
        >
          <div className="mb-2 flex items-center gap-2">
            <SeverityBadge severity={ev.severity} />
            <span className="text-[11px] text-text-tertiary">{ev.signalType}</span>
            <span className="text-[11px] text-text-muted">·</span>
            <span className="text-[11px] text-text-muted">{persona}</span>
            <span className="ml-auto text-[11px] font-mono text-text-muted">
              {ev.location}
            </span>
          </div>
          <p className="mb-2 text-[13px] text-text-primary">{ev.description}</p>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            <div className="text-[12px] text-text-secondary">
              <span className="font-semibold">Expected:</span>{" "}
              {ev.whatPersonaExpected}
            </div>
            <div className="text-[12px] text-text-secondary">
              <span className="font-semibold">Actually:</span>{" "}
              {ev.whatActuallyHappened}
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  const sev = severity.toLowerCase();
  const color =
    sev === "high"
      ? "border-red/40 bg-red/10 text-red"
      : sev === "medium"
      ? "border-amber/40 bg-amber/10 text-amber"
      : "border-border-subtle bg-surface-3 text-text-tertiary";
  return (
    <span className={`rounded-full border px-2 py-[1px] text-[10px] uppercase ${color}`}>
      {severity}
    </span>
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
      <EmptyState text="No cross-persona patterns surfaced (a pattern needs 3+ personas to flag)." />
    );
  }
  return (
    <div className="space-y-3">
      {patterns.map((p) => (
        <article
          key={p.signalType}
          className="rounded-lg border border-border-subtle bg-surface-2 p-4"
        >
          <div className="mb-2 flex items-center gap-2">
            <SeverityBadge severity={p.topSeverity} />
            <h3 className="text-[14px] font-semibold text-text-primary">
              {p.signalType}
            </h3>
            <span className="ml-auto rounded-full bg-surface-3 px-2 py-[2px] text-[10px] text-text-tertiary">
              {p.personasAffected.length} personas
            </span>
          </div>
          <p className="mb-2 text-[13px] text-text-primary">{p.description}</p>
          <div className="mb-1 font-mono text-[11px] text-text-muted">
            {p.location}
          </div>
          <div className="text-[11px] text-text-tertiary">
            Affecting: {p.personasAffected.join(", ")}
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
      <EmptyState text="No scenario diffs yet. Run the scenario runner against a scenario YAML." />
    );
  }
  return (
    <div className="space-y-3">
      {scenarios.map((s) => (
        <article
          key={s.filename}
          className="rounded-lg border border-border-subtle bg-surface-2 p-4"
        >
          <header className="mb-2 flex items-center justify-between gap-2 text-[11px]">
            <code className="font-mono text-text-primary">{s.filename}</code>
            <time className="text-text-muted">{s.modifiedAtIso}</time>
          </header>
          <pre className="overflow-x-auto whitespace-pre-wrap text-[12px] leading-relaxed text-text-secondary">
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
      <EmptyState text="No polish spec generated yet. Run the synthesizer after at least one analyzer pass." />
    );
  }
  return (
    <article className="rounded-lg border border-border-subtle bg-surface-2 p-4">
      <header className="mb-3 flex items-center justify-between gap-2 text-[11px]">
        <code className="font-mono text-text-primary">{synthesis.filename}</code>
        <time className="text-text-muted">{synthesis.modifiedAtIso}</time>
      </header>
      <pre className="overflow-x-auto whitespace-pre-wrap text-[12px] leading-relaxed text-text-secondary">
        {synthesis.markdown}
      </pre>
    </article>
  );
}

// ─── Replay ─────────────────────────────────────────────────────────────────

function ReplayTab({ replays }: { replays: QaReportsData["replays"] }) {
  if (replays.length === 0) {
    return (
      <EmptyState text="No replay reports yet. Run the replayer against a captured session." />
    );
  }
  return (
    <div className="space-y-3">
      {replays.map((r) => (
        <article
          key={r.filename}
          className="rounded-lg border border-border-subtle bg-surface-2 p-4"
        >
          <header className="mb-2 flex items-center justify-between gap-2 text-[11px]">
            <code className="font-mono text-text-primary">{r.filename}</code>
            <time className="text-text-muted">{r.modifiedAtIso}</time>
          </header>
          <pre className="overflow-x-auto whitespace-pre-wrap text-[12px] leading-relaxed text-text-secondary">
            {r.markdown}
          </pre>
        </article>
      ))}
    </div>
  );
}

// ─── Shared empty state ─────────────────────────────────────────────────────

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border-subtle bg-surface-2 p-8 text-center text-[13px] text-text-muted">
      {text}
    </div>
  );
}
