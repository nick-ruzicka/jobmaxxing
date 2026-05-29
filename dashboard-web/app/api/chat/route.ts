/**
 * POST /api/chat
 *
 * Turn-based agent chat with full pipeline + user context.
 *
 * Body: { date: "YYYY-MM-DD", message: string, item_context?: object }
 *   - date         — keys the persistence file (data/chats/<date>.json)
 *   - message      — the user's new message
 *   - item_context — optional. When the user entered via a chevron on a
 *                    briefing item, the panel passes that item's context so
 *                    the agent has the role/URL/JD context.
 *
 * Behavior (AI feature audit Step 3 — context plumbing + caching):
 *   1. Load (or initialize) the chat history for `date`
 *   2. Build a cached system block with:
 *        — base instructions
 *        — CV (cv.md)
 *        — user-context.yaml (location/comp/hard-nos/archetype_fit/etc.)
 *        — top 50 roles by score (compact one-line summaries)
 *        — recent applications (last 30 days from applications.md)
 *        — today's briefing summary
 *      Tagged with `cache_control: ephemeral` so subsequent turns within
 *      ~5 minutes hit the prompt cache (~10× cheaper per turn at scale).
 *   3. Build proper messages array (history as turns, not concatenated)
 *   4. Call Claude (single turn, non-streaming for now; streaming is the
 *      follow-up PR per audit §5a)
 *   5. Append user msg + assistant response to history, write file
 *   6. Return { reply, history, debug? }
 *
 * Returns:
 *   200 { reply: string, history: ChatMessage[], debug?: { tokens_estimate: number } }
 *   400 { error } — malformed request
 *   402 { error: "credits_exhausted", message, topUpUrl } — Anthropic balance
 *   500 { error } — Claude call failed or persistence failed
 *
 * GET /api/chat?date=YYYY-MM-DD — returns { history } for hydration on page load.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { getCompFloorUsd, formatCompFloorString } from "@/lib/comp-floor";
import { getRoles } from "@/lib/data";
import { defaultGoalFallback } from "../../../../scripts/lib/default-goal.mjs";
import type { Briefing, Role } from "@/lib/types";

export const dynamic = "force-dynamic";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  /** Briefing-item context the user attached when sending. Only set on
   *  user messages, and only when entered via the chevron path. */
  item_context?: Record<string, unknown>;
  ts: string; // ISO timestamp
}

interface ChatFile {
  date: string;
  messages: ChatMessage[];
}

function projectRoot(): string {
  return join(process.cwd(), "..");
}

function chatFilePath(date: string): string {
  return join(projectRoot(), "data", "chats", `${date}.json`);
}

function readChatFile(date: string): ChatFile {
  const path = chatFilePath(date);
  if (!existsSync(path)) return { date, messages: [] };
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as ChatFile;
  } catch {
    return { date, messages: [] };
  }
}

function writeChatFile(file: ChatFile): void {
  const dir = join(projectRoot(), "data", "chats");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(chatFilePath(file.date), JSON.stringify(file, null, 2) + "\n");
}

function readBriefingForDate(date: string): Briefing | null {
  const path = join(projectRoot(), "data", "briefings", `${date}.json`);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as Briefing;
  } catch {
    return null;
  }
}

function readUserGoals(): string {
  const path = join(projectRoot(), "modes", "_profile.md");
  if (!existsSync(path)) {
    return defaultGoalFallback(formatCompFloorString(getCompFloorUsd()));
  }
  const md = readFileSync(path, "utf-8");
  // Grab Background + Target Roles + Career Narrative — same slice the
  // briefing generator uses. Bounded so the prompt doesn't balloon.
  const sections: string[] = [];
  for (const heading of ["Background", "Your Target Roles", "Career Narrative"]) {
    const re = new RegExp(`##\\s+${heading}[\\s\\S]*?(?=\\n##\\s+|$)`, "i");
    const m = md.match(re);
    if (m) sections.push(m[0].slice(0, 2000));
  }
  return sections.join("\n\n").slice(0, 4000);
}

// ─── Context loaders ────────────────────────────────────────────────────────
// Each returns either content or null (file absent). The system-block builder
// renders an "(no X available)" line when a section is null so the agent
// knows the absence is intentional, not a parsing error.

function readCv(): string | null {
  const path = join(projectRoot(), "cv.md");
  if (!existsSync(path)) return null;
  try {
    // CVs typically run 1-10 KB; cap at 12 KB (~3K tokens) defensively.
    return readFileSync(path, "utf-8").slice(0, 12000);
  } catch {
    return null;
  }
}

