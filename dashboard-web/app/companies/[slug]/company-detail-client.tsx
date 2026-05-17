"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Building2,
  ExternalLink,
  RefreshCw,
  Sparkles,
  Star,
  X,
} from "lucide-react";

import type { CompanyDetailWithThesis } from "@/lib/company-detail";
import {
  velocityBadge,
  archetypeLabel,
  yesNoLabel,
  fundingSubtitle,
  hasAnyEnrichment,
} from "@/lib/company-detail-presenters";

import { Shell } from "@/components/Shell";
import {
  PageHeader,
  SectionLabel,
  Badge,
  Button,
  TableContainer,
  Th,
  Tr,
  EmptyState,
} from "@/components/ui";

interface Props {
  detail: CompanyDetailWithThesis;
  activePursuing: number;
  highConviction: number;
  companyCount: number;
  signalCount: number;
  hasWarmLeads: boolean;
}

export function CompanyDetailClient({
  detail,
  activePursuing,
  highConviction,
  companyCount,
  signalCount,
  hasWarmLeads,
}: Props) {
  const router = useRouter();

  // Local state for thesis — server-rendered value is the starting point; the
  // Regenerate button swaps it in place without a full reload.
  const [thesis, setThesis] = useState(detail.thesis);
  const [regenerating, setRegenerating] = useState(false);
  const [thesisError, setThesisError] = useState<string | null>(null);

  // Dismiss state — optimistic. On success we navigate back to /companies.
  const [dismissed, setDismissed] = useState(false);

  const handleRegenerate = useCallback(async () => {
    if (regenerating) return;
    setRegenerating(true);
    setThesisError(null);
    try {
      const res = await fetch(
        `/api/companies/${detail.identity.slug}?generate=1&force=1`,
        { method: "GET" }
      );
      if (!res.ok) throw new Error(`API ${res.status}`);
      const fresh = (await res.json()) as CompanyDetailWithThesis;
      setThesis(fresh.thesis);
      if (fresh.thesis.error) setThesisError(fresh.thesis.error);
    } catch (err) {
      setThesisError(err instanceof Error ? err.message : "Regenerate failed");
    } finally {
      setRegenerating(false);
    }
  }, [detail.identity.slug, regenerating]);

  const handleDismiss = useCallback(async () => {
    setDismissed(true);
    try {
      const res = await fetch("/api/signals/dismiss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: detail.identity.slug }),
      });
      if (!res.ok) throw new Error(`Dismiss failed: ${res.status}`);
      router.push("/companies");
    } catch {
      // Revert if the request fails; user can try again.
      setDismissed(false);
    }
  }, [detail.identity.slug, router]);

  const { identity, roles, hiring_velocity, enrichment_summary, archetype_distribution, last_role_seen_date } = detail;

  const velocity = velocityBadge(hiring_velocity);
  const fundingLine = fundingSubtitle(identity.funding_amount, identity.funding_date);
  // Show Dismiss only when there's a signal entry — the dismiss action writes
  // to the signal exclusion list, so it's only meaningful for signal companies.
  const dismissable = identity.funding_amount !== null;
  const subtitleParts: string[] = [];
  if (fundingLine) subtitleParts.push(fundingLine);
  if (identity.ats) subtitleParts.push(`${identity.ats.toUpperCase()} ATS`);
  if (last_role_seen_date) subtitleParts.push(`role last seen ${last_role_seen_date}`);
  const subtitle = subtitleParts.join(" · ");

  const archetypeChips = Object.entries(archetype_distribution).sort(
    (a, b) => b[1] - a[1]
  );

  return (
    <Shell
      activePursuing={activePursuing}
      highConviction={highConviction}
      companyCount={companyCount}
      signalCount={signalCount}
      hasWarmLeads={hasWarmLeads}
    >
      {/* Back nav */}
      <Link
        href="/companies"
        className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-text-muted hover:text-text-secondary transition-colors"
      >
        <ArrowLeft size={12} />
        All companies
      </Link>

      <PageHeader
        icon={<Building2 size={18} className="text-text-tertiary" />}
        title={identity.name}
        subtitle={subtitle || "No funding signal recorded · scraped from open postings"}
        actions={
          <>
            <Link
              href={`/pipeline?company=${identity.slug}&from=companies`}
              className="inline-flex items-center gap-1.5 rounded-md border border-border-subtle bg-surface-2 px-3 py-1.5 text-[13px] font-medium text-text-secondary transition-colors hover:bg-surface-3"
            >
              View in pipeline
              <ExternalLink size={12} />
            </Link>
            {dismissable && (
              <Button
                variant="secondary"
                onClick={handleDismiss}
                disabled={dismissed}
                title="Never show this company in signals again"
              >
                <X size={14} />
                {dismissed ? "Dismissed" : "Dismiss"}
              </Button>
            )}
            <Button
              variant="secondary"
              disabled
              title="Pin to watchlist — coming soon. Edit config/companies.yml to pin today."
            >
              <Star size={14} />
              Pin (soon)
            </Button>
          </>
        }
      />

      {/* Header chip row — velocity + archetypes the company is hiring against. */}
      {(velocity || archetypeChips.length > 0) && (
        <div className="mb-6 flex flex-wrap items-center gap-2">
          {velocity && <Badge color={velocity.color}>{velocity.label}</Badge>}
          {archetypeChips.map(([id, count]) => (
            <Badge key={id} color="accent">
              {archetypeLabel(id)} · {count}
            </Badge>
          ))}
        </div>
      )}

      <div className="space-y-8">
        {/* Thesis — generated on demand, cached on disk. */}
        <ThesisSection
          thesisText={thesis.text}
          generatedAt={thesis.generated_at}
          error={thesisError}
          regenerating={regenerating}
          onRegenerate={handleRegenerate}
        />

        {/* Roles — every posting we know about for this company. */}
        <RolesSection roles={roles} slug={identity.slug} />

        {/* Enrichment summary — the aggregator's view of cross-role themes. */}
        <EnrichmentSummarySection summary={enrichment_summary} />
      </div>
    </Shell>
  );
}

