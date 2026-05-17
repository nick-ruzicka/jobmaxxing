"use client";

import { ExternalLink } from "lucide-react";
import { Badge, SectionLabel, EmptyState } from "@/components/ui";

interface ReviewRow {
  url: string;
  title: string;
  company: string;
  primary: string | null;
  confidence: number;
  secondary: string[];
  reasoning: string;
}

interface Archetype {
  id: string;
  name: string;
}

export function ReviewQueuePanel({
  rows,
  archetypes,
}: {
  rows: ReviewRow[];
  archetypes: Archetype[];
}) {
  const nameById = new Map(archetypes.map((a) => [a.id, a.name]));

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<span className="text-2xl">✓</span>}
        title="Review queue empty"
        description="No roles currently flagged as low-confidence classifications."
      />
    );
  }

  // Show top 50 lowest-confidence rows
  const visible = rows.slice(0, 50);

  return (
    <div className="space-y-4">
      <p className="text-[12px] text-text-tertiary">
        {rows.length} role{rows.length === 1 ? "" : "s"} flagged with{" "}
        <code className="text-text-secondary">archetype_needs_review</code> (confidence below 0.80
        or close-call without disambiguation). Showing lowest-confidence first.
      </p>

      <SectionLabel>Lowest-confidence classifications</SectionLabel>
      <div className="overflow-hidden rounded-lg border border-border-subtle">
        <table className="w-full text-[12px]">
          <thead className="bg-surface-3 text-[11px] uppercase text-text-tertiary">
            <tr>
              <th className="px-3 py-2 text-left">Title @ Company</th>
              <th className="px-3 py-2 text-left">Primary</th>
              <th className="px-3 py-2 text-right">Confidence</th>
              <th className="px-3 py-2 text-left">Secondary</th>
              <th className="px-3 py-2 text-right">Link</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.url} className="border-t border-border-subtle">
                <td className="px-3 py-2 text-text-secondary">
                  <div className="line-clamp-1">{r.title}</div>
                  <div className="text-[10px] text-text-tertiary">{r.company}</div>
                </td>
                <td className="px-3 py-2">
                  {r.primary && (
                    <Badge color="neutral">{nameById.get(r.primary) ?? r.primary}</Badge>
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  <span
                    className={
                      r.confidence < 0.5
                        ? "text-red"
                        : r.confidence < 0.7
                          ? "text-amber"
                          : "text-text-secondary"
                    }
                  >
                    {r.confidence.toFixed(2)}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    {r.secondary.map((s) => (
                      <Badge key={s} color="neutral">
                        {s}
                      </Badge>
                    ))}
                  </div>
                </td>
                <td className="px-3 py-2 text-right">
                  <a
                    href={r.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-action="context:open_review_role"
                    className="inline-flex items-center gap-1 text-accent hover:underline"
                  >
                    open <ExternalLink size={10} />
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > 50 && (
        <p className="text-[11px] text-text-tertiary">
          ({rows.length - 50} additional rows hidden.)
        </p>
      )}
    </div>
  );
}
