/**
 * POST /api/scans/cancel
 *
 * SIGTERMs an in-flight scan job. Marks the record status="cancelled" with
 * cancelled_at (and optional cancel_reason) BEFORE signaling, so the in-
 * process close listener can detect the cancel-vs-crash distinction and
 * preserve the cancelled state rather than overwriting it to "failed".
 *
 * Body:
 *   {
 *     job_id: string,   // required; the id from /api/run-scan or run-signal-scan
 *     reason?: string   // optional user-supplied; surfaced in tool_result + record
 *   }
 *
 * Returns:
 *   200 { ok: true, record }
 *   400 { error: "invalid_json" | "missing_job_id" | "already_finalized", ... }
 *   404 { error: "not_found" }
 *   500 { error: "signal_failed" } — pid was gone or we lacked permission to signal
 *
 * Idempotent for terminal states: calling cancel on a completed/failed/
 * cancelled/interrupted record returns 400 already_finalized with the
 * current record (no side effects).
 */

import { cancelJob } from "@/lib/scan-jobs";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: { job_id?: string; reason?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const job_id = typeof body.job_id === "string" ? body.job_id.trim() : "";
  if (!job_id) {
    return Response.json(
      { error: "missing_job_id", message: "Pass { job_id: string } in the request body." },
      { status: 400 },
    );
  }

  const result = cancelJob(job_id, body.reason);
  if (result.ok) {
    return Response.json({ ok: true, record: result.record });
  }
  // Failure shapes — translate each cancelJob reason to the right HTTP code.
  switch (result.reason) {
    case "not_found":
      return Response.json(
        { error: "not_found", message: `No scan job with id ${job_id}.` },
        { status: 404 },
      );
    case "already_finalized":
      return Response.json(
        {
          error: "already_finalized",
          message: `Job ${job_id} is in terminal state '${result.record?.status}' — nothing to cancel.`,
          record: result.record,
        },
        { status: 400 },
      );
    case "no_pid":
      return Response.json(
        {
          error: "no_pid",
          message: `Job ${job_id} has no recorded pid (shouldn't happen for a running job).`,
          record: result.record,
        },
        { status: 500 },
      );
    case "signal_failed":
      return Response.json(
        {
          error: "signal_failed",
          message:
            `Failed to SIGTERM job ${job_id} — pid was already gone or we lacked ` +
            "permission. The record may still reflect the cancellation intent.",
          record: result.record,
        },
        { status: 500 },
      );
  }
  // Exhaustiveness — TS would catch a new reason at compile time; this is
  // the runtime fallback if a future cancelJob() adds a reason without
  // updating this switch.
  return Response.json(
    { error: "unknown_cancel_failure", record: result.record },
    { status: 500 },
  );
}
