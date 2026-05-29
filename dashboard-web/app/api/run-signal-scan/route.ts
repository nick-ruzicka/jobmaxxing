/**
 * POST /api/run-signal-scan
 *
 * Kicks off a signal-pipeline scan: spawns scripts/scan-signals.mjs
 * detached, returns the job_id immediately. Unlike trigger_scan, this does
 * NOT chain enrichment — signal scans produce a separate report at
 * reports/signal-scan-<date>.md and append high-conviction targets to
 * data/pipeline.md without going through the role-enrichment path.
 *
 * See docs/audits/2026-05-29-triggered-actions-scope.md (Decision 1).
 *
 * Body (optional): { force?: boolean }  — see run-scan/route.ts for the
 * shape; force=true bypasses cooldown but NOT the in-flight lock.
 *
 * Rate-limited to 1 scan per 15 minutes (scan-signals kind). Cooldown only
 * sets on successful completion (intentional: retry on failure is fine).
 *
 * Returns:
 *   202 { job_id, status, started_at, log_path, forced }
 *   409 { error: "concurrent_job_active", existing_job_id }
 *   429 { error: "rate_limited", retryAfterSeconds }
 *   500 { error }
 *
 * GET /api/run-signal-scan?job_id=<id> — JobRecord polling endpoint.
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
  let body: { force?: boolean } = {};
  try {
    const text = await request.text();
    if (text.trim().length > 0) body = JSON.parse(text);
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const force = body.force === true;

  if (!force) {
    const cooldown = checkCooldown("scan-signals");
    if (cooldown) {
      const { body: errBody, headers, status } = cooldownResponseJson(cooldown);
      return Response.json(errBody, { status, headers });
    }
  }

  const active = getActiveJobsByKind("scan-signals");
  if (active.length > 0) {
    return Response.json(
      {
        error: "concurrent_job_active",
        message:
          `A scan-signals scan is already running (job_id=${active[0].job_id}, ` +
          `started ${active[0].started_at}). Wait for it to finish before kicking off another.`,
        existing_job_id: active[0].job_id,
        existing_started_at: active[0].started_at,
      },
      { status: 409 },
    );
  }

  let record;
  try {
    record = kickoffScanJob({ kind: "scan-signals" });
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
      last_run_ago: formatLastRunAgo("scan-signals"),
      last_run: readLastRunPublic("scan-signals"),
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
