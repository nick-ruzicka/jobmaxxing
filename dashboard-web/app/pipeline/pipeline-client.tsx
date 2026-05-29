"use client";

import { useState, useMemo, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { RefreshCw, Radio, ArrowLeft, MessageCircle } from "lucide-react";
import Link from "next/link";
import type { Briefing, BriefingItem, Role, RoleStatus, ScanStats } from "@/lib/types";
import { computePipelineStats } from "@/lib/stats";
import { getOpenRolesForCompany } from "@/lib/role-matching";
import { Shell } from "@/components/Shell";
import { StatStrip } from "@/components/StatStrip";
import { PipelineTable } from "@/components/PipelineTable";
import { MorningBriefing } from "@/components/MorningBriefing";
import { PageHeader, Button, Toast, type ToastKind } from "@/components/ui";
import { useScan } from "@/components/ScanContext";
import { useChat } from "@/components/ChatContext";

// Toast lifecycle, in ms. Fade-out begins LIFETIME_MS - FADE_MS so the
// 300ms opacity transition completes exactly as the node unmounts.
const TOAST_LIFETIME_MS = 3000;
const TOAST_FADE_MS = 300;

type ToastEntry = { id: number; kind: ToastKind; message: string; removing: boolean };

interface PipelinePageProps {
  roles: Role[];
  serverMeta: { hasWarmLeads: boolean; lastScanDate: string };
  highConviction: number;
  companyCount: number;
  signalCount: number;
  /** Today's briefing. Null when the generator hasn't run yet; the briefing
   *  card is hidden in that case. Rendered as a top panel above the table
   *  per the AI feature audit Step 2. */
  briefing: Briefing | null;
}

/** Lives inside <Shell> so it can read the scan controls from context. The
 *  Ask Agent button opens the global chat panel (no scoped item). */
function PipelineHeader({ roleCount, lastScanDate }: { roleCount: number; lastScanDate: string }) {
  const { runScan, scanRunning } = useScan();
  const { openChat } = useChat();
  return (
    <PageHeader
      title="Pipeline"
      subtitle={`${roleCount} ${roleCount === 1 ? "role" : "roles"}`}
      actions={
        <>
          {lastScanDate && (
            // Demoted from a stat card to incidental metadata — it's not a KPI,
            // it's a freshness marker on the action that produced the data.
            <span className="mr-1 hidden text-[12px] tabular-nums text-text-muted sm:inline">
              Last scan: {lastScanDate}
            </span>
          )}
          <Button
            variant="secondary"
            onClick={() => openChat(null)}
            title="Open the agent chat panel (⌘K)"
          >
            <MessageCircle size={14} />
            Ask agent
          </Button>
          <Button
            variant="secondary"
            onClick={() => runScan("scan")}
            disabled={scanRunning}
            title="Job boards + Exa + Similar"
          >
            <RefreshCw size={14} className={scanRunning ? "animate-spin" : ""} />
            Run Scan
          </Button>
          <Button
            variant="secondary"
            onClick={() => runScan("signal")}
            disabled={scanRunning}
            title="Funding + hiring-intent signals"
          >
            <Radio size={14} />
            Signal Scan
          </Button>
        </>
      }
    />
  );
}

export function PipelinePage({
  roles: initialRoles,
  serverMeta,
  highConviction,
  companyCount,
  signalCount,
  briefing: initialBriefing,
}: PipelinePageProps) {
  const searchParams = useSearchParams();
  const companyFilter = searchParams.get("company") || "";
  const fromSignals = searchParams.get("from") === "signals";

  const [roles, setRoles] = useState(initialRoles);

  // Global chat: open + scope a briefing item from anywhere. Lives in
  // ChatContext (root layout) so it follows the user across routes.
  const { openChat } = useChat();

  // Briefing state — kept locally so the Regenerate handler can swap in
  // a fresh briefing without a hard reload. Initialized from server props.
  const [briefing, setBriefing] = useState<Briefing | null>(initialBriefing);
  const [refreshing, setRefreshing] = useState(false);

  // When the URL filters to a single company, narrow `roles` through the
  // canonical predicate (lib/role-matching.ts). Without this, a signal
  // card click that lands here as ?company=mistralai falls through to a
  // string-search prefill, and "mistralai" doesn't match the role's
  // company text ("Mistral") — the user sees 0/1262 even though there's
  // a real role. ISSUE-002.
  const companyMatchedRoles = useMemo(() => {
    if (!companyFilter) return roles;
    return getOpenRolesForCompany(roles, companyFilter, { includeAggregators: true });
  }, [roles, companyFilter]);

  // Display name for the company filter banner: pick whichever name the
  // first matched role spells the company with. Falls back to the raw slug
  // when there are no matches (a stale signal pointing at a company that's
  // since left the dataset).
  const companyFilterDisplayName = useMemo(() => {
    if (!companyFilter) return "";
    return companyMatchedRoles[0]?.company || companyFilter;
  }, [companyFilter, companyMatchedRoles]);

  // Stats recompute on roles mutation (status edits drag rows between buckets).
  const stats: ScanStats = useMemo(
    () => computePipelineStats(roles, serverMeta),
    [roles, serverMeta]
  );

  // Header count: the non-aggregator pipeline size (stable; the filter bar shows the filtered count).
  const pipelineCount = useMemo(
    () => roles.filter((r) => r.source_tier !== "aggregator").length,
    [roles]
  );

  // Toast queue. Each toast lives in `toasts`, has a fade-out flag flipped at
  // LIFETIME-FADE and is removed at LIFETIME. nextToastId is a ref so the IDs
  // are unique even when toasts fire back-to-back within the same tick.
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const nextToastId = useRef(1);

  function pushToast(kind: ToastKind, message: string) {
    const id = nextToastId.current++;
    setToasts((prev) => [...prev, { id, kind, message, removing: false }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, removing: true } : t)));
    }, TOAST_LIFETIME_MS - TOAST_FADE_MS);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, TOAST_LIFETIME_MS);
  }

  // Regenerate today's briefing — rate-limited server-side to 1 / 5 min via
  // data/briefings/last-regen.json. Ported from today-client.tsx when the
  // briefing moved to /pipeline per AI feature audit Step 2.
  async function handleRefresh() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const res = await fetch("/api/briefing/regenerate", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (res.status === 429) {
        pushToast("error", body.message ?? "Hold on — regen is rate-limited (1 / 5 min).");
        return;
      }
      if (res.status === 402 && body.error === "credits_exhausted") {
        pushToast("error", body.message ?? "Anthropic credits exhausted. Top up to regenerate.");
        return;
      }
      if (!res.ok) {
        pushToast("error", body.message ?? "Couldn't regenerate — check the server logs.");
        return;
      }
      setBriefing(body.briefing as Briefing);
      pushToast(
        "success",
        `Regenerated · ${body.briefing.items.length} item${body.briefing.items.length === 1 ? "" : "s"}`,
      );
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : "Regen failed");
    } finally {
      setRefreshing(false);
    }
  }

  // Open the global chat panel scoped to a specific briefing item. Wired into
  // MorningBriefing's onItemAsk prop.
  function openChatForItem(item: BriefingItem) {
    openChat(item);
  }

  async function handleStatusChange(url: string, status: RoleStatus) {
    const role = roles.find((r) => r.url === url);
    const prevStatus = role?.status;
    // Optimistic local update — keep the UI responsive whether the network
    // call succeeds or not. The toast is the truthful signal.
    setRoles((prev) => prev.map((r) => (r.url === url ? { ...r, status } : r)));
    try {
      const res = await fetch("/api/update-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, status, company: role?.company, title: role?.title }),
      });
      if (!res.ok) throw new Error(`update-status returned ${res.status}`);
      if (prevStatus && prevStatus !== status) {
        pushToast("success", `Status updated: ${prevStatus} → ${status}`);
      }
    } catch {
      pushToast("error", "Couldn't save — retry?");
    }
  }

  function handleNotesChange(url: string, notes: string) {
    setRoles((prev) => prev.map((r) => (r.url === url ? { ...r, notes } : r)));
  }

  return (
    <Shell
      activePursuing={stats.activelyPursuing}
      highConviction={highConviction}
      companyCount={companyCount}
      signalCount={signalCount}
      hasWarmLeads={serverMeta.hasWarmLeads}
    >
      <PipelineHeader roleCount={pipelineCount} lastScanDate={stats.lastScanDate} />
      <div className="space-y-6">
        {fromSignals && (
          <div className="flex flex-col gap-1">
            <Link href="/signals" className="inline-flex items-center gap-1.5 text-[13px] text-text-muted hover:text-text-secondary transition-colors">
              <ArrowLeft size={12} />
              Back to Signals
            </Link>
            {/* ISSUE-005: when you arrive from a signal card we cleared the
                default 4+ score filter so every canonical role for that
                company shows. Otherwise low-scored roles get hidden by a
                default the user never chose, defeating the point of the
                signal link. */}
            <span className="text-[12px] text-text-muted">
              Showing all roles · default score filter cleared
            </span>
          </div>
        )}
        {companyFilter && (
          <div className="flex items-center justify-between rounded-lg border border-border-subtle bg-surface-2 px-4 py-3 text-[13px]">
            <div className="flex flex-col gap-0.5">
              <span className="text-text-secondary">
                Filtering to <span className="font-medium text-text-primary">{companyFilterDisplayName}</span>
                <span className="ml-2 text-text-muted">
                  ({companyMatchedRoles.length} role{companyMatchedRoles.length === 1 ? "" : "s"})
                </span>
              </span>
              {companyMatchedRoles.length === 0 && (
                <span className="text-text-muted">
                  No open roles for this company right now — the signal that flagged it may be stale.
                </span>
              )}
            </div>
            <Link href="/pipeline" className="text-accent hover:underline">
              Clear filter
            </Link>
          </div>
        )}
        {/* Briefing panel — rendered when a briefing exists for today. Shows
            above the table per the AI feature audit Step 2 (briefing-in-context
            rather than briefing-as-destination). Hidden when companyFilter is
            set, so the user landing on /pipeline?company=X focuses on the
            filtered table rather than the unrelated daily briefing. */}
        {briefing && !companyFilter && (
          <MorningBriefing
            items={briefing.items}
            lastGenerated={new Date(briefing.generated_at)}
            onRefresh={handleRefresh}
            refreshing={refreshing}
            onItemAsk={openChatForItem}
          />
        )}
        <StatStrip stats={stats} />
        <PipelineTable
          roles={companyMatchedRoles}
          onStatusChange={handleStatusChange}
          onNotesChange={handleNotesChange}
          initialSearch=""
          defaultMinScore={fromSignals ? 0 : 4}
        />
      </div>

      {/* Toast queue — fixed bottom-right, stacks newest-on-top. Lives outside
          the scrollable container so it stays put as the user scrolls the table. */}
      {toasts.length > 0 && (
        <div
          aria-live="polite"
          aria-atomic="false"
          className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2"
        >
          {toasts.map((t) => (
            <div key={t.id} className="pointer-events-auto">
              <Toast kind={t.kind} message={t.message} removing={t.removing} />
            </div>
          ))}
        </div>
      )}
    </Shell>
  );
}
