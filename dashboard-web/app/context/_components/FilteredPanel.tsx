"use client";

import { ExternalLink } from "lucide-react";
import { Badge, SectionLabel, EmptyState } from "@/components/ui";

interface FilteredRow {
  url: string;
  title: string;
  company: string;
  reason: string;
  assessed_at: string | null;
}

const REASON_LABELS: Record<string, string> = {
  rejected_short: "Too short / scrape failure",
  rejected_no_section_markers: "Broken or missing JD content",
  rejected_course: "Course / training offering",
  rejected_press_release: "Press release / blog article",
};

export function FilteredPanel({
  rows,
  countsByReason,
}: {
  rows: FilteredRow[];
  countsByReason: Record<string, number>;
}) {
  if (!rows || rows.length === 0) {
    return (
      <EmptyState
        icon={<span className="text-2xl">✓</span>}
        title="No filtered roles"
        description="The JD quality filter hasn't rejected any roles. As scans pull in new JDs, anything that fails the filter (broken HTML, course offerings, press releases) will appear here."
      />
    );
  }

  const total = rows.length;
  const visible = rows.slice(0, 100);

  return (
    <div className="space-y-4">
      <p className="text-[12px] text-text-tertiary">
        <span className="font-semibold text-text-secondary">{total}</span> role{total === 1 ? "" : "s"} rejected
        by the JD quality filter. These do NOT flow to <code className="text-text-secondary">/pipeline</code> and
        do NOT get classified — they&apos;re surfaced here for transparency.
      </p>

      <div>
        <SectionLabel className="mb-2">Reason breakdown</SectionLabel>
        <div className="flex flex-wrap gap-2">
          {Object.entries(countsByReason)
            .sort((a, b) => b[1] - a[1])
            .map(([reason, count]) => (
              <span
                key={reason}
                className="inline-flex items-center gap-2 rounded-lg border border-border-subtle bg-surface-2 px-3 py-1.5 text-[12px] text-text-secondary"
              >
                <code className="text-text-tertiary">{REASON_LABELS[reason] ?? reason}</code>
                <Badge>{count}</Badge>
              </span>
            ))}
        </div>
      </div>

      <SectionLabel>Most recent rejections (showing {Math.min(100, total)} of {total})</SectionLabel>
      <div className="overflow-hidden rounded-lg border border-border-subtle">
        <table className="w-full text-[12px]">
          <thead className="bg-surface-3 text-[11px] uppercase text-text-tertiary">
            <tr>
              <th className="px-3 py-2 text-left">Title @ Company</th>
              <th className="px-3 py-2 text-left">Reason</th>
              <th className="px-3 py-2 text-right">Link</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.url} className="border-t border-border-subtle">
                <td className="px-3 py-2 text-text-secondary">
                  <div className="line-clamp-1">{r.title || "(no title)"}</div>
                  <div className="text-[10px] text-text-tertiary">{r.company}</div>
                </td>
                <td className="px-3 py-2">
                  <Badge color="amber">{REASON_LABELS[r.reason] ?? r.reason}</Badge>
                </td>
                <td className="px-3 py-2 text-right">
                  <a
                    href={r.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-action="context:open_filtered_role"
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
    </div>
  );
}
