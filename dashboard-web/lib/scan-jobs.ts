/**
 * Job-record helpers for trigger_scan / trigger_signal_scan (Step 8 PR b).
 *
 * The trigger_scan tools follow a "minimal job-kickoff" model (per
 * docs/audits/2026-05-29-triggered-actions-scope.md Decision 1, resolved):
 * the API route spawns the script detached, writes a job record to
 * `data/scans/<job_id>.json`, and returns the job_id immediately. The agent's
 * tool_result text is `[scan started · job_id=X · ETA ~5min]` — the user can
 * keep chatting; results appear in /today when the scan completes.
 *
 * Why detached + JSON-line consumption:
 *   - Detached so the Next.js process can exit cleanly without orphaning
 *     the child (a dev-mode hot reload otherwise leaves zombie scans).
 *   - The child's stdout writes JSONL events (one per progress milestone)
 *     thanks to the --progress-json flag landed in PR (a).
 *   - We pipe stdout to a per-job log file via a file descriptor so the
 *     child's writes are durable even if the route handler returns first.
 *   - An in-process listener on the child's `close` event updates the
 *     job record's `status` from `running` to `completed` / `failed`.
 *     This listener stays alive as long as the Next.js server process does;
 *     server-restart-during-scan is healed lazily on the next read via
 *     pid-check in readJobRecord (the record's status flips to
 *     "interrupted"). We deliberately don't mark these "completed" — the
 *     child may have died mid-flight without writing its final `done`
 *     event, and silently calling that a success would lie to the user.
 *
 * Job record schema (data/scans/<job_id>.json):
 *
 *   {
 *     job_id: string,
 *     kind: "scan-jobs" | "scan-signals",
 *     chained: string[],            // additional scripts run after the main one
 *     status: "running" | "completed" | "failed" | "interrupted",
 *     started_at: ISO,
 *     ended_at?: ISO,
 *     pid?: number,
 *     log_path: string,             // data/scans/<job_id>.log
 *     // The last `done` event from the script — fills in once child closes
 *     // OR (on self-heal) is extracted from the log file by tail-scan.
 *     done?: { ok: bool, summary: string, duration_ms: number, meta?: object },
 *     // Error context when status === "failed".
 *     exit_code?: number,
 *     stderr_tail?: string,
 *     // Self-heal marker (set when readJobRecord flips a stale "running"
 *     // record whose pid is no longer alive — typically a Next.js restart
 *     // mid-scan). Only present when status === "interrupted".
 *     healed_at?: string,
 *   }
 */

import { spawn } from "child_process";
import { existsSync, mkdirSync, openSync, closeSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import { recordRun, type CooldownKind } from "@/lib/rate-limit";

/** Project root — Next.js runs from dashboard-web/, scripts/ + data/ live one up. */
function projectRoot(): string {
  return join(process.cwd(), "..");
}

export type ScanKind = "scan-jobs" | "scan-signals";

export type JobStatus = "running" | "completed" | "failed" | "interrupted";

export interface JobRecord {
  job_id: string;
  kind: ScanKind;
  chained: string[];
  status: JobStatus;
  started_at: string;
  ended_at?: string;
  pid?: number;
  log_path: string;
  done?: {
    ok: boolean;
    summary: string;
    duration_ms?: number;
    meta?: Record<string, unknown>;
  };
  exit_code?: number;
  stderr_tail?: string;
  /** ISO timestamp set when readJobRecord flips a stale "running" record
   *  whose pid is dead. Only present when status === "interrupted". */
  healed_at?: string;
}

function jobRecordPath(job_id: string): string {
  return join(projectRoot(), "data", "scans", `${job_id}.json`);
}

function jobLogPath(job_id: string): string {
  return join(projectRoot(), "data", "scans", `${job_id}.log`);
}

function ensureScansDir(): void {
  const dir = join(projectRoot(), "data", "scans");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/** Probe whether a pid is still alive on this host. Uses `process.kill(pid, 0)`
 *  which doesn't actually send a kill signal — it just checks the kernel's
 *  process table:
 *    - returns normally → pid exists (still ours or someone else's)
 *    - ESRCH           → pid doesn't exist (the process we recorded is gone)
 *    - EPERM           → pid exists but we don't have permission to signal it
 *                         (still alive from our POV)
 *
 *  Pid-reuse is a theoretical false-positive (the kernel could have allocated
 *  the same pid to an unrelated process after ours exited), but in practice
 *  the wraparound on macOS/Linux is at PID_MAX (32768 / 4194304) and scans
 *  run on the order of minutes — collision odds are negligible at the rate
 *  one user's machine cycles pids. Documenting as a known limit; not worth
 *  defending against here. */
export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EPERM") return true;
    return false;
  }
}