function readUserContextYaml(): string | null {
  const path = join(projectRoot(), "config", "user-context.yaml");
  if (!existsSync(path)) return null;
  try {
    // user-context.yaml is small (~3 KB even with comments). No cap.
    return readFileSync(path, "utf-8");
  } catch {
    return null;
  }
}

/** Pulls the top N roles by score, returns as compact one-line summaries
 *  for the prompt. Excludes aggregator-sourced roles (they're noisier and
 *  bloat the prompt). Filters to score ≥ 4 (the dashboard's default cutoff).
 *  Format per line:
 *    "[score] Company — Role Title (status, location, comp_range) <url>"
 */
function readTopRoles(n: number): string {
  let roles: Role[];
  try {
    roles = getRoles({ includeAggregator: false });
  } catch {
    return "(role data unavailable)";
  }
  const sorted = roles
    .filter((r) => r.score >= 4)
    .sort((a, b) => b.score - a.score)
    .slice(0, n);
  if (sorted.length === 0) return "(no roles in pipeline yet)";
  return sorted
    .map((r) => {
      const score = r.score.toFixed(1);
      const comp = r.enrichment?.comp_range ? ` ${r.enrichment.comp_range}` : "";
      const loc = r.location ? ` ${r.location}` : "";
      return `[${score}] ${r.company} — ${r.title} (${r.status}${loc}${comp}) ${r.url}`;
    })
    .join("\n");
}

/** Reads recent rows from data/applications.md. Currently returns the most
 *  recent N entries by file order — applications.md is human-edited so
 *  most recent is at the top; ~30 entries is roughly 30 days of activity. */
function readRecentApplications(maxRows: number): string {
  const path = join(projectRoot(), "data", "applications.md");
  if (!existsSync(path)) return "(no applications yet)";
  try {
    const md = readFileSync(path, "utf-8");
    const rows = md
      .split("\n")
      .filter((l) => l.startsWith("|") && !l.startsWith("|#") && !l.startsWith("|--"));
    if (rows.length === 0) return "(no applications yet)";
    return rows.slice(0, maxRows).join("\n");
  } catch {
    return "(applications.md unreadable)";
  }
}

// ─── Prompt builders ────────────────────────────────────────────────────────
// Split into a stable SYSTEM block (cached via cache_control: ephemeral) and
// per-turn MESSAGES. Cache hits within ~5 minutes cut per-turn cost ~10×.

const BASE_INSTRUCTIONS = `You are the user's job-search agent, having a conversation about their pipeline. You have full context on their CV, preferences (user-context.yaml), the current pipeline (top 50 roles by score), recent applications, and today's briefing. Be concrete, candid, and specific — name companies, score numbers, surface trade-offs. Push back when the user's read of a role doesn't match what the data says. Don't pad answers.`;

const RESPONSE_GUIDELINES = `Respond directly in plain prose. No lists unless the user asks for one. Cite the role/company by name when relevant. Keep responses under ~300 words unless the user explicitly asks for more detail. If you cite a specific role, include its URL so the user can click through.`;

function buildSystemBlock(args: {
  goals: string;
  cv: string | null;
  userContextYaml: string | null;
  topRoles: string;
  recentApps: string;
  briefing: Briefing | null;
}): string {
  const { goals, cv, userContextYaml, topRoles, recentApps, briefing } = args;

  const briefingSummary = briefing
    ? briefing.items
        .map((i, idx) => `[${idx}] ${i.type}: ${i.title}${i.subtitle ? ` — ${i.subtitle}` : ""}`)
        .join("\n")
    : "(no briefing generated yet today)";

  const sections: string[] = [
    BASE_INSTRUCTIONS,
    `\n\n## User goals\n\n${goals}`,
    `\n\n## CV (cv.md)\n\n${cv ?? "(no cv.md file — user hasn't filled it in yet)"}`,
    `\n\n## User preferences (user-context.yaml)\n\n${userContextYaml ?? "(no user-context.yaml — defaults apply)"}\n`,
    `\n\n## Pipeline snapshot — top 50 roles by score\n\n${topRoles}`,
    `\n\n## Recent applications (most recent first)\n\n${recentApps}`,
    `\n\n## Today's briefing (${briefing?.date ?? "n/a"})\n\n${briefingSummary}`,
    `\n\n## Response guidelines\n\n${RESPONSE_GUIDELINES}`,
  ];
  return sections.join("");
}

/** Convert chat history + new user message into Anthropic message-turn shape.
 *  Item context, when present, is folded into the new user message as a
 *  trailing prelude so Claude has the role/URL/JD details for that item. */
