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
 * Rate-limited to 1 scan per 15 minutes via the shared dashboard-web/lib/
 * rate-limit helper (scan-jobs kind). Override is by waiting; v1 does not
 * expose a force flag at the HTTP layer (the chat-UI confirmation card will
 * surface "Last scan: 4h ago · still cooling" via formatLastRunAgo).
 *
 * Returns:
 *   202 { job_id, status: "running", started_at, log_path } — job kicked off
 *   429 { error: "rate_limited", retryAfterSeconds } — cooldown active
 *   500 { error } — spawn failed
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
import { kickoffScanJob, readJobRecord } from "@/lib/scan-jobs";

export const dynamic = "force-dynamic";

export async function POST() {
  // ── Rate limit ───────────────────────────────────────────────────────────
  const cooldown = checkCooldown("scan-jobs");
  if (cooldown) {
    const { body, headers, status } = cooldownResponseJson(cooldown);
    return Response.json(body, { status, headers });
  }

  // ── Kick off the scan + chain enrichment ─────────────────────────────────
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
