/**
 * Shared cooldown / rate-limit helper for trigger endpoints (briefing
 * regenerate, scan-jobs, scan-signals). Lifted from the inline pattern in
 * `app/api/briefing/regenerate/route.ts` so all three endpoints share one
 * implementation, plus introduced for the Step 8 scan tools (15-min
 * cooldowns vs the briefing's 5-min).
 *
 * Cooldown state lives in per-kind JSON sidecars under `data/` — one file
 * per logical job kind so back-to-back invocations of different kinds don't
 * clobber each other's throttle:
 *
 *   data/briefings/last-regen-daily.json           — briefing regenerate
 *   data/briefings/last-regen-pipeline-health.json
 *   data/scans/last-scan-jobs.json                  — trigger_scan
 *   data/scans/last-scan-signals.json               — trigger_signal_scan
 *
 * Schema (per sidecar):
 *
 *   { kind: string, at: ISO-timestamp }
 *
 * Both checkCooldown() and recordRun() use kind-as-string rather than an
 * enum so callers can extend without modifying this file. Unknown kinds are
 * treated as never-having-run (effectively bypass cooldown until the first
 * run records).
 *
 * Why a shared lib rather than inline per-route: when PR (b)'s
 * `trigger_scan` tool wants to surface "last scan: 4h ago" in its
 * confirmation preview, it needs to read the same sidecar the endpoint
 * writes — and it shouldn't reimplement the path-derivation logic. One
 * source of truth.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";

interface LastRunRecord {
  kind: string;
  at: string; // ISO timestamp
}

/** Cooldown windows for each known kind. Constants live here so the route
 *  files and the agent's tool-preview builder agree on the policy without
 *  duplicating the number. */
export const COOLDOWNS = {
  "briefing-daily": 5 * 60_000,
  "briefing-pipeline-health": 5 * 60_000,
  "scan-jobs": 15 * 60_000,
  "scan-signals": 15 * 60_000,
} as const;

export type CooldownKind = keyof typeof COOLDOWNS;

/** Project root from a Next.js route handler (Next runs from
 *  dashboard-web/, data/ lives one level up). Centralized so a future
 *  productization tweak (e.g. configurable data root) only edits one site. */
function projectRoot(): string {
  return join(process.cwd(), "..");
}

/** Resolve the sidecar file path for a given kind. The file may not exist
 *  yet — callers should treat absent as "never ran" and proceed. */
export function sidecarPathFor(kind: CooldownKind): string {
  switch (kind) {
    case "briefing-daily":
      return join(projectRoot(), "data", "briefings", "last-regen-daily.json");
    case "briefing-pipeline-health":
      return join(projectRoot(), "data", "briefings", "last-regen-pipeline-health.json");
    case "scan-jobs":
      return join(projectRoot(), "data", "scans", "last-scan-jobs.json");
    case "scan-signals":
      return join(projectRoot(), "data", "scans", "last-scan-signals.json");
  }
}

function readLastRun(kind: CooldownKind): LastRunRecord | null {
  const path = sidecarPathFor(kind);
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8")) as Partial<LastRunRecord>;
    if (typeof raw.at !== "string") return null;
    return { kind: raw.kind ?? kind, at: raw.at };
  } catch {
    return null;
  }
}

/** Read the last-run record without checking cooldown — used by tool
 *  preview builders that want to surface "last ran: 4h ago" to the user
 *  before they confirm. */
export function readLastRunPublic(kind: CooldownKind): LastRunRecord | null {
  return readLastRun(kind);
}

/** Check whether `kind` is currently in cooldown. Returns null when the
 *  caller can proceed; returns a structured CooldownActive when blocked.
 *  Callers shape the 429 / preview from this. */
export interface CooldownActive {
  kind: CooldownKind;
  last_at: string;
  elapsed_ms: number;
  retry_after_ms: number;
  window_ms: number;
}

export function checkCooldown(kind: CooldownKind): CooldownActive | null {
  const last = readLastRun(kind);
  if (!last) return null;
  const elapsed = Date.now() - new Date(last.at).getTime();
  const windowMs = COOLDOWNS[kind];
  if (elapsed >= windowMs) return null;
  return {
    kind,
    last_at: last.at,
    elapsed_ms: elapsed,
    retry_after_ms: windowMs - elapsed,
    window_ms: windowMs,
  };
}

/** Record that `kind` just finished a run. Writes the sidecar atomically
 *  (best-effort: same write-then-rename guard as the rest of the
 *  codebase). Creates the parent directory if missing. */
export function recordRun(kind: CooldownKind, at: Date = new Date()): void {
  const path = sidecarPathFor(kind);
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const record: LastRunRecord = { kind, at: at.toISOString() };
  writeFileSync(path, JSON.stringify(record, null, 2) + "\n");
}

/** Format a CooldownActive into a Response payload matching the existing
 *  briefing/regenerate route's 429 shape (preserved for backward compat). */
export function cooldownResponseJson(active: CooldownActive) {
  const retryAfterSeconds = Math.ceil(active.retry_after_ms / 1000);
  const elapsedSeconds = Math.round(active.elapsed_ms / 1000);
  return {
    body: {
      error: "rate_limited",
      message:
        `Hold on — last ${active.kind} was ${elapsedSeconds}s ago. ` +
        `Try again in ${retryAfterSeconds}s.`,
      retryAfterSeconds,
    } as const,
    headers: { "Retry-After": String(retryAfterSeconds) } as const,
    status: 429 as const,
  };
}

/** Format "Xs ago" / "Xm ago" / "Xh ago" for human-readable preview text
 *  (used by tool confirmation cards). Returns null when there's no record
 *  so callers can render "never run" in their own voice. */
export function formatLastRunAgo(kind: CooldownKind): string | null {
  const last = readLastRun(kind);
  if (!last) return null;
  const elapsed = Date.now() - new Date(last.at).getTime();
  if (elapsed < 60_000) return `${Math.round(elapsed / 1000)}s ago`;
  if (elapsed < 3_600_000) return `${Math.round(elapsed / 60_000)}m ago`;
  if (elapsed < 86_400_000) return `${Math.round(elapsed / 3_600_000)}h ago`;
  return `${Math.round(elapsed / 86_400_000)}d ago`;
}
