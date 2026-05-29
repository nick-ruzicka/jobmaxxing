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
import { load as yamlLoad } from "js-yaml";
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

// ─── Agent configuration (productization, audit §5b) ────────────────────────
// Per-user agent settings from config/user-context.yaml `agent:` block.
// Shipped as documented placeholders in PR #50; now wired through.

type AgentVoice = "direct" | "warm" | "analytical" | string;

interface AgentConfig {
  voice: AgentVoice;
  redact: string[];
}

const DEFAULT_AGENT_CONFIG: AgentConfig = {
  voice: "direct",
  redact: [],
};

function loadAgentConfig(): AgentConfig {
  const raw = readUserContextYaml();
  if (!raw) return DEFAULT_AGENT_CONFIG;
  let parsed: unknown;
  try {
    parsed = yamlLoad(raw);
  } catch {
    return DEFAULT_AGENT_CONFIG;
  }
  if (!parsed || typeof parsed !== "object") return DEFAULT_AGENT_CONFIG;
  const agent = (parsed as Record<string, unknown>).agent;
  if (!agent || typeof agent !== "object") return DEFAULT_AGENT_CONFIG;
  const a = agent as Record<string, unknown>;
  const voice = typeof a.voice === "string" ? a.voice : DEFAULT_AGENT_CONFIG.voice;
  const redact = Array.isArray(a.redact)
    ? (a.redact as unknown[]).filter((x): x is string => typeof x === "string")
    : DEFAULT_AGENT_CONFIG.redact;
  return { voice, redact };
}

/** Voice-specific opening instructions. The `custom:<text>` form bypasses
 *  the curated voices entirely and uses the trailing text verbatim — useful
 *  for users who want a specific persona that doesn't fit the three presets. */
function voiceInstructions(voice: AgentVoice): string {
  if (voice.startsWith("custom:")) {
    return voice.slice("custom:".length).trim();
  }
  switch (voice) {
    case "warm":
      return "You are the user's job-search agent, having a conversation about their pipeline. You have full context on their CV, preferences, the current pipeline, recent applications, and today's briefing. Be encouraging and supportive — acknowledge what's working before critiquing what isn't. Soften pushback with empathy. Name companies and score numbers when relevant. Keep responses warm and concrete.";
    case "analytical":
      return "You are the user's job-search agent, having a conversation about their pipeline. You have full context on their CV, preferences, the current pipeline, recent applications, and today's briefing. Lead with numbers — scores, counts, comp ranges, conversion rates. Cite exact data over narrative. Quantify trade-offs. Push back with data, not opinion.";
    case "direct":
    default:
      return "You are the user's job-search agent, having a conversation about their pipeline. You have full context on their CV, preferences, the current pipeline, recent applications, and today's briefing. Be concrete, candid, and specific — name companies, score numbers, surface trade-offs. Push back when the user's read of a role doesn't match what the data says. Don't pad answers.";
  }
}

// ─── Redaction (productization, audit §5b) ──────────────────────────────────
// Strip sensitive lines from the CV before sending it to the LLM. Each entry
// in agent.redact triggers one or more line-level regex strips. Matched
// substrings are replaced with [REDACTED] in place, so the line structure
// is preserved (the agent knows fields were redacted, not that lines vanished).
// Lightweight by design — productization v3 should add per-field config and
// a richer field-aware redactor.

