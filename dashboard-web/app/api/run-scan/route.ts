/**
 * POST /api/run-scan
 *
 * Kicks off a job-pipeline scan: spawns scripts/scan-jobs.mjs detached,
 * then chains scripts/enrich-roles.mjs so the user gets scored results
 * rather than raw URLs. Returns the job_id immediately — the chat agent's
 * tool_result text becomes "[scan started · job_id=X · ETA ~5min]" so the
 * conversation stays interactive while the scan runs in the background.
 *
 * See docs/audits/2026-05-29-triggered-actions-scope.md (Decision 1, split
 * resolution: scans get the minimal-job-kickoff treatment; only briefing
 * stays sync-block).
 *
 * Body (optional): { force?: boolean }
 *   - force=true skips the 15-minute cooldown gate. Matches the chat-UI
 *     "Re-confirm with force: true to override" path from the confirmation
 *     card. Does NOT bypass the in-flight concurrency lock — even with
 *     force, you can't have two scans of the same kind running at once
 *     (resource explosion, both burning quota in parallel).
 *
 * Rate-limited to 1 scan per 15 minutes via the shared dashboard-web/lib/
 * rate-limit helper (scan-jobs kind). Cooldown only sets on successful
 * completion — failed/interrupted scans don't bump it, so the user can
 * retry on failure without waiting. Force=true bypasses the gate when the
 * cooldown is active and the user has accepted the cost.
 *
 * Returns:
 *   202 { job_id, status: "running", started_at, log_path } — job kicked off
 *   409 { error: "concurrent_job_active", existing_job_id }   — another scan-jobs run is in flight
 *   429 { error: "rate_limited", retryAfterSeconds }          — cooldown active
 *   500 { error }                                             — spawn failed
 *
 * GET /api/run-scan?job_id=<id> — returns the current JobRecord for that id,
 * or 404 if missing. Used by the chat panel's progress widget to poll status
 * after the kickoff acknowledgement.
 */

import {
  checkCooldown,
  cooldownResponseJson,
  formatLastRunAgo,
  readLastRunPublic,
} from "@/lib/rate-limit";
import { getActiveJobsByKind, kickoffScanJob, readJobRecord } from "@/lib/scan-jobs";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  // Body is optional — POST with no body is the original shape (back-compat
  // with anyone hitting this endpoint without a JSON envelope).
  let body: { force?: boolean } = {};
  try {
    const text = await request.text();
    if (text.trim().length > 0) body = JSON.parse(text);
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const force = body.force === true;

  // ── Rate limit (skippable with force=true) ──────────────────────────────
  if (!force) {
    const cooldown = checkCooldown("scan-jobs");
    if (cooldown) {
      const { body: errBody, headers, status } = cooldownResponseJson(cooldown);
      return Response.json(errBody, { status, headers });
    }
  }

  // ── In-flight concurrency lock (always; force does NOT bypass) ──────────
  // Two parallel scans of the same kind both burn quota and write to the
  // same source-of-truth files. The cooldown only catches the common case
  // after a completed scan; this catches the rare-but-real case of two
  // kickoffs before either completes (UI double-click, panic re-issue, etc).
  // We self-heal stale records during this check, so a record stuck at
  // "running" from a server crash doesn't block forever.
  const active = getActiveJobsByKind("scan-jobs");
  if (active.length > 0) {
    return Response.json(
      {
        error: "concurrent_job_active",
        message:
          `A scan-jobs scan is already running (job_id=${active[0].job_id}, ` +
          `started ${active[0].started_at}). Wait for it to finish before kicking off another.`,
        existing_job_id: active[0].job_id,
        existing_started_at: active[0].started_at,
      },
      { status: 409 },
    );
  }

  // ── Kick off the scan + chain enrichment ────────────────────────────────
  // The cron's run-scan.sh runs scan-jobs THEN enrich-roles in sequence; we
  // mirror that here so an interactive scan from chat actually produces
  // scored results. Without the chain, the agent's "Run scan" yields URLs
  // with --/10 fit until the next cron'd enrich cycle.
  let record;
  try {
    record = kickoffScanJob({
      kind: "scan-jobs",
      chained: [["enrich-roles.mjs"]],
    });
  } catch (err) {
    return Response.json(
      { error: "spawn_failed", message: err instanceof Error ? err.message : "unknown" },
      { status: 500 },
    );
  }

  return Response.json(
    {
      job_id: record.job_id,
      status: record.status,
      started_at: record.started_at,
      log_path: record.log_path,
      chained: record.chained,
      // Surfaced for the chat client so the confirmation card / status
      // widget can show "Last scan: 4h ago" without a second roundtrip.
      last_run_ago: formatLastRunAgo("scan-jobs"),
      last_run: readLastRunPublic("scan-jobs"),
      // Whether this kickoff bypassed cooldown via force=true — echoed back
      // so the UI can label it ("forced run") if it cares to.
      forced: force,
    },
    { status: 202 },
  );
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const job_id = url.searchParams.get("job_id");
  if (!job_id) {
    return Response.json({ error: "missing_job_id" }, { status: 400 });
  }
  const record = readJobRecord(job_id);
  if (!record) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  return Response.json({ record });
}
