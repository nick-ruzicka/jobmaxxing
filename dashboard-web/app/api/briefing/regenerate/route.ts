/**
 * POST /api/briefing/regenerate
 *
 * Runs scripts/generate-briefing.mjs synchronously (child_process.execFile,
 * awaited) and returns the freshly written briefing. Rate-limited server-side
 * to 1 regen per 5 minutes via data/briefings/last-regen.json — otherwise the
 * Regenerate button is a token-budget footgun.
 *
 * Returns:
 *   200 { briefing }     — fresh briefing JSON ({ date, generated_at, items })
 *   400 { error, kind }  — invalid request (currently unused; reserved)
 *   429 { error, retryAfterSeconds } — rate-limited; client should toast
 *   500 { error }        — generator failed (env vars missing, Claude API down, etc.)
 */

import { execFile } from "child_process";
import { promisify } from "util";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import type { Briefing } from "@/lib/types";

export const dynamic = "force-dynamic";

const execFileAsync = promisify(execFile);

// 5 minutes — matches the spec.
const RATE_LIMIT_MS = 5 * 60_000;

function todayDateString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Project root — Next.js runs from dashboard-web/, the script lives one up. */
function projectRoot(): string {
  return join(process.cwd(), "..");
}

interface LastRegen {
  kind: "daily" | "pipeline-health";
  at: string; // ISO timestamp
}

function readLastRegen(kind: "daily" | "pipeline-health"): LastRegen | null {
  const path = join(projectRoot(), "data", "briefings", "last-regen.json");
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8")) as LastRegen;
    // The file tracks the *most recent* regen — if it's a different kind than
    // the one being requested, don't rate-limit; each kind is independently
    // throttled in practice because they pull on different surfaces.
    if (raw.kind !== kind) return null;
    return raw;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  // Optional `?kind=pipeline-health` for Task 4's mirror route — defaults to daily.
  const url = new URL(request.url);
  const kindParam = url.searchParams.get("kind");
  const kind: "daily" | "pipeline-health" =
    kindParam === "pipeline-health" ? "pipeline-health" : "daily";

  // 1) Rate limit.
  const last = readLastRegen(kind);
  if (last) {
    const elapsed = Date.now() - new Date(last.at).getTime();
    if (elapsed < RATE_LIMIT_MS) {
      const retryAfterSeconds = Math.ceil((RATE_LIMIT_MS - elapsed) / 1000);
      return Response.json(
        {
          error: "rate_limited",
          message: `Hold on — last regen was ${Math.round(elapsed / 1000)}s ago. Try again in ${retryAfterSeconds}s.`,
          retryAfterSeconds,
        },
        { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } }
      );
    }
  }

  // 2) Spawn the generator. We pipe stdin/stdout/stderr through execFileAsync —
  // the script logs progress to stderr (`[briefing] …`) and writes the briefing
  // JSON to disk; stdout receives the same JSON for convenience but we don't
  // rely on it, we re-read the file below as the source of truth.
  const root = projectRoot();
  const scriptPath = join(root, "scripts", "generate-briefing.mjs");
  const scriptArgs = kind === "pipeline-health" ? ["--kind=pipeline-health"] : [];

  try {
    await execFileAsync("node", [scriptPath, ...scriptArgs], {
      cwd: root,
      // Inherit the parent env so ANTHROPIC_API_KEY (loaded by Next from .env)
      // flows through; the script also re-reads .env as a fallback.
      env: { ...process.env },
      // Buffer well above what the script emits — the briefing JSON is small
      // but verbose progress logs add up.
      maxBuffer: 4 * 1024 * 1024,
      // 90s ceiling — Claude calls usually complete in 5-15s. If we hit this
      // the API is degraded and surfacing as a 500 is the right call.
      timeout: 90_000,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: "generator_failed", message }, { status: 500 });
  }

  // 3) Re-read the file from disk. The script writes the canonical filename;
  // this also catches the edge case where the script succeeded but the file
  // is missing for some other reason (permissions, etc.).
  const date = todayDateString();
  const prefix = kind === "pipeline-health" ? "pipeline-health-" : "";
  const briefingPath = join(root, "data", "briefings", `${prefix}${date}.json`);
  if (!existsSync(briefingPath)) {
    return Response.json(
      { error: "generator_silent", message: "Script exited 0 but no briefing file was written." },
      { status: 500 }
    );
  }

  try {
    const briefing = JSON.parse(readFileSync(briefingPath, "utf-8")) as Briefing;
    return Response.json({ briefing });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: "briefing_parse_failed", message }, { status: 500 });
  }
}