const REDACTION_PATTERNS: Record<string, RegExp[]> = {
  email: [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g],
  phone: [/\+?\d{1,3}[ \-]?\(?\d{3}\)?[ \-]?\d{3,4}[ \-]?\d{4}/g],
  // US street address — number + street word (Rd / St / Ave / etc.) + likely city/state.
  address: [/\b\d{1,5}\s+[\w'\.\- ]{2,40}\s+(?:St|Ave|Rd|Blvd|Dr|Ln|Ct|Way|Pkwy)\b\.?/gi],
  zip: [/\b\d{5}(?:-\d{4})?\b/g],
  linkedin: [/\b(?:linkedin\.com\/in|linkedin\.com\/pub)\/[A-Za-z0-9\-_]+/gi],
  portfolio_url: [/\bhttps?:\/\/[A-Za-z0-9.\-]+\.[A-Za-z]{2,}(?:\/[^\s)]*)?/g],
  // Free-form: when a user wants $-range salary history redacted, this catches
  // standalone "$XXX,XXX" or "$XXXk" tokens. False-positive risk on JD-mentioned
  // comp; documented as a known limit.
  salary_history: [/\$\s?\d{1,3}(?:,\d{3})*(?:k|K|\s?[KM])?/g],
};

function redactCv(cv: string, redact: string[]): string {
  if (redact.length === 0) return cv;
  let out = cv;
  for (const field of redact) {
    const patterns = REDACTION_PATTERNS[field];
    if (!patterns) continue; // unknown field → no-op (forward-compat)
    for (const re of patterns) {
      out = out.replace(re, "[REDACTED]");
    }
  }
  return out;
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

const RESPONSE_GUIDELINES = `Respond directly in plain prose. No lists unless the user asks for one. Cite the role/company by name when relevant. Keep responses under ~300 words unless the user explicitly asks for more detail. If you cite a specific role, include its URL so the user can click through.`;

function buildSystemBlock(args: {
  goals: string;
  cv: string | null;
  userContextYaml: string | null;
  topRoles: string;
  recentApps: string;
  briefing: Briefing | null;
  agent: AgentConfig;
}): string {
  const { goals, cv, userContextYaml, topRoles, recentApps, briefing, agent } = args;

  const briefingSummary = briefing
    ? briefing.items
        .map((i, idx) => `[${idx}] ${i.type}: ${i.title}${i.subtitle ? ` — ${i.subtitle}` : ""}`)
        .join("\n")
    : "(no briefing generated yet today)";

  // Voice-specific opening — replaces the previous hard-coded BASE_INSTRUCTIONS.
  // Defaults to "direct" (Nick's voice / the prior wording).
  const baseInstructions = voiceInstructions(agent.voice);

  // Apply redaction to the CV before inclusion. agent.redact is empty by
  // default — Nick's prior behavior unchanged.
  const cvSection = cv != null ? redactCv(cv, agent.redact) : null;

  const sections: string[] = [
    baseInstructions,
    `\n\n## User goals\n\n${goals}`,
    `\n\n## CV (cv.md${agent.redact.length > 0 ? `; redacted fields: ${agent.redact.join(", ")}` : ""})\n\n${cvSection ?? "(no cv.md file — user hasn't filled it in yet)"}`,
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

// ─── Agent tools (AI feature audit Step 6) ──────────────────────────────────
// Two read-only tools that the agent can call when the question requires data
// outside the cached system snapshot. Both return plain text to keep the
// tool_result wire shape simple; structured returns are a v3 productization
// concern. Mutating tools (Step 7) land separately after the write-path map
// audit (5.5) is written.

/** Tool definitions in Anthropic's expected schema shape. */
const AGENT_TOOLS = [
  {
    name: "query_roles",
    description:
      "Search the user's role pipeline by company, status, or score range. " +
      "Returns up to `limit` roles matching the filters, formatted as compact " +
      "one-line summaries. Use this when the user asks about specific roles " +
      "outside the top-50 already in the cached pipeline snapshot, or when " +
      "they ask aggregate questions ('how many Applied roles do I have').",
    input_schema: {
      type: "object" as const,
      properties: {
        company: {
          type: "string",
          description: "Case-insensitive substring match against role company.",
        },
        statuses: {
          type: "array",
          items: {
            type: "string",
            enum: [
              "Discovered",
              "Evaluated",
              "Applied",
              "Interview",
              "Offer",
              "Rejected",
              "Skipped",
            ],
          },
          description: "Filter to one or more statuses (OR semantics).",
        },
        min_score: { type: "number", description: "Minimum score (0-10). Inclusive." },
        max_score: { type: "number", description: "Maximum score (0-10). Inclusive." },
        limit: {
          type: "integer",
          description: "Cap the number of results. Defaults to 20; max 50.",
        },
      },
    },
  },
  {
    name: "read_prep_doc",
    description:
      "Read an interview prep document by slug (filename without .md extension). " +
      "Returns the full markdown content. Slugs follow the pattern " +
      "'<company>-<role>' — e.g. 'hebbia-gtm-engineer', 'anthropic-applied-ai'.",
    input_schema: {
      type: "object" as const,
      properties: {
        slug: {
          type: "string",
          description: "The prep doc slug — filename in interview-prep/ without .md.",
        },
      },
      required: ["slug"],
    },
  },
];

interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/** Run a tool by name. Returns text to feed back into the conversation as a
 *  tool_result. Errors are caught and returned as text so the agent can adapt
 *  rather than the whole turn failing. */
function runTool(call: ToolCall): string {
  try {
    if (call.name === "query_roles") return runQueryRoles(call.input);
    if (call.name === "read_prep_doc") return runReadPrepDoc(call.input);
    return `[tool error: unknown tool "${call.name}"]`;
  } catch (err) {
    return `[tool error: ${err instanceof Error ? err.message : "unknown"}]`;
  }
}

function runQueryRoles(input: Record<string, unknown>): string {
  const companyFilter = typeof input.company === "string" ? input.company.toLowerCase() : null;
  const statusesFilter = Array.isArray(input.statuses)
    ? new Set((input.statuses as unknown[]).filter((s): s is string => typeof s === "string"))
    : null;
  const locationSubstrings = Array.isArray(input.location_substrings)
    ? (input.location_substrings as unknown[])
        .filter((s): s is string => typeof s === "string")
        .map((s) => s.toLowerCase())
    : null;
  const minScore = typeof input.min_score === "number" ? input.min_score : null;
  const maxScore = typeof input.max_score === "number" ? input.max_score : null;
  const rawLimit = typeof input.limit === "number" ? input.limit : 20;
  const limit = Math.max(1, Math.min(50, Math.floor(rawLimit)));

  let roles: Role[];
  try {
    roles = getRoles({ includeAggregator: false });
  } catch {
    return "[tool: role data unavailable]";
  }

  const filtered = roles.filter((r) => {
    if (companyFilter && !r.company.toLowerCase().includes(companyFilter)) return false;
    if (statusesFilter && !statusesFilter.has(r.status)) return false;
    if (locationSubstrings && locationSubstrings.length > 0) {
      const loc = (r.location ?? "").toLowerCase();
      if (!locationSubstrings.some((sub) => loc.includes(sub))) return false;
    }
    if (minScore != null && r.score < minScore) return false;
    if (maxScore != null && r.score > maxScore) return false;
    return true;
  });

  const sorted = filtered.sort((a, b) => b.score - a.score).slice(0, limit);
  if (sorted.length === 0) {
    return `[query_roles: 0 results out of ${filtered.length} matching out of ${roles.length} total]`;
  }
  const header = `[query_roles: ${sorted.length} results out of ${filtered.length} matching out of ${roles.length} total]\n`;
  const lines = sorted.map((r) => {
    const score = r.score.toFixed(1);
    const comp = r.enrichment?.comp_range ? ` ${r.enrichment.comp_range}` : "";
    const loc = r.location ? ` ${r.location}` : "";
    return `[${score}] ${r.company} — ${r.title} (${r.status}${loc}${comp}) ${r.url}`;
  });
  return header + lines.join("\n");
}

function runReadPrepDoc(input: Record<string, unknown>): string {
  const slug = typeof input.slug === "string" ? input.slug : null;
  if (!slug) return "[read_prep_doc error: missing or invalid slug]";
  // Defensive path sanitization — reject anything containing path separators
  // or upward-traversal so a malicious tool input can't read arbitrary files.
  if (/[\\/]/.test(slug) || slug.includes("..") || slug.startsWith(".")) {
    return `[read_prep_doc error: invalid slug "${slug}"]`;
  }
  const path = join(projectRoot(), "interview-prep", `${slug}.md`);
  if (!existsSync(path)) {
    return `[read_prep_doc: no doc at interview-prep/${slug}.md]`;
  }
  try {
    const content = readFileSync(path, "utf-8");
    // Cap at 16 KB to keep one tool_result from dominating the context.
    if (content.length > 16000) {
      return content.slice(0, 16000) + `\n\n[...truncated; doc is ${content.length} chars total]`;
    }
    return content;
  } catch (err) {
    return `[read_prep_doc error: ${err instanceof Error ? err.message : "read failed"}]`;
  }
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

// Messages content can be either a plain string (simple text turn) or an
// array of structured content blocks (mixed text + tool_use + tool_result).
// Anthropic API accepts both; the agent loop uses arrays once tool calls
// enter the conversation.
type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string };

interface AgentMessage {
  role: "user" | "assistant";
  content: string | ContentBlock[];
}

/** Open a streaming Claude call and return the fetch Response. Caller is
 *  responsible for reading the SSE stream and translating events. Throws
 *  on transport errors or non-200 status (with credit-exhausted detection
 *  preserved from the previous non-streaming implementation). When tools
 *  are provided, the agent loop in the POST handler runs multi-round. */
async function openClaudeStream(args: {
  systemText: string;
  messages: AgentMessage[];
  tools?: typeof AGENT_TOOLS;
}): Promise<Response> {
  loadWorktreeEnv();
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
  // Structured system block with cache_control: ephemeral on the (single)
  // text block. Anthropic's prompt cache hits this prefix for ~5 minutes,
  // making subsequent turns within a session ~10× cheaper at scale.
  const body: Record<string, unknown> = {
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
  };
  if (args.tools && args.tools.length > 0) body.tools = args.tools;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
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

type SSEEvent =
  | { type: "delta"; text: string }
  | { type: "tool_call"; id: string; name: string; input: Record<string, unknown> }
  | { type: "stop_reason"; reason: string }
  | { type: "usage"; usage: ClaudeUsage };

/** Parse Anthropic's SSE stream into normalized events. Handles both text
 *  blocks (yielding deltas as they arrive) and tool_use blocks (accumulating
 *  the input JSON until content_block_stop, then yielding a complete
 *  tool_call event). Yields stop_reason from message_delta so the agent loop
 *  knows whether to continue with tool execution. */
async function* parseAnthropicSSE(res: Response): AsyncGenerator<SSEEvent> {
  if (!res.body) throw new Error("Anthropic stream missing body");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  // Track in-progress content blocks by index. For tool_use blocks we buffer
  // the partial input_json deltas until content_block_stop fires.
  type InProgress =
    | { type: "text" }
    | { type: "tool_use"; id: string; name: string; jsonBuffer: string };
  const blocks = new Map<number, InProgress>();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
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

      if (obj.type === "message_start") {
        const msg = obj.message as { usage?: ClaudeUsage } | undefined;
        if (msg?.usage) yield { type: "usage", usage: msg.usage };
      } else if (obj.type === "content_block_start") {
        const idx = obj.index as number;
        const block = obj.content_block as Record<string, unknown> | undefined;
        if (block?.type === "tool_use") {
          blocks.set(idx, {
            type: "tool_use",
            id: String(block.id ?? ""),
            name: String(block.name ?? ""),
            jsonBuffer: "",
          });
        } else {
          blocks.set(idx, { type: "text" });
        }
      } else if (obj.type === "content_block_delta") {
        const idx = obj.index as number;
        const block = blocks.get(idx);
        const delta = obj.delta as { type?: string; text?: string; partial_json?: string } | undefined;
        if (delta?.type === "text_delta" && typeof delta.text === "string") {
          yield { type: "delta", text: delta.text };
        } else if (
          delta?.type === "input_json_delta" &&
          typeof delta.partial_json === "string" &&
          block?.type === "tool_use"
        ) {
          block.jsonBuffer += delta.partial_json;
        }
      } else if (obj.type === "content_block_stop") {
        const idx = obj.index as number;
        const block = blocks.get(idx);
        if (block?.type === "tool_use") {
          let input: Record<string, unknown> = {};
          try {
            input = block.jsonBuffer ? JSON.parse(block.jsonBuffer) : {};
          } catch {
            input = { _raw_json: block.jsonBuffer };
          }
          yield { type: "tool_call", id: block.id, name: block.name, input };
        }
        blocks.delete(idx);
      } else if (obj.type === "message_delta") {
        const delta = obj.delta as { stop_reason?: string } | undefined;
        if (delta?.stop_reason) {
          yield { type: "stop_reason", reason: delta.stop_reason };
        }
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

  const agent = loadAgentConfig();
  const systemText = buildSystemBlock({
    goals,
    cv,
    userContextYaml,
    topRoles,
    recentApps,
    briefing,
    agent,
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

  // Probe the upstream once before opening the response — credit-exhausted
  // errors come back synchronously from openClaudeStream and we want to
  // return JSON 402, not start an SSE response that immediately errors.
  let firstUpstream: Response;
  try {
    firstUpstream = await openClaudeStream({ systemText, messages, tools: AGENT_TOOLS });
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

  // Agent loop. Each round:
  //   1. Stream the upstream Claude response; forward text deltas to client.
  //   2. Collect any tool_use blocks + the final stop_reason.
  //   3. If stop_reason == "tool_use", run the tools, append the assistant
  //      turn (text + tool_use blocks) and a user turn (tool_result blocks)
  //      to the conversation, open a new upstream stream, repeat.
  //   4. Otherwise, persist and finish.
  // Capped at MAX_TOOL_ROUNDS so a confused agent can't burn tokens forever.
  const MAX_TOOL_ROUNDS = 3;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      function send(payload: unknown) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      }

      // assistantTextAcrossRounds is the user-visible text concatenated over
      // all rounds — this is what gets persisted into the chat file. Tool
      // runs are deliberately NOT persisted; their outputs were fed back to
      // the model in this turn and don't need to replay on hydration.
      let assistantTextAcrossRounds = "";
      let usage: ClaudeUsage | undefined;
      // toolRunsThisTurn is a server-log-only count of how many tool rounds
      // fired this turn; surfaced in the debug payload.
      let toolRounds = 0;
      const convo: AgentMessage[] = messages.slice();
      let currentUpstream: Response | null = firstUpstream;

      try {
        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
          if (!currentUpstream) break;
          let roundText = "";
          const roundTools: ToolCall[] = [];
          let roundStop: string | null = null;

          for await (const ev of parseAnthropicSSE(currentUpstream)) {
            if (ev.type === "delta") {
              roundText += ev.text;
              send({ type: "delta", text: ev.text });
            } else if (ev.type === "tool_call") {
              roundTools.push({ id: ev.id, name: ev.name, input: ev.input });
            } else if (ev.type === "stop_reason") {
              roundStop = ev.reason;
            } else if (ev.type === "usage" && !usage) {
              usage = ev.usage;
            }
          }
          assistantTextAcrossRounds += roundText;

          // Natural stop or no tools requested → exit the loop.
          if (roundStop !== "tool_use" || roundTools.length === 0) {
            currentUpstream = null;
            break;
          }
          toolRounds++;

          // Build the assistant turn (text + tool_use blocks) and the
          // synthetic user turn (tool_result blocks).
          const assistantBlocks: ContentBlock[] = [];
          if (roundText) assistantBlocks.push({ type: "text", text: roundText });
          for (const t of roundTools) {
            assistantBlocks.push({ type: "tool_use", id: t.id, name: t.name, input: t.input });
          }
          convo.push({ role: "assistant", content: assistantBlocks });

          const toolResultBlocks: ContentBlock[] = roundTools.map((t) => ({
            type: "tool_result",
            tool_use_id: t.id,
            content: runTool(t),
          }));
          convo.push({ role: "user", content: toolResultBlocks });

          // Next round — re-open the stream with the extended convo.
          currentUpstream = await openClaudeStream({
            systemText,
            messages: convo,
            tools: AGENT_TOOLS,
          });
        }

        // Round cap notice (rare path; surfaces as plain text so the user
        // at least sees something honest if the loop ran out of budget).
        if (currentUpstream != null) {
          const notice =
            "\n\n[Note: stopped after 3 tool rounds. Ask again with a narrower question if you wanted more digging.]";
          assistantTextAcrossRounds += notice;
          send({ type: "delta", text: notice });
        }

        // Persist + send final history.
        const assistantTs = new Date().toISOString();
        file.messages.push({ role: "assistant", content: assistantTextAcrossRounds, ts: assistantTs });
        try {
          writeChatFile(file);
        } catch (persistErr) {
          console.error("[chat] persistence failed:", persistErr);
          send({
            type: "done",
            history: file.messages,
            persistence_warning: true,
            debug: {
              tokens_estimate: totalEst,
              usage,
              tool_rounds: toolRounds,
            },
          });
          controller.close();
          return;
        }
        send({
          type: "done",
          history: file.messages,
          debug: {
            tokens_estimate: totalEst,
            usage,
            tool_rounds: toolRounds,
          },
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
