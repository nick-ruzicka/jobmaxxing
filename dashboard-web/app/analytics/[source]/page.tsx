"use client";

import { useCallback, useEffect, useState, use } from "react";
import Link from "next/link";
import { ArrowLeft, ExternalLink, AlertTriangle, Lightbulb } from "lucide-react";

import { PageHeader } from "@/components/ui/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { SectionLabel } from "@/components/ui/SectionLabel";

import { Sparkline } from "../Sparkline";
import { fmtInt, pct } from "../sections";

import type { SourceDetail } from "@/lib/source-detail";

type Range = "7d" | "30d" | "60d" | "90d";

export default function SourceDetailPage({
  params,
}: {
  params: Promise<{ source: string }>;
}) {
  const { source } = use(params);
  const host = decodeURIComponent(source);
  const [range, setRange] = useState<Range>("30d");
  const [data, setData] = useState<SourceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(
        `/api/analytics/source/${encodeURIComponent(host)}?range=${range}`,
      );
      const j = await r.json();
      setData(j);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [host, range]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <Link
              href="/analytics"
              className="text-text-tertiary hover:text-text-secondary"
              aria-label="Back to analytics"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <span className="font-mono text-[16px]">{host}</span>
          </span>
        }
        subtitle={data ? `${fmtInt(data.totals.urls_total)} URLs all-time` : "loading…"}
        actions={
          <>
            <RangeChips value={range} onChange={setRange} />
            <Button variant="secondary" onClick={fetchData}>
              Refresh
            </Button>
          </>
        }
      />

      {error && (
        <div className="rounded-lg border border-red-border bg-red-dim/40 p-3 text-[13px] text-red">
          {error}
        </div>
      )}
      {!data && loading && <EmptyState title={`Loading deep-dive for ${host}…`} />}

      {data && !data.found && (
        <EmptyState
          title="No URLs from this host yet."
          description="Either nothing has been scraped from this source, or the hostname is misspelled."
          action={
            <Button variant="secondary" href="/analytics">
              Back to analytics
            </Button>
          }
        />
      )}

      {data && data.found && (
        <>
          <Overview detail={data} />
          <Trends detail={data} />
          <SuggestedActionsCard actions={data.suggested_actions} />
          <UrlPatterns detail={data} />
          <RecentLists detail={data} />
        </>
      )}
    </div>
  );
}

