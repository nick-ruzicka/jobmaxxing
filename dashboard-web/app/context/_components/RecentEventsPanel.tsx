"use client";

import { SectionLabel, EmptyState, Badge } from "@/components/ui";

interface EventRow {
  id?: string;
  timestamp?: string;
  type?: string;
  source?: string;
  role_id?: string;
  archetype?: string;
  payload?: Record<string, unknown>;
}

export function RecentEventsPanel({ events }: { events: Array<Record<string, unknown>> }) {
  if (!events || events.length === 0) {
    return (
      <EmptyState
        icon={<span className="text-2xl">∅</span>}
        title="No recent events"
        description="Events will appear here as you interact with the pipeline (view, pin, dismiss, override scores)."
      />
    );
  }
  const rows = events as EventRow[];

  // Aggregate by type for the header
  const counts: Record<string, number> = {};
  for (const e of rows) {
    if (e.type) counts[e.type] = (counts[e.type] || 0) + 1;
  }
  const topTypes = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);

  return (
    <div className="space-y-4">
      <p className="text-[12px] text-text-tertiary">
        Latest {rows.length} events from{" "}
        <code className="text-text-secondary">data/career-ops-events/</code>. These feed the
        meta-scorer (G7) and surface the feedback loop in the dashboard.
      </p>

      <div>
        <SectionLabel className="mb-2">Type distribution (this window)</SectionLabel>
        <div className="flex flex-wrap gap-2">
          {topTypes.map(([t, c]) => (
            <span
              key={t}
              className="inline-flex items-center gap-2 rounded-lg border border-border-subtle bg-surface-2 px-3 py-1.5 text-[12px] text-text-secondary"
            >
              <code className="text-text-tertiary">{t}</code>
              <Badge>{c}</Badge>
            </span>
          ))}
        </div>
      </div>

      <div>
        <SectionLabel className="mb-2">Most recent</SectionLabel>
        <div className="overflow-hidden rounded-lg border border-border-subtle">
          <table className="w-full text-[12px]">
            <thead className="bg-surface-3 text-[11px] uppercase text-text-tertiary">
              <tr>
                <th className="px-3 py-2 text-left">Time</th>
                <th className="px-3 py-2 text-left">Type</th>
                <th className="px-3 py-2 text-left">Source</th>
                <th className="px-3 py-2 text-left">Context</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 100).map((e, i) => (
                <tr key={(e.id as string) ?? i} className="border-t border-border-subtle">
                  <td className="px-3 py-2 text-text-tertiary">
                    {e.timestamp ? new Date(e.timestamp).toLocaleString() : "—"}
                  </td>
                  <td className="px-3 py-2 font-mono text-text-secondary">{e.type}</td>
                  <td className="px-3 py-2 text-text-tertiary">{e.source}</td>
                  <td className="px-3 py-2 text-text-tertiary">
                    {e.archetype && <span className="mr-2">{e.archetype}</span>}
                    {e.role_id && (
                      <span className="line-clamp-1 text-[11px]">{(e.role_id as string).slice(0, 80)}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
