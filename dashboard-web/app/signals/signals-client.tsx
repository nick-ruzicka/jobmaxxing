"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Eye, Radio, Mic, Target, Thermometer, EyeOff, ChevronDown, ChevronRight, X } from "lucide-react";
import type { EnrichedSignal } from "@/lib/signal-enrichment";
import { Shell } from "@/components/Shell";
import { useScan } from "@/components/ScanContext";
import { PageHeader, SectionLabel, Badge, Button, TableContainer, Th, Tr, EmptyState } from "@/components/ui";
import Link from "next/link";

/** Parse "$25M" / "$1.5B" / "$500K" → number of millions. 0 when missing/unknown. */
function amountToMillions(amount: string | null): number {
  if (!amount) return 0;
  const m = amount.match(/\$?\s*([\d.]+)\s*([KMB])?/i);
  if (!m) return 0;
  const num = parseFloat(m[1]);
  if (!Number.isFinite(num)) return 0;
  const unit = (m[2] || "M").toUpperCase();
  if (unit === "B") return num * 1000;
  if (unit === "K") return num / 1000;
  return num;
}

/** Funding tier pill */
function FundingPill({ amount }: { amount: string | null }) {
  if (!amount) return <span className="text-text-muted">&mdash;</span>;
  const m = amountToMillions(amount);
  if (m >= 20) return <Badge color="amber">{amount}</Badge>;
  if (m >= 5) return <Badge color="amber" className="opacity-60">{amount}</Badge>;
  return <Badge color="neutral">{amount}</Badge>;
}

/** Hiring velocity badge */
function VelocityBadge({ velocity }: { velocity: string }) {
  if (velocity === "on_fire") return <Badge color="red">ON FIRE</Badge>;
  if (velocity === "hot") return <Badge color="amber">HOT</Badge>;
  if (velocity === "warming") return <Badge color="blue">WARMING</Badge>;
  return null;
}

/** Archetype chips */
function ArchetypeChips({ archetypes }: { archetypes: string[] }) {
  if (archetypes.length === 0) return null;
  const labels: Record<string, string> = {
    "gtm-engineering": "GTM Eng",
    "ai-operations": "AI Ops",
    "fde": "FDE",
    "web3-bd": "Web3 BD",
    "web3-bizops": "Web3 BizOps",
  };
  return (
    <div className="flex flex-wrap gap-1">
      {archetypes.map((a) => (
        <Badge key={a} color="accent">{labels[a] || a}</Badge>
      ))}
    </div>
  );
}

interface SignalsPageProps {
  actingOnNow: EnrichedSignal[];
  warmingUp: EnrichedSignal[];
  monitor: EnrichedSignal[];
  hidden: EnrichedSignal[];
  totalSignals: number;
  actingCount: number;
  warmingCount: number;
  monitorCount: number;
  hiddenCount: number;
  companyCount: number;
  signalCount: number;
  hasWarmLeads: boolean;
  activePursuing: number;
  highConviction: number;
}

function SignalsHeader({ subtitle }: { subtitle: string }) {
  const { runScan, scanRunning } = useScan();
  return (
    <PageHeader
      icon={<Mic size={16} className="text-text-tertiary" />}
      title="Signals"
      subtitle={subtitle}
      actions={
        <Button variant="secondary" onClick={() => runScan("signal")} disabled={scanRunning} title="Funding + hiring-intent signals">
          <Radio size={14} className={scanRunning ? "animate-spin" : ""} />
          Signal Scan
        </Button>
      }
    />
  );
}

/** Dismiss button — prevents click from bubbling to the parent link. */
function DismissButton({ slug, onDismiss }: { slug: string; onDismiss: (slug: string) => void }) {
  return (
    <button
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDismiss(slug); }}
      className="ml-auto shrink-0 rounded p-1 text-text-muted hover:bg-surface-3 hover:text-text-secondary transition-colors"
      title="Never show this company again"
    >
      <X size={14} />
    </button>
  );
}