function buildMessages(args: {
  history: ChatMessage[];
  itemContext: Record<string, unknown> | undefined;
  userMessage: string;
}): Array<{ role: "user" | "assistant"; content: string }> {
  const { history, itemContext, userMessage } = args;
  const turns: Array<{ role: "user" | "assistant"; content: string }> = history.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const itemContextPrelude = itemContext
    ? `\n\n---\n(The user is asking specifically about this briefing item: ${JSON.stringify(itemContext)})`
    : "";

  turns.push({ role: "user", content: userMessage + itemContextPrelude });
  return turns;
}

/** Lazy .env loader — Next.js only auto-loads .env files inside dashboard-web/,
 *  but ours lives at the worktree root (one level up) and is symlinked from
 *  the canonical repo. Read it on first miss and cache process.env. */
let envLoaded = false;
function loadWorktreeEnv() {
  if (envLoaded) return;
  envLoaded = true;
  try {
    const path = join(projectRoot(), ".env");
    if (!existsSync(path)) return;
    const raw = readFileSync(path, "utf-8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/i);
      if (!m) continue;
      let val = m[2];
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (!process.env[m[1]]) process.env[m[1]] = val;
    }
  } catch {
    // Silent — callClaude below will fail with a clearer error if the key is missing.
  }
}

interface ClaudeUsage {
  /** Token usage from the response — used for the soft-cap warning + a
   *  debug payload returned to the client. Cached tokens are an order of
   *  magnitude cheaper, so we surface the hit count explicitly. */
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

/** Open a streaming Claude call and return the fetch Response. Caller is
 *  responsible for reading the SSE stream and translating events. Throws
 *  on transport errors or non-200 status (with credit-exhausted detection
 *  preserved from the previous non-streaming implementation). */
async function openClaudeStream(args: {
  systemText: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
}): Promise<Response> {
  loadWorktreeEnv();
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
  // Structured system block with cache_control: ephemeral on the (single)
  // text block. Anthropic's prompt cache hits this prefix for ~5 minutes,
  // making subsequent turns within a session ~10× cheaper at scale.
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-opus-4-7",
      max_tokens: 1024,
      stream: true,
      system: [
        {
          type: "text",
          text: args.systemText,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: args.messages,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    let parsedErr: { error?: { message?: string } } | null = null;
    try { parsedErr = JSON.parse(body); } catch {}
    const apiMsg = parsedErr?.error?.message ?? "";
    if (res.status === 400 && /credit balance|credits.*too low|purchase credits/i.test(apiMsg)) {
      throw new Error(`CREDITS_EXHAUSTED: ${apiMsg}`);
    }
    throw new Error(`Anthropic API ${res.status}: ${body.slice(0, 300)}`);
  }
  return res;
}

/** Parse Anthropic's SSE stream into normalized events. Anthropic emits
 *  message_start / content_block_delta (the text chunks) / message_delta
 *  (final usage) / message_stop — we squash to two event types the client
 *  cares about: { type: "delta", text } for incremental tokens and
 *  { type: "usage", usage } for the final token count. */
async function* parseAnthropicSSE(
  res: Response,
): AsyncGenerator<{ type: "delta"; text: string } | { type: "usage"; usage: ClaudeUsage }> {
  if (!res.body) throw new Error("Anthropic stream missing body");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // SSE events are separated by \n\n.
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";
    for (const ev of events) {
      const dataLine = ev.split("\n").find((l) => l.startsWith("data: "));
      if (!dataLine) continue;
      let data: unknown;
      try {
        data = JSON.parse(dataLine.slice(6));
      } catch {
        continue;
      }
      const obj = data as Record<string, unknown>;
      if (obj.type === "content_block_delta") {
        const delta = obj.delta as { type?: string; text?: string } | undefined;
        if (delta?.type === "text_delta" && typeof delta.text === "string") {
          yield { type: "delta", text: delta.text };
        }
      } else if (obj.type === "message_start") {
        const msg = obj.message as { usage?: ClaudeUsage } | undefined;
        if (msg?.usage) yield { type: "usage", usage: msg.usage };
      } else if (obj.type === "message_delta") {
        // message_delta carries the final output_tokens count when streaming.
        // We don't yield here because the message_start usage already had
        // input + cache counts; the dashboard's debug surface doesn't need
        // a separate output-token update mid-stream.
      }
    }
  }
}

// Rough char→token estimate. Anthropic's tokenizer averages ~4 chars per
// token for English; this is good enough for the soft-cap warning. We don't
// truncate based on this — Anthropic API will error if the prompt is too
// long, and the soft cap exists to flag drift during productization.
const CHAR_PER_TOKEN_ESTIMATE = 4;
const SOFT_CAP_TOKENS = 20_000;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHAR_PER_TOKEN_ESTIMATE);
}