/** Walk the log file backwards looking for the last JSONL `done` event the
 *  script emitted. Used both by kickoffScanJob's close handler AND by the
 *  self-heal in readJobRecord — the script may have written its final
 *  done event before the listener died, in which case we can recover the
 *  structured summary even on an interrupted record. */
function findLastDoneEventInLog(log_path: string): JobRecord["done"] | undefined {
  if (!existsSync(log_path)) return undefined;
  try {
    const lines = readFileSync(log_path, "utf-8").split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (!line.startsWith("{")) continue;
      try {
        const ev = JSON.parse(line) as Record<string, unknown>;
        if (ev.type === "done") {
          return {
            ok: ev.ok === true,
            summary: typeof ev.summary === "string" ? ev.summary : "(no summary)",
            duration_ms: typeof ev.duration_ms === "number" ? ev.duration_ms : undefined,
            meta: (ev.meta as Record<string, unknown>) ?? undefined,
          };
        }
      } catch {
        // Skip non-JSON lines (human-readable rerouted output).
      }
    }
  } catch {
    // Log file missing or unreadable.
  }
  return undefined;
}

/** Read a record from disk without running self-heal. Used internally by
 *  the in-process close handler in kickoffScanJob — that path already KNOWS
 *  the child just exited (we're inside the on("close") callback) and is
 *  about to write a terminal status. Routing it through self-heal would
 *  race: the self-heal sees status=running + pid=dead and writes
 *  status=interrupted + healed_at; the close handler then spreads that
 *  record and overwrites status with "completed"/"failed" but healed_at
 *  sticks around, lying about the resolution path. Bypass self-heal here. */
function readJobRecordRaw(job_id: string): JobRecord | null {
  const path = jobRecordPath(job_id);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as JobRecord;
  } catch {
    return null;
  }
}

/** Read a job record by id, returning null if missing or unparseable. Lazily
 *  self-heals stale "running" records: if the recorded pid is no longer
 *  alive (typically because Next.js restarted and killed the in-process
 *  close listener), the status flips to "interrupted" and we attempt to
 *  recover the final `done` event from the log file.
 *
 *  We deliberately don't flip to "completed" — the child may have died
 *  mid-flight before writing its done event. "interrupted" is the honest
 *  state: we don't know if it finished. The caller (UI / agent) can read
 *  the recovered `done` if present to make a better-than-nothing summary. */
export function readJobRecord(job_id: string): JobRecord | null {
  const record = readJobRecordRaw(job_id);
  if (!record) return null;
  if (record.status === "running" && typeof record.pid === "number") {
    if (!isPidAlive(record.pid)) {
      const recovered = findLastDoneEventInLog(record.log_path);
      const healed: JobRecord = {
        ...record,
        status: "interrupted",
        ended_at: record.ended_at ?? new Date().toISOString(),
        healed_at: new Date().toISOString(),
        ...(record.done ? {} : recovered ? { done: recovered } : {}),
      };
      writeJobRecord(healed);
      return healed;
    }
  }
  return record;
}

/** Write a job record atomically-enough. Same write-then-it's-there pattern
 *  the rest of the codebase uses; no rename dance because we control the
 *  one path and don't need crash-consistency for these. */
function writeJobRecord(record: JobRecord): void {
  ensureScansDir();
  writeFileSync(jobRecordPath(record.job_id), JSON.stringify(record, null, 2) + "\n");
}

interface KickoffOptions {
  kind: ScanKind;
  /** Args passed to the primary script. --progress-json is appended
   *  automatically; callers don't need to include it. */
  primaryArgs?: string[];
  /** Additional scripts to run AFTER the primary one completes successfully.
   *  Each entry is `[scriptName, ...args]`. Used for the scan-jobs → enrich-
   *  roles chain (Decision per task #44: trigger_scan ALWAYS chains
   *  enrichment so the user gets scored results, not raw URLs).
   *
   *  Chained scripts run sequentially; if any fails, the chain aborts and
   *  the job record reflects the first failure. */
  chained?: Array<[string, ...string[]]>;
}

/** Kick off a scan job: spawn the primary script detached, write the job
 *  record, schedule chained scripts (if any), and return the job_id. The
 *  caller's response should be sent immediately after this returns — the
 *  child keeps running in the background.
 *
 *  Throws on synchronous spawn failures (missing script, etc.) — the route
 *  should catch and return 500. Async failures (child exits non-zero, etc.)
 *  are recorded in the job record, not thrown. */
