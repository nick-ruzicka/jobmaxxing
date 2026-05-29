// Tests for the self-heal pid-check in dashboard-web/lib/scan-jobs.ts.
//
// Scope: the readJobRecord() lazy self-heal that flips a stale "running"
// record to "interrupted" when the recorded pid is no longer alive. This is
// the v1 fix for the Next.js-restart-mid-scan limitation documented in
// docs/audits/2026-05-29-triggered-actions-scope.md.
//
// Strategy: scan-jobs.ts resolves data/scans/ relative to process.cwd() /
// "..", same trick lib/data.ts uses. We mkdtemp a project root, chdir into
// a sibling dashboard-web/, then dynamic-import scan-jobs.ts so its module-
// scoped projectRoot() resolves to our temp tree. Each test writes a fake
// job record + (optionally) a log file, then asserts readJobRecord's
// behavior on the live pid vs a dead pid.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { spawnSync } from "child_process";

let tempRoot: string;
let scansDir: string;
let originalCwd: string;
let lib: typeof import("./scan-jobs");

beforeAll(async () => {
  originalCwd = process.cwd();
  tempRoot = mkdtempSync(join(tmpdir(), "scan-jobs-test-"));
  // Mimic the real layout: <root>/data/scans + <root>/dashboard-web; we'll
  // chdir into the dashboard-web/ so projectRoot() (cwd + "..") resolves to
  // tempRoot.
  scansDir = join(tempRoot, "data", "scans");
  mkdirSync(scansDir, { recursive: true });
  const fakeDashboardWeb = join(tempRoot, "dashboard-web");
  mkdirSync(fakeDashboardWeb, { recursive: true });
  process.chdir(fakeDashboardWeb);
  lib = await import("./scan-jobs");
});

afterAll(() => {
  process.chdir(originalCwd);
  rmSync(tempRoot, { recursive: true, force: true });
});

/** Spawn a quick-exit child, wait for it to die, return its pid. The pid is
 *  guaranteed-dead at the moment we return — perfect for testing the
 *  "recorded pid is gone" branch of isPidAlive. */
function deadPid(): number {
  const result = spawnSync("node", ["-e", "process.exit(0)"]);
  // spawnSync waits for the child to exit before returning; the pid in
  // result is the one that just exited. macOS/Linux both report it.
  // If for some reason spawnSync didn't give us a pid (rare), fall back to
  // a very-unlikely-to-exist pid as a last resort.
  return result.pid ?? 99999;
}

function writeRecord(record: import("./scan-jobs").JobRecord) {
  writeFileSync(
    join(scansDir, `${record.job_id}.json`),
    JSON.stringify(record, null, 2) + "\n",
  );
}

describe("isPidAlive", () => {
  it("returns true for the current process", () => {
    expect(lib.isPidAlive(process.pid)).toBe(true);
  });

  it("returns false for a known-dead pid", () => {
    expect(lib.isPidAlive(deadPid())).toBe(false);
  });

  it("returns false for an obviously-invalid pid", () => {
    // 2^31 - 1 is a safe upper bound; both macOS and Linux reject it.
    expect(lib.isPidAlive(2147483647)).toBe(false);
  });
});

