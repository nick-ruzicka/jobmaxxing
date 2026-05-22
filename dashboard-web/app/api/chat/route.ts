/**
 * POST /api/chat
 *
 * Turn-based agent chat scoped to today's briefing.
 *
 * Body: { date: "YYYY-MM-DD", message: string, item_context?: object }
 *   - date         — keys the persistence file (data/chats/<date>.json)
 *   - message      — the user's new message
 *   - item_context — optional. When the user entered via a chevron on a
 *                    briefing item, the panel passes that item's context so
 *                    the agent has the role/URL/JD context.
 *
 * Behavior:
 *   1. Load (or initialize) the chat history for `date`
 *   2. Load today's daily briefing as conversational context
 *   3. Compose a Claude prompt with: user goals + briefing + chat history
 *      + (optional) item_context + the new message
 *   4. Call Claude (single turn, non-streaming)
 *   5. Append user msg + assistant response to history, write file
 *   6. Return { reply, history }
 *
 * Returns:
 *   200 { reply: string, history: ChatMessage[] }
 *   400 { error } — malformed request
 *   500 { error } — Claude call failed or persistence failed
 *
 * GET /api/chat?date=YYYY-MM-DD — returns { history } for hydration on page load.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { getCompFloorUsd, formatCompFloorString } from "@/lib/comp-floor";
import { defaultGoalFallback } from "../../../../scripts/lib/default-goal.mjs";
import type { Briefing } from "@/lib/types";

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

function buildPrompt(args: {
  goals: string;
  briefing: Briefing | null;
  history: ChatMessage[];
  itemContext: Record<string, unknown> | undefined;
  userMessage: string;
}): string {
  const { goals, briefing, history, itemContext, userMessage } = args;

  // Compact the briefing into a few-line summary the agent can refer to —
  // the full JSON is too much.
  const briefingSummary = briefing
    ? briefing.items
        .map((i, idx) => `[${idx}] ${i.type}: ${i.title}${i.subtitle ? ` — ${i.subtitle}` : ""}`)
        .join("\n")
    : "(no briefing generated yet today)";

  const historyTranscript =
    history.length === 0
      ? "(no prior messages today)"
      : history
          .map((m) => `${m.role === "user" ? "USER" : "AGENT"}: ${m.content}`)
          .join("\n\n");

  const itemContextBlock = itemContext
    ? `\nThe user is asking specifically about this briefing item:\n${JSON.stringify(itemContext, null, 2)}\n`
    : "";

  return `You are the user's job-search agent, having a conversation about today's pipeline. You have full context on their goals and what landed in today's briefing. Be concrete, candid, and specific — name companies, score numbers, surface trade-offs. Push back when the user's read of a role doesn't match what the data says. Don't pad answers.

USER GOALS AND CONTEXT:
${goals}

TODAY'S BRIEFING (${briefing?.date ?? "n/a"}):
${briefingSummary}
${itemContextBlock}
CONVERSATION SO FAR:
${historyTranscript}

USER'S NEW MESSAGE:
${userMessage}

Respond directly in plain prose. No lists unless the user asks for one. Cite the role/company by name when relevant. Keep responses under ~300 words unless the user explicitly asks for more detail.`;
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

async function callClaude(prompt: string): Promise<string> {
  loadWorktreeEnv();
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
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
      messages: [{ role: "user", content: prompt }],
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
  const json = await res.json();
  const text = json.content?.[0]?.text;
  if (!text) throw new Error("Anthropic response missing content text");
  return text;
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

  const prompt = buildPrompt({
    goals,
    briefing,
    history: file.messages,
    itemContext,
    userMessage: message,
  });

  let reply: string;
  try {
    reply = await callClaude(prompt);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    if (message.includes("CREDITS_EXHAUSTED")) {
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
    return Response.json({ error: "claude_failed", message }, { status: 500 });
  }

  const now = new Date().toISOString();
  file.messages.push({ role: "user", content: message, item_context: itemContext, ts: now });
  file.messages.push({ role: "assistant", content: reply, ts: now });

  try {
    writeChatFile(file);
  } catch (err) {
    // Persistence failed but Claude succeeded — return the reply anyway so
    // the user isn't blocked. Log to server stderr for diagnostics.
    console.error("[chat] persistence failed:", err);
    return Response.json({ reply, history: file.messages, persistence_warning: true });
  }

  return Response.json({ reply, history: file.messages });
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