export function kickoffScanJob(opts: KickoffOptions): JobRecord {
  ensureScansDir();
  const job_id = randomUUID();
  const log_path = jobLogPath(job_id);
  const chained = (opts.chained ?? []).map((c) => c[0]);

  const initial: JobRecord = {
    job_id,
    kind: opts.kind,
    chained,
    status: "running",
    started_at: new Date().toISOString(),
    log_path,
  };
  writeJobRecord(initial);

  const root = projectRoot();
  const primaryScript = opts.kind === "scan-jobs" ? "scan-jobs.mjs" : "scan-signals.mjs";

  // Open the log file once; the child writes stdout AND stderr there. JSONL
  // events from --progress-json land in stdout; human-readable text (cron
  // logs / rerouted console.log) lands in stderr — both end up in the same
  // file because we redirect both fds to it. The downstream status reader
  // can grep for `"type":"done"` lines if it cares about the structured tail.
  const fd = openSync(log_path, "a");

  const primaryArgs = ["--progress-json", ...(opts.primaryArgs ?? [])];
  const primary = spawn("node", [join(root, "scripts", primaryScript), ...primaryArgs], {
    cwd: root,
    env: { ...process.env },
    detached: true,
    stdio: ["ignore", fd, fd],
  });
  // Allow the Next.js process to exit without killing the scan (dev-mode
  // hot reloads). Once unref'd we don't get the child's events on the IPC
  // channel, but `close` / `error` listeners still fire — that's what we
  // need to update the job record on exit.
  primary.unref();

  initial.pid = primary.pid;
  writeJobRecord(initial);

  // Capture the last 500 chars of stderr (it's piped to the same file as
  // stdout in this version — we tail the log file on failure rather than
  // separately buffering stderr in-process).
  const captureStderrTail = (): string => {
    try {
      const log = readFileSync(log_path, "utf-8");
      return log.slice(-500);
    } catch {
      return "";
    }
  };

  // findLastDoneEventInLog is module-scoped (shared with readJobRecord's
  // self-heal path) — bind log_path here for the close handler's calls.
  const findLastDoneEvent = () => findLastDoneEventInLog(log_path);

  // Walk the chain. Each script in opts.chained is spawned only after the
  // previous one closes with exit code 0. Mid-chain failures stop the
  // walk and finalize the record.
  let chainIdx = 0;
  const queuedChained = opts.chained ?? [];
  const runNextOrFinalize = (currentExitCode: number) => {
    if (currentExitCode !== 0) {
      const record: JobRecord = {
        ...readJobRecordRaw(job_id)!,
        status: "failed",
        ended_at: new Date().toISOString(),
        exit_code: currentExitCode,
        stderr_tail: captureStderrTail(),
        done: findLastDoneEvent(),
      };
      writeJobRecord(record);
      try {
        closeSync(fd);
      } catch {
        // FD already closed — ignore.
      }
      return;
    }
    if (chainIdx >= queuedChained.length) {
      // All scripts (primary + chain) finished OK.
      const record: JobRecord = {
        ...readJobRecordRaw(job_id)!,
        status: "completed",
        ended_at: new Date().toISOString(),
        done: findLastDoneEvent(),
      };
      writeJobRecord(record);
      recordRun(opts.kind as CooldownKind);
      try {
        closeSync(fd);
      } catch {
        // FD already closed — ignore.
      }
      return;
    }
    const [nextScript, ...nextArgs] = queuedChained[chainIdx];
    chainIdx++;
    const childArgs = ["--progress-json", ...nextArgs];
    const child = spawn("node", [join(root, "scripts", nextScript), ...childArgs], {
      cwd: root,
      env: { ...process.env },
      detached: true,
      stdio: ["ignore", fd, fd],
    });
    child.unref();
    child.on("close", (code) => runNextOrFinalize(code ?? 1));
    child.on("error", () => runNextOrFinalize(1));
  };

  primary.on("close", (code) => runNextOrFinalize(code ?? 1));
  primary.on("error", (err) => {
    const record: JobRecord = {
      ...readJobRecordRaw(job_id)!,
      status: "failed",
      ended_at: new Date().toISOString(),
      exit_code: 1,
      stderr_tail: `spawn error: ${err.message}`,
    };
    writeJobRecord(record);
    try {
      closeSync(fd);
    } catch {
      // FD already closed — ignore.
    }
  });

  return initial;
}
