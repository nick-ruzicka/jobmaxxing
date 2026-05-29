/**
 * POST /api/briefing/regenerate
 *
 * Runs scripts/generate-briefing.mjs and returns the freshly written
 * briefing. Two response modes:
 *
 *   Default (no query string)  — backward compat for the dashboard's
 *     Regenerate button. execFile + await, returns 200 { briefing }.
 *
 *   ?progress=sse  — Step 8 agent-tool path. Spawns the script with
 *     --progress-json, streams JSONL events as SSE { type: "tool_progress",
 *     ... } to the client. Emits a final { type: "tool_finished", ok,
 *     summary, briefing } event before closing. The agent's executeMutating-
 *     Tool consumes this stream.
 *
 * Rate-limited server-side to 1 regen per 5 minutes via the shared
 * dashboard-web/lib/rate-limit helper (briefing-daily kind).
 *
 * Returns:
 *   200 { briefing }     — default mode; freshly generated briefing
 *   200 SSE              — ?progress=sse mode; tool_progress / tool_finished
 *   400 { error, kind }  — invalid request (currently unused; reserved)
 *   402 { error, ...}    — Anthropic credits exhausted
 *   429 { error, retryAfterSeconds } — rate-limited
 *   500 { error }        — generator failed
 */

import { execFile, spawn } from "child_process";
import { promisify } from "util";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import type { Briefing } from "@/lib/types";
import {
  checkCooldown,
  cooldownResponseJson,
  type CooldownKind,
} from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const execFileAsync = promisify(execFile);

function todayDateString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Project root — Next.js runs from dashboard-web/, the script lives one up. */
function projectRoot(): string {
  return join(process.cwd(), "..");
}

/** Read and parse the freshly generated briefing file. Returns null when
 *  the script exited 0 but no file is present (permissions / unexpected
 *  early exit / etc.). */
function readBriefingFile(kind: "daily" | "pipeline-health"): Briefing | null {
  const date = todayDateString();
  const prefix = kind === "pipeline-health" ? "pipeline-health-" : "";
  const briefingPath = join(projectRoot(), "data", "briefings", `${prefix}${date}.json`);
  if (!existsSync(briefingPath)) return null;
  try {
    return JSON.parse(readFileSync(briefingPath, "utf-8")) as Briefing;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const url = new URL(request.url);
  const kindParam = url.searchParams.get("kind");
  const kind: "daily" | "pipeline-health" =
    kindParam === "pipeline-health" ? "pipeline-health" : "daily";
  const cooldownKind: CooldownKind =
    kind === "pipeline-health" ? "briefing-pipeline-health" : "briefing-daily";
  const streamMode = url.searchParams.get("progress") === "sse";

  // ── 1) Rate limit ────────────────────────────────────────────────────────
  const cooldown = checkCooldown(cooldownKind);
  if (cooldown) {
    const { body, headers, status } = cooldownResponseJson(cooldown);
    return Response.json(body, { status, headers });
  }

  const root = projectRoot();
  const scriptPath = join(root, "scripts", "generate-briefing.mjs");
  const baseArgs = kind === "pipeline-health" ? ["--kind=pipeline-health"] : [];

  // ── 2a) Default mode — execFile + JSON response (backward compat) ────────
  if (!streamMode) {
    try {
      await execFileAsync("node", [scriptPath, ...baseArgs], {
        cwd: root,
        env: { ...process.env },
        maxBuffer: 4 * 1024 * 1024,
        timeout: 90_000,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("CREDITS_EXHAUSTED")) {
        return Response.json(
          {
            error: "credits_exhausted",
            message:
              "Anthropic API credits are exhausted. Top up to regenerate the briefing: https://console.anthropic.com/settings/billing",
            topUpUrl: "https://console.anthropic.com/settings/billing",
          },
          { status: 402 },
        );
      }
      return Response.json({ error: "generator_failed", message }, { status: 500 });
    }

    const briefing = readBriefingFile(kind);
    if (!briefing) {
      return Response.json(
        { error: "generator_silent", message: "Script exited 0 but no briefing file was written." },
        { status: 500 },
      );
    }
    // The script writes its own last-regen-<kind>.json on success — the lib's
    // checkCooldown reads the same file via sidecarPathFor, so the next
    // request sees the cooldown without us calling recordRun here.
    return Response.json({ briefing });
  }

  // ── 2b) SSE mode — agent-tool path ───────────────────────────────────────
  // Spawn the script with --progress-json. Each stdout line is one progress
  // event the script wrote via scripts/lib/progress.mjs. We pipe those events
  // straight through to the chat client as tool_progress, then emit a
  // tool_finished event when the child exits.
  const args = [scriptPath, ...baseArgs, "--progress-json"];
  const child = spawn("node", args, {
    cwd: root,
    env: { ...process.env },
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      function send(payload: unknown) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      }

      let buffer = "";
      let lastEvent: Record<string, unknown> | null = null;
      let creditsExhausted = false;
      let stderr = "";

      child.stdout?.on("data", (chunk: Buffer) => {
        buffer += chunk.toString("utf-8");
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line) as Record<string, unknown>;
            lastEvent = event;
            // Forward as tool_progress — the chat client's consumeChatStream
            // dispatches this to the progress widget.
            send({ type: "tool_progress", event });
          } catch {
            // Non-JSON on stdout shouldn't happen with --progress-json (the
            // lib reroutes console.log + process.stdout.write to stderr),
            // but if it does we silently swallow rather than corrupt the SSE
            // stream. The line is still in the cron logs / stderr buffer.
          }
        }
      });

      child.stderr?.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf-8");
        stderr += text;
        if (text.includes("CREDITS_EXHAUSTED")) creditsExhausted = true;
      });

      child.on("close", (code) => {
        const briefing = readBriefingFile(kind);
        if (creditsExhausted) {
          send({
            type: "tool_finished",
            ok: false,
            error: "credits_exhausted",
            summary:
              "Anthropic API credits are exhausted. Top up to regenerate: https://console.anthropic.com/settings/billing",
          });
        } else if (code !== 0) {
          send({
            type: "tool_finished",
            ok: false,
            error: "generator_failed",
            summary: `Briefing regen failed with exit code ${code}.`,
            stderr_tail: stderr.slice(-500),
          });
        } else if (!briefing) {
          send({
            type: "tool_finished",
            ok: false,
            error: "generator_silent",
            summary: "Script exited 0 but no briefing file was written.",
          });
        } else {
          // Pull the structured summary out of the script's `done` event so
          // the tool_result text mirrors the script's own summary line.
          const summary =
            (lastEvent?.type === "done" && typeof lastEvent.summary === "string"
              ? (lastEvent.summary as string)
              : `Regenerated briefing — ${briefing.items.length} items.`);
          send({ type: "tool_finished", ok: true, summary, briefing });
        }
        controller.close();
      });

      child.on("error", (err) => {
        send({
          type: "tool_finished",
          ok: false,
          error: "spawn_failed",
          summary: `Failed to spawn briefing script: ${err.message}`,
        });
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