// ---------------------------------------------------------------------------
// Thesis section
// ---------------------------------------------------------------------------

function ThesisSection({
  thesisText,
  generatedAt,
  error,
  regenerating,
  onRegenerate,
}: {
  thesisText: string | null;
  generatedAt: string | null;
  error: string | null;
  regenerating: boolean;
  onRegenerate: () => void;
}) {
  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-3">
        <SectionLabel icon={<Sparkles size={12} className="text-accent" />}>
          Thesis
        </SectionLabel>
        <Button
          variant="secondary"
          onClick={onRegenerate}
          disabled={regenerating}
          title={thesisText ? "Regenerate the thesis from current data" : "Generate a thesis"}
        >
          <RefreshCw size={14} className={regenerating ? "animate-spin" : ""} />
          {thesisText ? "Regenerate" : "Generate"}
        </Button>
      </div>
      {error ? (
        <div className="rounded-lg border border-border-subtle bg-surface-2 px-4 py-3 text-[13px] text-red">
          Couldn&apos;t generate — {error}
        </div>
      ) : thesisText ? (
        <div className="rounded-lg border border-border-subtle bg-surface-2 px-4 py-3 text-[14px] leading-relaxed text-text-secondary">
          {thesisText}
          {generatedAt && (
            <div className="mt-2 text-[11px] tabular-nums text-text-muted">
              Generated {new Date(generatedAt).toLocaleString()}
            </div>
          )}
        </div>
      ) : (
        <EmptyState
          icon={<Sparkles size={28} />}
          title="Thesis pending"
          description="No thesis has been generated yet. Click Generate to synthesize one from this company's funding, stage, and open-role enrichment."
        />
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Roles section
// ---------------------------------------------------------------------------

function RolesSection({
  roles,
  slug,
}: {
  roles: CompanyDetailWithThesis["roles"];
  slug: string;
}) {
  if (roles.length === 0) {
    return (
      <section>
        <SectionLabel className="mb-3">Open roles (0)</SectionLabel>
        <EmptyState
          icon={<Building2 size={28} />}
          title="No roles scraped yet"
          description="This company is on the radar via a funding signal but we haven't seen open postings yet. Run a scan or check back later."
        />
      </section>
    );
  }
  const sorted = [...roles].sort((a, b) => {
    const sa = a.score_adjusted ?? -1;
    const sb = b.score_adjusted ?? -1;
    return sb - sa || a.title.localeCompare(b.title);
  });
  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <SectionLabel>Open roles ({roles.length})</SectionLabel>
        <Link
          href={`/pipeline?company=${slug}&from=companies`}
          className="text-[12px] font-medium text-accent hover:underline"
        >
          See in pipeline →
        </Link>
      </div>
      <TableContainer>
        <thead className="border-b border-border-subtle bg-surface-1">
          <tr>
            <Th>Role</Th>
            <Th>Archetype</Th>
            <Th>Score</Th>
            <Th className="w-10"></Th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, idx) => (
            <Tr key={r.id} zebra={idx % 2 === 1}>
              <td className="px-3 py-2.5 text-text-primary">
                <a
                  href={r.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium hover:text-accent transition-colors"
                  title={r.link}
                >
                  {r.title}
                </a>
              </td>
              <td className="px-3 py-2.5 text-[12px] text-text-tertiary">
                {r.archetype_primary ? archetypeLabel(r.archetype_primary) : "—"}
              </td>
              <td className="px-3 py-2.5 text-[12px] tabular-nums text-text-secondary">
                {r.score_adjusted !== null ? `${r.score_adjusted}/10` : "—"}
              </td>
              <td className="px-3 py-2.5">
                <a
                  href={r.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-text-muted hover:text-text-secondary transition-colors"
                  title="Open job description"
                  aria-label={`Open ${r.title} job posting`}
                >
                  <ExternalLink size={12} />
                </a>
              </td>
            </Tr>
          ))}
        </tbody>
      </TableContainer>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Enrichment summary section
// ---------------------------------------------------------------------------

function EnrichmentSummarySection({
  summary,
}: {
  summary: CompanyDetailWithThesis["enrichment_summary"];
}) {
  if (!hasAnyEnrichment(summary)) {
    return (
      <section>
        <SectionLabel className="mb-3">Enrichment summary</SectionLabel>
        <EmptyState
          icon={<Sparkles size={28} />}
          title="No enriched roles yet"
          description="Once Claude analyzes this company's open postings, we'll surface the cross-role flags and themes here."
        />
      </section>
    );
  }
  return (
    <section>
      <SectionLabel className="mb-3">Enrichment summary</SectionLabel>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <SummaryCard
          title="Green flags"
          subtitle="Themes that show up across multiple postings"
          items={summary.green_flags.map((f) => ({ key: f.flag, label: f.flag, count: f.count }))}
          accent="emerald"
        />
        <SummaryCard
          title="Red flags"
          subtitle="Concerns repeated across postings"
          items={summary.red_flags.map((f) => ({ key: f.flag, label: f.flag, count: f.count }))}
          accent="red"
        />
        <SummaryCard
          title="Team context"
          subtitle="What the JDs say about the team behind these roles"
          items={summary.team_context.map((t) => ({ key: t.theme, label: t.theme, count: t.count }))}
          accent="neutral"
        />
        <div className="grid grid-cols-1 gap-3">
          <MetaPanel title="Company stage">
            {summary.company_stage ? (
              <span>
                <span className="font-medium text-text-primary">{summary.company_stage.mode}</span>
                <span className="ml-2 text-text-muted">
                  ({summary.company_stage.count}
                  {summary.company_stage.count === 1 ? " mention" : " mentions"})
                </span>
              </span>
            ) : (
              <span className="text-text-muted">No stage information</span>
            )}
          </MetaPanel>
          <MetaPanel title="Builds components?">
            <ValueCounts items={summary.build_component} />
          </MetaPanel>
          <MetaPanel title="AI signal in JDs?">
            <ValueCounts items={summary.ai_signal} />
          </MetaPanel>
        </div>
      </div>
    </section>
  );
}

function SummaryCard({
  title,
  subtitle,
  items,
  accent,
}: {
  title: string;
  subtitle: string;
  items: Array<{ key: string; label: string; count: number }>;
  accent: "emerald" | "red" | "neutral";
}) {
  const dotClass =
    accent === "emerald" ? "bg-emerald" : accent === "red" ? "bg-red" : "bg-text-muted";
  return (
    <div className="rounded-lg border border-border-subtle bg-surface-2 p-4">
      <div className="mb-1 text-[13px] font-medium text-text-primary">{title}</div>
      <div className="mb-3 text-[12px] text-text-muted">{subtitle}</div>
      {items.length === 0 ? (
        <div className="text-[13px] text-text-muted">(none)</div>
      ) : (
        <ul className="space-y-2">
          {items.map((it) => (
            <li key={it.key} className="flex items-start gap-2 text-[13px] text-text-secondary">
              <span aria-hidden className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${dotClass}`} />
              <span className="flex-1">{it.label}</span>
              <span className="shrink-0 tabular-nums text-text-muted">×{it.count}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MetaPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border-subtle bg-surface-2 p-4">
      <div className="mb-1 text-[12px] font-medium uppercase tracking-wide text-text-muted">
        {title}
      </div>
      <div className="text-[13px] text-text-secondary">{children}</div>
    </div>
  );
}

function ValueCounts({ items }: { items: Array<{ value: boolean; count: number }> }) {
  if (items.length === 0) return <span className="text-text-muted">No data</span>;
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((it) => (
        <span key={String(it.value)} className="text-text-secondary">
          {yesNoLabel(it.value)}{" "}
          <span className="tabular-nums text-text-muted">×{it.count}</span>
        </span>
      ))}
    </div>
  );
}