function Overview({ detail }: { detail: SourceDetail }) {
  const t = detail.totals;
  const hitRate = t.enriched_real > 0 ? t.fit_6plus / t.enriched_real : 0;
  return (
    <section className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
      <Stat label="URLs (range)" value={fmtInt(t.urls_in_range)} sub={`${fmtInt(t.urls_total)} all-time`} />
      <Stat label="Enriched" value={fmtInt(t.enriched_real)} sub={`${fmtInt(t.enrich_errors)} errors`} />
      <Stat label="Fit ≥6" value={fmtInt(t.fit_6plus)} sub={`${fmtInt(t.fit_7plus)} fit ≥7`} />
      <Stat
        label="Hit rate"
        value={t.enriched_real > 0 ? pct(hitRate) : "—"}
        sub={`${fmtInt(t.has_comp)} have comp`}
      />
      <Stat label="Open / closed" value={`${fmtInt(t.open)} / ${fmtInt(t.closed)}`} />
      <Stat
        label="Avg fit"
        value={
          t.enriched_real > 0
            ? (
                detail.daily.reduce((s, d) => s + (d.roles_fit_6plus || 0), 0) /
                  Math.max(t.enriched_real, 1) *
                  10
              ).toFixed(1)
            : "—"
        }
      />
    </section>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-border-subtle bg-surface-2 p-3">
      <div className="text-[11px] font-medium uppercase tracking-[0.04em] text-text-tertiary">{label}</div>
      <div className="mt-1 text-[18px] font-semibold tabular-nums text-text-primary">{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-text-muted">{sub}</div>}
    </div>
  );
}

function Trends({ detail }: { detail: SourceDetail }) {
  const dates = detail.daily.map((d) => d.date);
  return (
    <section>
      <SectionLabel>Trends ({detail.range})</SectionLabel>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <TrendCard
          title="Roles discovered per day"
          data={detail.daily.map((d) => d.roles_discovered)}
          labels={dates}
          color="blue"
        />
        <TrendCard
          title="Roles enriched per day"
          data={detail.daily.map((d) => d.roles_enriched)}
          labels={dates}
          color="emerald"
        />
        <TrendCard
          title="Fit ≥6 per day"
          data={detail.daily.map((d) => d.roles_fit_6plus)}
          labels={dates}
          color="violet"
        />
        <TrendCard
          title="Daily cost"
          data={detail.daily.map((d) => d.total_cost_usd)}
          labels={dates}
          color="amber"
        />
      </div>
    </section>
  );
}

function TrendCard({
  title,
  data,
  labels,
  color,
}: {
  title: string;
  data: number[];
  labels: string[];
  color: "blue" | "emerald" | "violet" | "amber";
}) {
  const total = data.reduce((s, n) => s + (n || 0), 0);
  return (
    <div className="rounded-lg border border-border-subtle bg-surface-2 p-4">
      <div className="mb-1 text-[13px] font-medium text-text-primary">{title}</div>
      <div className="mb-3 text-[11px] text-text-muted">
        total: <span className="tabular-nums text-text-secondary">{Math.round(total * 100) / 100}</span>
      </div>
      <Sparkline data={data} labels={labels} color={color} width={320} height={64} />
    </div>
  );
}

function SuggestedActionsCard({ actions }: { actions: string[] }) {
  if (actions.length === 0) {
    return (
      <section className="rounded-lg border border-emerald-border bg-emerald-dim/40 p-3 text-[13px] text-emerald">
        ✓ No anomalies for this source — extractor behaving normally.
      </section>
    );
  }
  return (
    <section className="rounded-lg border border-amber-border bg-amber-dim/30 p-3">
      <div className="mb-2 flex items-center gap-2 text-[13px] font-medium text-text-primary">
        <Lightbulb className="h-4 w-4 text-amber" />
        Suggested actions
      </div>
      <ul className="space-y-1.5 text-[13px] text-text-secondary">
        {actions.map((a, i) => (
          <li key={i} className="flex gap-2">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber" />
            <span>{a}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function UrlPatterns({ detail }: { detail: SourceDetail }) {
  if (detail.url_patterns.length === 0) return null;
  return (
    <section>
      <SectionLabel>URL pattern analysis</SectionLabel>
      <div className="overflow-x-auto rounded-lg border border-border-subtle bg-surface-2">
        <table className="w-full text-[13px]">
          <thead className="border-b border-border-subtle bg-surface-1 text-[11px] font-medium uppercase tracking-[0.04em] text-text-tertiary">
            <tr>
              <th className="px-3 py-2.5 text-left">Pattern</th>
              <th className="px-3 py-2.5 text-right">Count</th>
              <th className="px-3 py-2.5 text-left">Example</th>
            </tr>
          </thead>
          <tbody>
            {detail.url_patterns.map((p) => (
              <tr key={p.pattern} className="border-b border-border-subtle even:bg-surface-row">
                <td className="px-3 py-2.5 font-mono text-[12px] text-text-secondary">{p.pattern}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-text-secondary">{fmtInt(p.count)}</td>
                <td className="px-3 py-2.5 text-[12px]">
                  <a
                    href={p.example_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-accent hover:underline"
                  >
                    {p.example_url.slice(0, 70)}…
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function RecentLists({ detail }: { detail: SourceDetail }) {
  return (
    <section className="space-y-6">
      <RoleList title="Recent high-fit roles" roles={detail.recent_high_fit} highlight />
      <RoleList title="Recent discoveries" roles={detail.recent_roles} />
      {detail.recent_errors.length > 0 && (
        <div>
          <SectionLabel>Recent enrichment errors</SectionLabel>
          <div className="overflow-x-auto rounded-lg border border-border-subtle bg-surface-2">
            <table className="w-full text-[13px]">
              <thead className="border-b border-border-subtle bg-surface-1 text-[11px] font-medium uppercase tracking-[0.04em] text-text-tertiary">
                <tr>
                  <th className="px-3 py-2.5 text-left">When</th>
                  <th className="px-3 py-2.5 text-left">Error</th>
                  <th className="px-3 py-2.5 text-left">URL</th>
                </tr>
              </thead>
              <tbody>
                {detail.recent_errors.map((e) => (
                  <tr key={e.url} className="border-b border-border-subtle even:bg-surface-row">
                    <td className="px-3 py-2.5 tabular-nums text-text-tertiary">
                      {e.timestamp?.slice(0, 19).replace("T", " ") || "—"}
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge color="red">{e.error}</Badge>
                    </td>
                    <td className="px-3 py-2.5 text-[12px] text-text-muted truncate max-w-md">{e.url}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

function RoleList({
  title,
  roles,
  highlight = false,
}: {
  title: string;
  roles: SourceDetail["recent_roles"];
  highlight?: boolean;
}) {
  if (roles.length === 0) return null;
  return (
    <div>
      <SectionLabel>{title}</SectionLabel>
      <div className="overflow-x-auto rounded-lg border border-border-subtle bg-surface-2">
        <table className="w-full text-[13px]">
          <thead className="border-b border-border-subtle bg-surface-1 text-[11px] font-medium uppercase tracking-[0.04em] text-text-tertiary">
            <tr>
              <th className="px-3 py-2.5 text-left">First seen</th>
              <th className="px-3 py-2.5 text-left">Title</th>
              <th className="px-3 py-2.5 text-left">Company</th>
              <th className="px-3 py-2.5 text-right">Fit</th>
              <th className="px-3 py-2.5 text-left">Comp</th>
              <th className="px-3 py-2.5"></th>
            </tr>
          </thead>
          <tbody>
            {roles.map((r) => (
              <tr
                key={r.url}
                className={`border-b border-border-subtle even:bg-surface-row ${r.closed ? "opacity-50" : ""}`}
              >
                <td className="px-3 py-2.5 tabular-nums text-text-tertiary">{r.firstSeen || "—"}</td>
                <td className="px-3 py-2.5 text-text-primary">{r.title || "—"}</td>
                <td className="px-3 py-2.5 text-text-secondary">{r.company || "—"}</td>
                <td className="px-3 py-2.5 text-right">
                  {typeof r.fit_score === "number" ? (
                    <Badge color={fitColor(r.fit_score, highlight)}>{r.fit_score}</Badge>
                  ) : (
                    <span className="text-text-muted">—</span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-[12px] text-text-secondary">{r.comp_range || "—"}</td>
                <td className="px-3 py-2.5 text-right">
                  <a
                    href={r.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-text-tertiary hover:text-text-secondary"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
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

function fitColor(score: number, highlight: boolean): "emerald" | "blue" | "amber" | "neutral" {
  if (highlight) return "emerald";
  if (score >= 8) return "emerald";
  if (score >= 6) return "blue";
  if (score >= 4) return "amber";
  return "neutral";
}

function RangeChips({ value, onChange }: { value: Range; onChange: (r: Range) => void }) {
  const opts: Range[] = ["7d", "30d", "60d", "90d"];
  return (
    <div className="inline-flex items-center gap-1 rounded-md border border-border-default bg-surface-2 p-0.5">
      {opts.map((r) => {
        const active = r === value;
        return (
          <button
            key={r}
            onClick={() => onChange(r)}
            className={
              active
                ? "rounded-md bg-surface-3 px-2.5 py-1 text-[12px] font-medium text-text-primary"
                : "rounded-md px-2.5 py-1 text-[12px] text-text-tertiary hover:text-text-secondary"
            }
          >
            {r}
          </button>
        );
      })}
    </div>
  );
}
