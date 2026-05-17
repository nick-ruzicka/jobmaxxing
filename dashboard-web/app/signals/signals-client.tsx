"use client";

import { useState } from "react";
import { Flame, Eye, Radio, Mic, Target, Thermometer, EyeOff, ChevronDown, ChevronRight } from "lucide-react";
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

  const monitorSorted = [...monitor].sort(
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
        {actingOnNow.length > 0 && (
          <section>
            <SectionLabel icon={<Target size={12} className="text-emerald" />} className="mb-3">
              Acting On Now ({actingOnNow.length})
            </SectionLabel>
            <div className="grid gap-2 lg:grid-cols-2">
              {actingOnNow.map((s) => (
                <Link
                  key={s.slug}
                  href={`/pipeline?company=${s.slug}&from=signals`}
                  className="flex items-center gap-3 rounded-lg border border-border-subtle bg-surface-2 px-4 py-3 transition-colors hover:bg-surface-3"
                >
                  <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium text-text-primary">{s.name}</span>
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
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* Section 2: Warming Up */}
        {warmingUp.length > 0 && (
          <section>
            <SectionLabel icon={<Thermometer size={12} className="text-amber" />} className="mb-3">
              Warming Up ({warmingUp.length})
            </SectionLabel>
            <div className="grid gap-2 lg:grid-cols-2">
              {warmingUp.map((s) => (
                <Link
                  key={s.slug}
                  href={`/pipeline?company=${s.slug}&from=signals`}
                  className="flex items-center gap-3 rounded-lg border border-border-subtle bg-surface-2 px-4 py-3 transition-colors hover:bg-surface-3"
                >
                  <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium text-text-primary">{s.name}</span>
                      {s.result === "posting" && <Badge color="emerald">Posting</Badge>}
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-[12px] text-text-muted">
                      <FundingPill amount={s.amount} />
                      <span>Checked {s.lastChecked}</span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* Section 3: Monitor */}
        <section>
          <SectionLabel icon={<Eye size={12} className="text-text-tertiary" />} className="mb-3">
            Monitor ({monitor.length})
          </SectionLabel>
          <TableContainer>
            <thead className="border-b border-border-subtle bg-surface-1">
              <tr>
                <Th>Company</Th>
                <Th>Funding</Th>
                <Th>Last checked</Th>
              </tr>
            </thead>
            <tbody>
              {monitorSorted.length === 0 ? (
                <tr>
                  <td colSpan={3} className="p-0">
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
                    <td className="px-3 py-3 font-medium text-text-primary">{s.name}</td>
                    <td className="px-3 py-3 tabular-nums"><FundingPill amount={s.amount} /></td>
                    <td className="px-3 py-3 text-[12px] tabular-nums text-text-muted">{s.lastChecked}</td>
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
                        <td className="px-3 py-3 text-text-secondary">{s.name}</td>
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