export function SignalsPage({
  actingOnNow,
  warmingUp,
  monitor,
  hidden,
  totalSignals,
  actingCount,
  warmingCount,
  monitorCount,
  hiddenCount,
  companyCount,
  signalCount,
  hasWarmLeads,
  activePursuing,
  highConviction,
}: SignalsPageProps) {
  const [hiddenExpanded, setHiddenExpanded] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const router = useRouter();

  const handleDismiss = useCallback(async (slug: string) => {
    setDismissed((prev) => new Set([...prev, slug]));
    try {
      await fetch("/api/signals/dismiss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug }),
      });
      router.refresh();
    } catch {
      // Revert optimistic update on failure
      setDismissed((prev) => { const next = new Set(prev); next.delete(slug); return next; });
    }
  }, [router]);

  // Filter out locally-dismissed companies (before server refresh)
  const visibleActing = actingOnNow.filter((s) => !dismissed.has(s.slug));
  const visibleWarming = warmingUp.filter((s) => !dismissed.has(s.slug));
  const visibleMonitor = monitor.filter((s) => !dismissed.has(s.slug));

  const monitorSorted = [...visibleMonitor].sort(
    (a, b) => amountToMillions(b.amount) - amountToMillions(a.amount),
  );

  const subtitle = `${totalSignals} tracked · ${actingCount} acting · ${warmingCount} warming · ${monitorCount} monitor · ${hiddenCount} filtered`;

  return (
    <Shell
      activePursuing={activePursuing}
      highConviction={highConviction}
      companyCount={companyCount}
      signalCount={signalCount}
      hasWarmLeads={hasWarmLeads}
    >
      <SignalsHeader subtitle={subtitle} />

      <div className="space-y-6">
        {/* Section 1: Acting On Now */}
        {visibleActing.length > 0 && (
          <section>
            <SectionLabel icon={<Target size={12} className="text-emerald" />} className="mb-3">
              Acting On Now ({visibleActing.length})
            </SectionLabel>
            <div className="grid gap-2 lg:grid-cols-2">
              {visibleActing.map((s) => (
                <div
                  key={s.slug}
                  role="button"
                  tabIndex={0}
                  onClick={() => router.push(`/pipeline?company=${s.slug}&from=signals`)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") router.push(`/pipeline?company=${s.slug}&from=signals`); }}
                  className="flex cursor-pointer items-center gap-3 rounded-lg border border-border-subtle bg-surface-2 px-4 py-3 transition-colors hover:bg-surface-3"
                >
                  <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/companies/${s.slug}`}
                        onClick={(e) => e.stopPropagation()}
                        className="truncate font-medium text-text-primary hover:text-accent transition-colors"
                      >
                        {s.name}
                      </Link>
                      <VelocityBadge velocity={s.match.hiring_velocity} />
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-text-muted">
                      <FundingPill amount={s.amount} />
                      {s.match.archetype_roles_count > 0 && (
                        <span>{s.match.archetype_roles_count} matching roles</span>
                      )}
                      <ArchetypeChips archetypes={s.match.archetypes_matched} />
                    </div>
                  </div>
                  <DismissButton slug={s.slug} onDismiss={handleDismiss} />
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Section 2: Warming Up */}
        {visibleWarming.length > 0 && (
          <section>
            <SectionLabel icon={<Thermometer size={12} className="text-amber" />} className="mb-3">
              Warming Up ({visibleWarming.length})
            </SectionLabel>
            <div className="grid gap-2 lg:grid-cols-2">
              {visibleWarming.map((s) => (
                <div
                  key={s.slug}
                  role="button"
                  tabIndex={0}
                  onClick={() => router.push(`/pipeline?company=${s.slug}&from=signals`)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") router.push(`/pipeline?company=${s.slug}&from=signals`); }}
                  className="flex cursor-pointer items-center gap-3 rounded-lg border border-border-subtle bg-surface-2 px-4 py-3 transition-colors hover:bg-surface-3"
                >
                  <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/companies/${s.slug}`}
                        onClick={(e) => e.stopPropagation()}
                        className="truncate font-medium text-text-primary hover:text-accent transition-colors"
                      >
                        {s.name}
                      </Link>
                      {s.result === "posting" && <Badge color="emerald">Posting</Badge>}
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-[12px] text-text-muted">
                      <FundingPill amount={s.amount} />
                      <span>Checked {s.lastChecked}</span>
                    </div>
                  </div>
                  <DismissButton slug={s.slug} onDismiss={handleDismiss} />
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Section 3: Monitor */}
        <section>
          <SectionLabel icon={<Eye size={12} className="text-text-tertiary" />} className="mb-3">
            Monitor ({visibleMonitor.length})
          </SectionLabel>
          <TableContainer>
            <thead className="border-b border-border-subtle bg-surface-1">
              <tr>
                <Th>Company</Th>
                <Th>Funding</Th>
                <Th>Last checked</Th>
                <Th className="w-10"></Th>
              </tr>
            </thead>
            <tbody>
              {monitorSorted.length === 0 ? (
                <tr>
                  <td colSpan={4} className="p-0">
                    <EmptyState
                      icon={<Eye size={28} />}
                      title="Nothing on the radar"
                      description="Companies you're watching for funding or hiring signals will show up here."
                    />
                  </td>
                </tr>
              ) : (
                monitorSorted.map((s) => (
                  <Tr key={s.slug} zebra>
                    <td className="px-3 py-3 font-medium text-text-primary">
                      <Link
                        href={`/companies/${s.slug}`}
                        className="hover:text-accent transition-colors"
                      >
                        {s.name}
                      </Link>
                    </td>
                    <td className="px-3 py-3 tabular-nums"><FundingPill amount={s.amount} /></td>
                    <td className="px-3 py-3 text-[12px] tabular-nums text-text-muted">{s.lastChecked}</td>
                    <td className="px-3 py-3">
                      <button
                        onClick={() => handleDismiss(s.slug)}
                        className="rounded p-1 text-text-muted hover:bg-surface-3 hover:text-text-secondary transition-colors"
                        title="Never show this company again"
                      >
                        <X size={12} />
                      </button>
                    </td>
                  </Tr>
                ))
              )}
            </tbody>
          </TableContainer>
        </section>

        {/* Section 4: Hidden by Filter (collapsed) */}
        {hidden.length > 0 && (
          <section>
            <button
              onClick={() => setHiddenExpanded(!hiddenExpanded)}
              className="flex items-center gap-2 text-[13px] text-text-muted hover:text-text-secondary transition-colors"
            >
              {hiddenExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <EyeOff size={12} />
              Hidden by Filter ({hidden.length})
            </button>
            {hiddenExpanded && (
              <div className="mt-3">
                <TableContainer>
                  <thead className="border-b border-border-subtle bg-surface-1">
                    <tr>
                      <Th>Company</Th>
                      <Th>Funding</Th>
                      <Th>Reason</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {hidden.map((s) => (
                      <Tr key={s.slug} zebra>
                        <td className="px-3 py-3 text-text-secondary">
                          <Link
                            href={`/companies/${s.slug}`}
                            className="hover:text-accent transition-colors"
                          >
                            {s.name}
                          </Link>
                        </td>
                        <td className="px-3 py-3 tabular-nums"><FundingPill amount={s.amount} /></td>
                        <td className="px-3 py-3 text-[12px] text-text-muted">
                          {s.match.match_status === "confirmed_no_match"
                            ? "No matching archetypes"
                            : "Dismissed"}
                        </td>
                      </Tr>
                    ))}
                  </tbody>
                </TableContainer>
              </div>
            )}
          </section>
        )}
      </div>
    </Shell>
  );
}
