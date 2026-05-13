"use client";

import { Flame, Eye, Radio, Mic } from "lucide-react";
import type { Signal } from "@/lib/types";
import { Shell } from "@/components/Shell";
import { useScan } from "@/components/ScanContext";
import { PageHeader, SectionLabel, Badge, Button, TableContainer, Th, Tr, EmptyState } from "@/components/ui";

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

/** Funding tier pill — same gold language as the High Conviction cards above,
 *  muted at $5–20M, neutral grey below $5M, em-dash when missing. The chip IS
 *  the conviction-closeness indicator. */
function FundingPill({ amount }: { amount: string | null }) {
  if (!amount) return <span className="text-text-muted">—</span>;
  const m = amountToMillions(amount);
  if (m >= 20) return <Badge color="amber">{amount}</Badge>;
  if (m >= 5) return <Badge color="amber" className="opacity-60">{amount}</Badge>;
  return <Badge color="neutral">{amount}</Badge>;
}

interface SignalsPageProps {
  warmLeads: Signal[];
  monitoring: Signal[];
  posting: Signal[];
  totalSignals: number;
  highConviction: number;
  companyCount: number;
  signalCount: number;
  hasWarmLeads: boolean;
  activePursuing: number;
}

/** Lives inside <Shell> so it can pull the Signal-Scan action from context. */
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
  warmLeads,
  monitoring,
  posting,
  totalSignals,
  highConviction,
  companyCount,
  signalCount,
  hasWarmLeads,
  activePursuing,
}: SignalsPageProps) {
  const monitorSorted = [...monitoring].sort(
    (a, b) => amountToMillions(b.amount) - amountToMillions(a.amount),
  );

  return (
    <Shell
      activePursuing={activePursuing}
      highConviction={highConviction}
      companyCount={companyCount}
      signalCount={signalCount}
      hasWarmLeads={hasWarmLeads}
    >
      <SignalsHeader subtitle={`${totalSignals} tracked · ${highConviction} high conviction · ${posting.length} posting`} />

      <div className="space-y-6">
        {/* High Conviction */}
        {warmLeads.length > 0 && (
          <section>
            <SectionLabel icon={<Flame size={12} className="text-amber" />} className="mb-3">
              High Conviction ({warmLeads.length})
            </SectionLabel>
            <div className="grid gap-2 lg:grid-cols-2">
              {warmLeads.map((s) => (
                <div
                  key={s.slug}
                  className="flex items-center gap-3 rounded-lg border border-border-subtle bg-surface-2 px-4 py-3"
                >
                  <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber" title="High-conviction signal" />
                  <div className="min-w-0">
                    <div className="truncate font-medium text-text-primary">{s.name}</div>
                    <div className="mt-1 flex items-center gap-2 text-[12px] text-text-muted">
                      {s.amount && <Badge color="amber">{s.amount}</Badge>}
                      Checked {s.lastChecked}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Already Posting */}
        {posting.length > 0 && (
          <section>
            <SectionLabel icon={<Radio size={12} className="text-emerald" />} className="mb-3">
              Already Posting ({posting.length})
            </SectionLabel>
            <div className="grid gap-2 lg:grid-cols-2">
              {posting.map((s) => (
                <div
                  key={s.slug}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border-subtle bg-surface-2 px-4 py-3"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-medium text-text-primary">{s.name}</span>
                    {s.amount && <span className="shrink-0 text-[12px] text-text-muted">{s.amount}</span>}
                  </div>
                  <Badge color="emerald" className="shrink-0">Posting detected</Badge>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Monitor */}
        <section>
          <SectionLabel icon={<Eye size={12} className="text-text-tertiary" />} className="mb-3">
            Monitor ({monitoring.length})
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
      </div>
    </Shell>
  );
}