describe("readJobRecord self-heal", () => {
  it("leaves a 'running' record untouched when its pid is alive", () => {
    const record: import("./scan-jobs").JobRecord = {
      job_id: "alive-pid-001",
      kind: "scan-jobs",
      chained: [],
      status: "running",
      started_at: new Date().toISOString(),
      pid: process.pid, // our own pid, definitely alive
      log_path: join(scansDir, "alive-pid-001.log"),
    };
    writeRecord(record);
    const result = lib.readJobRecord("alive-pid-001");
    expect(result).not.toBeNull();
    expect(result!.status).toBe("running");
    expect(result!.healed_at).toBeUndefined();
  });

  it("flips 'running' → 'interrupted' when the pid is dead", () => {
    const record: import("./scan-jobs").JobRecord = {
      job_id: "dead-pid-001",
      kind: "scan-jobs",
      chained: [],
      status: "running",
      started_at: new Date(Date.now() - 60_000).toISOString(),
      pid: deadPid(),
      log_path: join(scansDir, "dead-pid-001.log"),
    };
    writeRecord(record);

    const result = lib.readJobRecord("dead-pid-001");
    expect(result).not.toBeNull();
    expect(result!.status).toBe("interrupted");
    expect(result!.healed_at).toBeTypeOf("string");
    expect(result!.ended_at).toBeTypeOf("string");
    // Critical: we did NOT flip to "completed" or "failed" — the child may
    // have died mid-flight without writing its done event. "interrupted" is
    // the honest "we don't know" state.
    expect(result!.status).not.toBe("completed");
    expect(result!.status).not.toBe("failed");

    // The flip must persist — re-reading should return the same healed
    // record without re-running the pid check on a now-"interrupted" entry.
    const fromDisk = JSON.parse(
      readFileSync(join(scansDir, "dead-pid-001.json"), "utf-8"),
    );
    expect(fromDisk.status).toBe("interrupted");
    expect(fromDisk.healed_at).toBeTypeOf("string");
  });

  it("recovers the script's final `done` event from the log file when self-healing", () => {
    const logPath = join(scansDir, "dead-with-log-001.log");
    // Write a log file that mimics what --progress-json would have left
    // behind: a start event followed by a done event with a real summary.
    // The script exited 0 but the listener died before close() fired.
    const lines = [
      JSON.stringify({ ts: "2026-05-29T20:00:00Z", kind: "scan-jobs", type: "start" }),
      JSON.stringify({
        ts: "2026-05-29T20:05:00Z",
        kind: "scan-jobs",
        type: "done",
        ok: true,
        summary: "Scanned 47 sources, 12 net-new roles.",
        duration_ms: 300000,
        meta: { net_new: 12, seen_total: 2465 },
      }),
    ];
    writeFileSync(logPath, lines.join("\n") + "\n");

    const record: import("./scan-jobs").JobRecord = {
      job_id: "dead-with-log-001",
      kind: "scan-jobs",
      chained: [],
      status: "running",
      started_at: new Date(Date.now() - 300_000).toISOString(),
      pid: deadPid(),
      log_path: logPath,
    };
    writeRecord(record);

    const result = lib.readJobRecord("dead-with-log-001");
    expect(result!.status).toBe("interrupted");
    expect(result!.done).toBeDefined();
    expect(result!.done!.ok).toBe(true);
    expect(result!.done!.summary).toBe("Scanned 47 sources, 12 net-new roles.");
    expect(result!.done!.duration_ms).toBe(300000);
    expect(result!.done!.meta?.net_new).toBe(12);
  });

  it("handles dead-pid records that have no log file gracefully", () => {
    // No log written. Self-heal still flips status, just leaves done undefined.
    const record: import("./scan-jobs").JobRecord = {
      job_id: "dead-no-log-001",
      kind: "scan-jobs",
      chained: [],
      status: "running",
      started_at: new Date(Date.now() - 60_000).toISOString(),
      pid: deadPid(),
      log_path: join(scansDir, "dead-no-log-001.log"),
    };
    writeRecord(record);

    const result = lib.readJobRecord("dead-no-log-001");
    expect(result!.status).toBe("interrupted");
    expect(result!.healed_at).toBeTypeOf("string");
    expect(result!.done).toBeUndefined();
  });

  it("preserves an existing `done` field on the record (doesn't clobber with log scan)", () => {
    // If the record somehow has done set already (atomically wrote done +
    // status="running"? edge case but possible if a future writer changes
    // order), don't overwrite it with a fresh log scan.
    const existingDone = {
      ok: true,
      summary: "Pre-set summary",
      duration_ms: 1234,
    };
    const record: import("./scan-jobs").JobRecord = {
      job_id: "dead-with-done-001",
      kind: "scan-jobs",
      chained: [],
      status: "running",
      started_at: new Date().toISOString(),
      pid: deadPid(),
      log_path: join(scansDir, "dead-with-done-001.log"),
      done: existingDone,
    };
    writeRecord(record);

    const result = lib.readJobRecord("dead-with-done-001");
    expect(result!.status).toBe("interrupted");
    expect(result!.done).toEqual(existingDone);
  });

  it("leaves 'completed' / 'failed' / 'interrupted' records alone regardless of pid state", () => {
    for (const status of ["completed", "failed", "interrupted"] as const) {
      const id = `terminal-${status}-001`;
      const record: import("./scan-jobs").JobRecord = {
        job_id: id,
        kind: "scan-jobs",
        chained: [],
        status,
        started_at: new Date(Date.now() - 60_000).toISOString(),
        ended_at: new Date().toISOString(),
        pid: deadPid(), // dead pid but status is terminal — should be untouched
        log_path: join(scansDir, `${id}.log`),
      };
      writeRecord(record);

      const result = lib.readJobRecord(id);
      expect(result!.status).toBe(status);
      expect(result!.healed_at).toBeUndefined();
    }
  });

  it("returns null when the record file doesn't exist", () => {
    expect(lib.readJobRecord("nonexistent-id")).toBeNull();
  });

  it("regression: a status='failed' record with a healed_at field from a previous read returns failed without re-self-healing", () => {
    // Reproduces the bug found during Flow B integration testing: the kickoff
    // close handler used to call readJobRecord (with self-heal) to spread
    // into its terminal-status write, which set healed_at first; the close
    // handler then overwrote status but healed_at stuck around. Symptom:
    // a properly-failed record claiming it was also self-healed.
    //
    // The fix routes internal readers through a raw read (no self-heal).
    // Defense in depth: even if a caller writes a record with healed_at +
    // status="failed", a subsequent readJobRecord should return it as-is,
    // not re-heal anything. status="running" is the only trigger.
    const record: import("./scan-jobs").JobRecord = {
      job_id: "regression-mixed-001",
      kind: "scan-jobs",
      chained: [],
      status: "failed",
      started_at: new Date(Date.now() - 60_000).toISOString(),
      ended_at: new Date().toISOString(),
      healed_at: new Date().toISOString(), // spurious holdover
      pid: deadPid(),
      log_path: join(scansDir, "regression-mixed-001.log"),
      exit_code: 143,
    };
    writeRecord(record);

    const result = lib.readJobRecord("regression-mixed-001");
    expect(result!.status).toBe("failed");
    // The spurious healed_at is preserved (we don't scrub it on read), but
    // we don't WRITE a fresh one either — the record's at-rest healed_at is
    // unchanged from what was on disk.
    expect(result!.healed_at).toBe(record.healed_at);
  });
});