export async function POST(request: Request) {
  let body: { date?: string; message?: string; item_context?: Record<string, unknown> };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const date = body.date;
  const message = body.message?.trim();
  const itemContext = body.item_context;

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return Response.json({ error: "invalid_date", message: "Expected date in YYYY-MM-DD." }, { status: 400 });
  }
  if (!message) {
    return Response.json({ error: "empty_message" }, { status: 400 });
  }

  const file = readChatFile(date);
  const briefing = readBriefingForDate(date);
  const goals = readUserGoals();
  // Load the full-context block — CV, preferences, pipeline snapshot,
  // applications. Each loader returns a friendly placeholder when the source
  // file isn't present, so this never throws.
  const cv = readCv();
  const userContextYaml = readUserContextYaml();
  const topRoles = readTopRoles(50);
  const recentApps = readRecentApplications(30);

  const systemText = buildSystemBlock({
    goals,
    cv,
    userContextYaml,
    topRoles,
    recentApps,
    briefing,
  });
  const messages = buildMessages({
    history: file.messages,
    itemContext,
    userMessage: message,
  });

  // Soft-cap warning — logs but doesn't truncate. If the user adds a 50K-char
  // CV + the pipeline grows huge, this fires and we know it's time for
  // compaction (probably promoting the "top 50 roles" listing into a tool
  // call instead of inlining).
  const sysTokens = estimateTokens(systemText);
  const msgTokens = messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
  const totalEst = sysTokens + msgTokens;
  if (totalEst > SOFT_CAP_TOKENS) {
    console.warn(
      `[chat] context estimated at ${totalEst} tokens (system=${sysTokens}, messages=${msgTokens}) — over soft cap ${SOFT_CAP_TOKENS}; consider promoting role listing to a tool call`,
    );
  }

  // Append the user message to history NOW so the persisted file ends up
  // with the full transcript even if streaming fails mid-flight. The
  // assistant message is appended after the stream completes (or skipped
  // entirely on error — caller's retry will replay cleanly).
  const userTs = new Date().toISOString();
  file.messages.push({ role: "user", content: message, item_context: itemContext, ts: userTs });

  let upstream: Response;
  try {
    upstream = await openClaudeStream({ systemText, messages });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    if (msg.includes("CREDITS_EXHAUSTED")) {
      return Response.json(
        {
          error: "credits_exhausted",
          message:
            "Anthropic API credits are exhausted. Top up to chat with the agent: https://console.anthropic.com/settings/billing",
          topUpUrl: "https://console.anthropic.com/settings/billing",
        },
        { status: 402 },
      );
    }
    return Response.json({ error: "claude_failed", message: msg }, { status: 500 });
  }

  // Forward Anthropic's SSE as our own normalized event stream. Three event
  // types the client handles:
  //   { type: "delta", text }    — append to the in-progress assistant message
  //   { type: "done", history, debug } — final state; client replaces local history
  //   { type: "error", message } — bubbles up; client shows toast + rolls back
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      function send(payload: unknown) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      }
      let assistantText = "";
      let usage: ClaudeUsage | undefined;
      try {
        for await (const ev of parseAnthropicSSE(upstream)) {
          if (ev.type === "delta") {
            assistantText += ev.text;
            send({ type: "delta", text: ev.text });
          } else if (ev.type === "usage") {
            usage = ev.usage;
          }
        }
        // Persist + send final history.
        const assistantTs = new Date().toISOString();
        file.messages.push({ role: "assistant", content: assistantText, ts: assistantTs });
        try {
          writeChatFile(file);
        } catch (persistErr) {
          console.error("[chat] persistence failed:", persistErr);
          send({
            type: "done",
            history: file.messages,
            persistence_warning: true,
            debug: usage ? { tokens_estimate: totalEst, usage } : { tokens_estimate: totalEst },
          });
          controller.close();
          return;
        }
        send({
          type: "done",
          history: file.messages,
          debug: usage ? { tokens_estimate: totalEst, usage } : { tokens_estimate: totalEst },
        });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : "stream failed";
        send({ type: "error", message: errMsg });
      } finally {
        controller.close();
      }
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

export async function GET(request: Request) {
  const url = new URL(request.url);
  const date = url.searchParams.get("date");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return Response.json({ error: "invalid_date" }, { status: 400 });
  }
  const file = readChatFile(date);
  return Response.json({ history: file.messages });
}
