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

import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from "fs";
import { checkCooldown, formatLastRunAgo } from "@/lib/rate-limit";
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

export function chatFilePath(date: string): string {
  return join(projectRoot(), "data", "chats", `${date}.json`);
}

export function readChatFile(date: string): ChatFile {
  const path = chatFilePath(date);
  if (!existsSync(path)) return { date, messages: [] };
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as ChatFile;
  } catch {
    return { date, messages: [] };
  }
}

export function writeChatFile(file: ChatFile): void {
  const dir = join(projectRoot(), "data", "chats");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(chatFilePath(file.date), JSON.stringify(file, null, 2) + "\n");
}

// ── Pending-tool persistence (PR b) ─────────────────────────────────────────
// When the agent loop hits a confirmation-required tool, we freeze the
// conversation state to disk and end the SSE stream. POST /api/chat/respond-
// to-tool then thaws the state, applies the user's decision, and continues
// the loop. State lives alongside the regular chat history file so refreshing
// the page can re-render the confirmation card from GET /api/chat.
//
// Single-pending-call-per-date is enforced — sending a new user message while
// pending state exists silently discards it (treated as cancel). PR c's
// confirmation UI is the right place to expose this; the API just gates.

export interface PendingState {
  date: string;
  /** System prompt at the time of pause — preserved so the resume uses
   *  identical cache key and the loop continues with the same context. */
  system_text: string;
  /** Full conversation up to and INCLUDING the assistant turn that issued
   *  the tool_use. The resume appends a tool_result-bearing user turn. */
  convo: AgentMessage[];
  pending_tool: {
    id: string;
    name: string;
    input: Record<string, unknown>;
    preview: string;
  };
  /** Assistant text streamed so far across all rounds. Resume continues
   *  appending; final value is what gets persisted to chat history. */
  text_so_far: string;
  tool_rounds: number;
  usage: ClaudeUsage | undefined;
  total_est: number;
  /** Round index to resume on (i.e. the round AFTER the paused one). */
  next_round: number;
}

export function pendingFilePath(date: string): string {
  return join(projectRoot(), "data", "chats", `${date}.pending.json`);
}

export function readPendingFile(date: string): PendingState | null {
  const path = pendingFilePath(date);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as PendingState;
  } catch {
    return null;
  }
}

export function writePendingFile(state: PendingState): void {
  const dir = join(projectRoot(), "data", "chats");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(pendingFilePath(state.date), JSON.stringify(state, null, 2) + "\n");
}

export function deletePendingFile(date: string): void {
  const path = pendingFilePath(date);
  if (existsSync(path)) {
    try {
      unlinkSync(path);
    } catch (err) {
      // Best-effort delete — stale pending state is recoverable on next
      // POST (we discard it then), so warn but don't fail the response.
      console.warn("[chat] pending file delete failed:", err);
    }
  }
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
export type ToolPolicy = "auto" | "confirm" | "deny";

export interface AgentConfig {
  voice: AgentVoice;
  redact: string[];
  /** Per-tool execution policy. Documented in user-context.example.yaml as
   *  the `agent.tools:` block. Missing entries fall back to:
   *    - `auto`    for read tools (query_roles, read_prep_doc)
   *    - `confirm` for mutating tools (everything in MUTATING_TOOLS)
   *  Unknown policy values are treated as `confirm` (safe default). Step 9
   *  close — the schema was shipped as documented placeholders in PR #50 +
   *  PR #69; this PR honors it. */
  tools: Record<string, ToolPolicy>;
}

const DEFAULT_AGENT_CONFIG: AgentConfig = {
  voice: "direct",
  redact: [],
  tools: {},
};

export function loadAgentConfig(): AgentConfig {
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
  const tools: Record<string, ToolPolicy> = {};
  if (a.tools && typeof a.tools === "object") {
    for (const [key, value] of Object.entries(a.tools as Record<string, unknown>)) {
      if (value === "auto" || value === "confirm" || value === "deny") {
        tools[key] = value;
      }
      // Unknown values silently dropped — caller's effectiveToolPolicy falls
      // back to the default for the tool's kind.
    }
  }
  return { voice, redact, tools };
}

/** Resolve a tool's effective policy. Looks up the explicit policy from
 *  user-context.yaml's `agent.tools` block; falls back to `confirm` for
 *  mutating tools and `auto` for read tools. Exported so respond-to-tool's
 *  resume code path uses the same logic. */
export function effectiveToolPolicy(name: string, agent: AgentConfig): ToolPolicy {
  const explicit = agent.tools[name];
  if (explicit) return explicit;
  return MUTATING_TOOLS.has(name) ? "confirm" : "auto";
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
export const AGENT_TOOLS = [
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
  // ── Mutating tools ──────────────────────────────────────────────────────
  // These ALWAYS pause the agent loop for user confirmation in the chat UI
  // (the server detects the name is in MUTATING_TOOLS and emits tool_request
  // instead of executing). The agent does NOT need to ask for confirmation in
  // text — the UI handles it. Description tells the agent to gather all rows
  // first and call ONCE with a single bulk entries[] — looping is wrong both
  // because of the per-call confirmation cost AND because the underlying
  // endpoint mutates atomically.
  {
    name: "update_score_override",
    description:
      "Add, change, or remove a score override for a company in " +
      "data/score-overrides.json. ALWAYS pauses for confirmation in the chat " +
      "UI — you do NOT need to ask permission in text. Use this when the " +
      "user says things like 'boost Stripe to 8 (they confirmed remote)', " +
      "'penalize Foo's score', 'block ConsumerCo' (industry mismatch), or " +
      "'remove the boost on Bar'. For bulk actions, pass all changes in one " +
      "entries[] call — do NOT loop. The endpoint moves a slug between " +
      "categories atomically if needed (e.g. boost → penalize).",
    input_schema: {
      type: "object" as const,
      properties: {
        entries: {
          type: "array",
          items: {
            type: "object",
            properties: {
              company_slug: {
                type: "string",
                description: "Lowercase kebab-case slug; alphanumeric + - _ only.",
              },
              kind: {
                type: "string",
                enum: ["boost", "penalize", "block", "delete"],
                description:
                  "boost = lift score; penalize = ding score; block = hard-disqualify; delete = remove from all categories.",
              },
              score: {
                type: "number",
                description: "Required when kind=boost (0-10). Optional null for penalize.",
              },
              reason: {
                type: "string",
                description: "Short human-readable why (e.g. 'recruiter confirmed remote').",
              },
              company: {
                type: "string",
                description: "Display name. Defaults to the slug if omitted.",
              },
              source: {
                type: "string",
                description: "Provenance tag. Defaults to 'manual'.",
              },
            },
            required: ["company_slug", "kind"],
          },
          description: "One or more score override changes in a single atomic write.",
        },
        reason: {
          type: "string",
          description: "Short umbrella why shown in the confirmation preview.",
        },
      },
      required: ["entries"],
    },
  },
  {
    name: "update_user_context",
    description:
      "Edit specific paths in config/user-context.yaml — the user's per-user " +
      "preferences file. ALWAYS pauses for confirmation in the chat UI. Use " +
      "for asks like 'stop showing me Web3 BD roles' " +
      "(archetype_fit.web3-bd.qualified=false), 'switch to warm voice' " +
      "(agent.voice=warm), 'redact my phone' (agent.redact=[\"phone\"]). " +
      "Supported paths are restricted server-side; compensation, " +
      "location_preferences, and hard_nos are NOT writable here (those need a " +
      "deliberate human edit). Supported v1 paths:\n" +
      "  archetype_fit.<id>.qualified         (boolean)\n" +
      "  archetype_fit.<id>.confidence_floor  (number 0-1)\n" +
      "  agent.voice                          (string)\n" +
      "  agent.redact                         (string[])\n" +
      "Pass either {path, value} to set or {path, delete: true} to remove.",
    input_schema: {
      type: "object" as const,
      properties: {
        entries: {
          type: "array",
          items: {
            type: "object",
            properties: {
              path: {
                type: "array",
                items: { type: "string" },
                description:
                  "Dot-path as a string array, e.g. ['archetype_fit', 'web3-bd', 'qualified'].",
              },
              value: {
                description:
                  "New value. Type depends on the path (boolean/number/string/string[]). Omit when delete=true.",
              },
              delete: {
                type: "boolean",
                description: "Set true to remove the path. value is ignored.",
              },
            },
            required: ["path"],
          },
          description: "One or more path edits in a single atomic write.",
        },
        reason: {
          type: "string",
          description: "Short umbrella why shown in the confirmation preview.",
        },
      },
      required: ["entries"],
    },
  },
  {
    name: "update_application_status",
    description:
      "Mark one or more roles in the user's applications tracker with a new " +
      "status. ALWAYS pauses for user confirmation in the chat UI before " +
      "executing — you do NOT need to ask permission in text. Use this when " +
      "the user says things like 'mark Hebbia as Applied' or 'disqualify " +
      "all hybrid SF/Philly roles'. For bulk actions, gather the role list " +
      "with query_roles first (use location_substrings for location filters), " +
      "then call THIS tool ONCE with all entries in a single bulk array — do " +
      "NOT loop calling it per role. Existing rows are matched on company + " +
      "title; unmatched URLs are upserted as new rows (except Discovered).",
    input_schema: {
      type: "object" as const,
      properties: {
        entries: {
          type: "array",
          items: {
            type: "object",
            properties: {
              url: { type: "string", description: "Canonical role URL." },
              status: {
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
                description: "New status to apply.",
              },
              company: {
                type: "string",
                description: "Company name — used to match the row in applications.md.",
              },
              title: {
                type: "string",
                description: "Role title — used to match the row in applications.md.",
              },
            },
            required: ["url", "status"],
          },
          description: "One or more roles to update in a single atomic write.",
        },
        reason: {
          type: "string",
          description:
            "Short why for the user's audit trail (e.g. 'hybrid role in SF/Philly'). Shown in the confirmation preview.",
        },
      },
      required: ["entries"],
    },
  },
  // ── Triggered-action tools (AI feature audit Step 8) ────────────────────
  // Long-running scripts: briefing regeneration (sync-block, ~30s) and the
  // two scan kinds (job-kickoff, 2-5 min typical, results in /today). All
  // three go through MUTATING_TOOLS so the confirmation card surfaces the
  // ETA + last-run-at before the user commits. See:
  //   docs/audits/2026-05-29-triggered-actions-scope.md
  {
    name: "regenerate_briefing",
    description:
      "Re-run scripts/generate-briefing.mjs to refresh today's briefing on " +
      "/today. ALWAYS pauses for user confirmation in the chat UI. Use when " +
      "the user says 'regenerate today's briefing' or 'refresh the morning " +
      "items'. Synchronous (~30s blocking) — the chat panel shows a progress " +
      "widget while it runs; user can't send another message until it " +
      "completes. Rate-limited 1 per 5 minutes server-side; the preview shows " +
      "current cooldown state.",
    input_schema: {
      type: "object" as const,
      properties: {
        kind: {
          type: "string",
          enum: ["daily", "pipeline-health"],
          description:
            "Briefing flavor. Defaults to 'daily' (the /today briefing). " +
            "'pipeline-health' regenerates the weekly pipeline-health digest.",
        },
        reason: {
          type: "string",
          description: "Short why shown in the confirmation preview.",
        },
      },
    },
  },
  {
    name: "trigger_scan",
    description:
      "Kick off a fresh role scan in the background. Runs " +
      "scripts/scan-jobs.mjs followed by scripts/enrich-roles.mjs so the " +
      "user gets fit-scored roles, not raw URLs. ALWAYS pauses for user " +
      "confirmation. Returns IMMEDIATELY with a job_id once the user " +
      "confirms — the scan runs in the background and results appear on " +
      "/today when it completes (typical: 2-5 min, worst case: 30+ min on a " +
      "fresh enrichment backlog). The chat stays interactive; user can ask " +
      "you other things while it runs. Rate-limited 1 per 15 minutes; the " +
      "preview shows current cooldown state.",
    input_schema: {
      type: "object" as const,
      properties: {
        reason: {
          type: "string",
          description: "Short why shown in the confirmation preview.",
        },
      },
    },
  },
  {
    name: "trigger_signal_scan",
    description:
      "Kick off a signal scan in the background. Runs " +
      "scripts/scan-signals.mjs to find companies that will need a GTM " +
      "Engineer in the next 30-60 days BEFORE they post (funding signals + " +
      "absence check + outreach enrichment). ALWAYS pauses for user " +
      "confirmation. Returns IMMEDIATELY with a job_id; high-conviction " +
      "targets get appended to data/pipeline.md when it completes. Typical " +
      "runtime 2-5 min; this is the weekly cron job (Mondays), so the user " +
      "asking for it mid-week is asking for an early run. Rate-limited 1 " +
      "per 15 minutes.",
    input_schema: {
      type: "object" as const,
      properties: {
        reason: {
          type: "string",
          description: "Short why shown in the confirmation preview.",
        },
      },
    },
  },
];

// ── Confirmation gate (AI feature audit Step 7 PR b) ────────────────────────
// Tools whose name is in MUTATING_TOOLS get the two-phase treatment: the
// agent loop pauses, emits a `tool_request` SSE event with a preview, and
// waits for the user to confirm via POST /api/chat/respond-to-tool. The
// underlying endpoints (e.g. /api/update-status) still require confirmed_bulk
// at the HTTP layer as defense-in-depth.

const MUTATING_TOOLS = new Set<string>([
  "update_application_status",
  "update_score_override",
  "update_user_context",
  // Step 8 triggered actions go through the same confirmation gate —
  // the cost is wall time + Claude/Exa quota, not data integrity, so the
  // user should approve before it runs.
  "regenerate_briefing",
  "trigger_scan",
  "trigger_signal_scan",
]);

export function requiresConfirmation(name: string): boolean {
  return MUTATING_TOOLS.has(name);
}

/** Build a human-readable preview shown in the confirmation card. Per-tool
 *  formatting — falls back to a JSON dump for unknown tools so the user can
 *  at least eyeball the input. */
export function buildConfirmationPreview(
  name: string,
  input: Record<string, unknown>,
): string {
  if (name === "update_application_status") {
    const entries = Array.isArray(input.entries) ? (input.entries as Array<Record<string, unknown>>) : [];
    const reason = typeof input.reason === "string" ? input.reason.trim() : "";
    const lines = entries.slice(0, 10).map((e) => {
      const company = typeof e.company === "string" && e.company ? e.company : "?";
      const title = typeof e.title === "string" && e.title ? e.title : "?";
      const status = typeof e.status === "string" ? e.status : "?";
      return `• [${status}] ${company} — ${title}`;
    });
    const head = `Update ${entries.length} role${entries.length === 1 ? "" : "s"}:`;
    const more = entries.length > 10 ? `\n… and ${entries.length - 10} more` : "";
    const why = reason ? `\n\nReason: ${reason}` : "";
    return `${head}\n${lines.join("\n")}${more}${why}`;
  }
  if (name === "update_score_override") {
    const entries = Array.isArray(input.entries) ? (input.entries as Array<Record<string, unknown>>) : [];
    const reason = typeof input.reason === "string" ? input.reason.trim() : "";
    const lines = entries.slice(0, 10).map((e) => {
      const slug = typeof e.company_slug === "string" ? e.company_slug : "?";
      const kind = typeof e.kind === "string" ? e.kind : "?";
      const score = typeof e.score === "number" ? ` → ${e.score}` : "";
      const why = typeof e.reason === "string" && e.reason ? ` (${e.reason})` : "";
      return `• ${kind}: ${slug}${score}${why}`;
    });
    const head = `Update ${entries.length} score override${entries.length === 1 ? "" : "s"}:`;
    const more = entries.length > 10 ? `\n… and ${entries.length - 10} more` : "";
    const why = reason ? `\n\nReason: ${reason}` : "";
    return `${head}\n${lines.join("\n")}${more}${why}`;
  }
  if (name === "update_user_context") {
    const entries = Array.isArray(input.entries) ? (input.entries as Array<Record<string, unknown>>) : [];
    const reason = typeof input.reason === "string" ? input.reason.trim() : "";
    const lines = entries.slice(0, 10).map((e) => {
      const path = Array.isArray(e.path) ? (e.path as unknown[]).join(".") : "?";
      if (e.delete === true) return `• DELETE ${path}`;
      const valStr = JSON.stringify(e.value);
      return `• SET ${path} = ${valStr}`;
    });
    const head = `Update ${entries.length} user-context path${entries.length === 1 ? "" : "s"}:`;
    const more = entries.length > 10 ? `\n… and ${entries.length - 10} more` : "";
    const why = reason ? `\n\nReason: ${reason}` : "";
    return `${head}\n${lines.join("\n")}${more}${why}`;
  }
  if (name === "regenerate_briefing") {
    const kind = typeof input.kind === "string" ? input.kind : "daily";
    const reason = typeof input.reason === "string" ? input.reason.trim() : "";
    const cooldownKind: "briefing-daily" | "briefing-pipeline-health" =
      kind === "pipeline-health" ? "briefing-pipeline-health" : "briefing-daily";
    const lastAgo = formatLastRunAgo(cooldownKind);
    const cooldown = checkCooldown(cooldownKind);
    const head = `Regenerate ${kind} briefing`;
    const lastLine = lastAgo ? `Last run: ${lastAgo}` : "Last run: never";
    const cooldownLine = cooldown
      ? `\nCOOLDOWN ACTIVE — try again in ${Math.ceil(cooldown.retry_after_ms / 1000)}s`
      : "";
    const eta = "\nETA: ~30s (blocks the chat panel; progress widget shown)";
    const why = reason ? `\n\nReason: ${reason}` : "";
    return `${head}\n${lastLine}${cooldownLine}${eta}${why}`;
  }
  if (name === "trigger_scan") {
    const reason = typeof input.reason === "string" ? input.reason.trim() : "";
    const lastAgo = formatLastRunAgo("scan-jobs");
    const cooldown = checkCooldown("scan-jobs");
    const head = `Run a fresh role scan (scan-jobs.mjs → enrich-roles.mjs)`;
    const lastLine = lastAgo ? `Last scan: ${lastAgo}` : "Last scan: never";
    const cooldownLine = cooldown
      ? `\nCOOLDOWN ACTIVE — try again in ${Math.ceil(cooldown.retry_after_ms / 60_000)}m`
      : "";
    const eta = "\nETA: 2-5 min typical (30+ min on a backlog). Runs in background — chat stays interactive.";
    const cost = "\nCost: dozens of Claude calls for enrichment + Exa queries.";
    const why = reason ? `\n\nReason: ${reason}` : "";
    return `${head}\n${lastLine}${cooldownLine}${eta}${cost}${why}`;
  }
  if (name === "trigger_signal_scan") {
    const reason = typeof input.reason === "string" ? input.reason.trim() : "";
    const lastAgo = formatLastRunAgo("scan-signals");
    const cooldown = checkCooldown("scan-signals");
    const head = `Run a signal scan (scan-signals.mjs)`;
    const lastLine = lastAgo ? `Last signal scan: ${lastAgo}` : "Last signal scan: never";
    const cooldownLine = cooldown
      ? `\nCOOLDOWN ACTIVE — try again in ${Math.ceil(cooldown.retry_after_ms / 60_000)}m`
      : "";
    const eta = "\nETA: 2-5 min. Runs in background — high-conviction targets get appended to data/pipeline.md.";
    const cost = "\nCost: Exa queries for funding discovery + outreach enrichment.";
    const why = reason ? `\n\nReason: ${reason}` : "";
    return `${head}\n${lastLine}${cooldownLine}${eta}${cost}${why}`;
  }
  return `${name}\n${JSON.stringify(input, null, 2)}`;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/** Run a read-only tool by name. Returns text to feed back into the
 *  conversation as a tool_result. Errors are caught and returned as text so
 *  the agent can adapt rather than the whole turn failing. Mutating tools
 *  (MUTATING_TOOLS) are NOT routed here — they go through executeMutatingTool
 *  after the user confirms in the chat UI. */
function runTool(call: ToolCall): string {
  try {
    if (call.name === "query_roles") return runQueryRoles(call.input);
    if (call.name === "read_prep_doc") return runReadPrepDoc(call.input);
    return `[tool error: unknown tool "${call.name}"]`;
  } catch (err) {
    return `[tool error: ${err instanceof Error ? err.message : "unknown"}]`;
  }
}

/** Execute a mutating tool AFTER the user confirmed in the chat UI. Returns
 *  the tool_result text to feed back to the agent. Always sets confirmed_bulk
 *  on the downstream endpoint — the user's confirmation in the UI counts as
 *  the bulk consent for any number of entries. The endpoint's own
 *  needs_bulk_confirmation gate is preserved as defense-in-depth for callers
 *  that bypass the chat (the dashboard's manual-edit UI, scripts, etc).
 *
 *  Returns short structured-prose text rather than raw JSON so the agent's
 *  follow-up message can summarize what happened without re-parsing. */
export async function executeMutatingTool(
  call: ToolCall,
  /** Optional progress callback for tools that stream events while running
   *  (currently: regenerate_briefing's SSE mode). Each call fires once per
   *  script progress event; respond-to-tool wraps its `send` so the chat
   *  client receives tool_progress SSE events the progress widget renders.
   *  Non-streaming tools (status/override/user-context/scan kickoffs) ignore
   *  this. */
  onProgress?: (event: Record<string, unknown>) => void,
): Promise<string> {
  try {
    if (call.name === "update_application_status") {
      const entries = Array.isArray(call.input.entries) ? call.input.entries : [];
      if (entries.length === 0) {
        return "[update_application_status: refused — no entries provided]";
      }
      // Lazy import avoids a circular import at module-load time (the route
      // file declaring this function would otherwise depend on a sibling
      // route's bundle being ready).
      const { POST: updateStatusPost } = await import("../update-status/route");
      const req = new Request("http://internal/api/update-status", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entries, confirmed_bulk: true }),
      });
      const res = await updateStatusPost(req);
      const json = (await res.json()) as Record<string, unknown>;
      if (!res.ok) {
        return `[update_application_status failed (HTTP ${res.status}): ${JSON.stringify(json)}]`;
      }
      const updated = typeof json.updated === "number" ? json.updated : 0;
      const applied = Array.isArray(json.applied) ? json.applied : [];
      const lines = applied.slice(0, 10).map((a: unknown) => {
        const r = a as Record<string, unknown>;
        const matched = r.matched ? "matched" : r.upserted ? "upserted" : "no-match";
        return `• [${r.status}] ${r.url} (${matched})`;
      });
      const more = applied.length > 10 ? `\n… and ${applied.length - 10} more` : "";
      return `[update_application_status ok: updated ${updated} of ${applied.length}]\n${lines.join("\n")}${more}`;
    }
    if (call.name === "update_score_override") {
      const entries = Array.isArray(call.input.entries) ? call.input.entries : [];
      if (entries.length === 0) return "[update_score_override: refused — no entries provided]";
      const { POST: updateOverridePost } = await import("../update-override/route");
      const req = new Request("http://internal/api/update-override", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entries, confirmed_bulk: true }),
      });
      const res = await updateOverridePost(req);
      const json = (await res.json()) as Record<string, unknown>;
      if (!res.ok) {
        return `[update_score_override failed (HTTP ${res.status}): ${JSON.stringify(json)}]`;
      }
      const applied = Array.isArray(json.applied) ? json.applied : [];
      const moves = Array.isArray(json.moves) ? json.moves : [];
      const deletions = Array.isArray(json.deletions) ? json.deletions : [];
      const tail = [
        moves.length ? `${moves.length} moved between categories` : null,
        deletions.length ? `${deletions.length} deleted` : null,
      ].filter(Boolean).join(", ");
      return `[update_score_override ok: applied ${applied.length}${tail ? `; ${tail}` : ""}]`;
    }
    if (call.name === "update_user_context") {
      const entries = Array.isArray(call.input.entries) ? call.input.entries : [];
      if (entries.length === 0) return "[update_user_context: refused — no entries provided]";
      const { POST: updateUserContextPost } = await import("../update-user-context/route");
      const req = new Request("http://internal/api/update-user-context", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entries, confirmed_bulk: true }),
      });
      const res = await updateUserContextPost(req);
      const json = (await res.json()) as Record<string, unknown>;
      if (!res.ok) {
        return `[update_user_context failed (HTTP ${res.status}): ${JSON.stringify(json)}]`;
      }
      const applied = Array.isArray(json.applied) ? json.applied : [];
      return `[update_user_context ok: applied ${applied.length} path${applied.length === 1 ? "" : "s"}]`;
    }
    if (call.name === "regenerate_briefing") {
      // Sync-block model — the agent loop holds while the script runs (~30s
      // typical, 90s ceiling). The route streams JSONL events as SSE
      // tool_progress; we consume them, forward to onProgress for the
      // chat widget, and return the final summary as tool_result text.
      const kindParam =
        typeof call.input.kind === "string" && call.input.kind === "pipeline-health"
          ? "pipeline-health"
          : "daily";
      const { POST: regeneratePost } = await import("../briefing/regenerate/route");
      const req = new Request(
        `http://internal/api/briefing/regenerate?kind=${kindParam}&progress=sse`,
        { method: "POST", headers: { "content-type": "application/json" } },
      );
      const res = await regeneratePost(req);
      if (!res.body) {
        return "[regenerate_briefing failed: route returned no body]";
      }
      const contentType = res.headers.get("Content-Type") ?? "";
      // 429 / 402 / 500 come back as JSON, not SSE — handle those first.
      if (!contentType.includes("text/event-stream")) {
        const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        const message = typeof json.message === "string" ? json.message : "unknown";
        return `[regenerate_briefing failed (HTTP ${res.status}): ${message}]`;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let lastFinished: Record<string, unknown> | null = null;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";
        for (const ev of events) {
          const dataLine = ev.split("\n").find((l) => l.startsWith("data: "));
          if (!dataLine) continue;
          let payload: unknown;
          try {
            payload = JSON.parse(dataLine.slice(6));
          } catch {
            continue;
          }
          const obj = payload as Record<string, unknown>;
          if (obj.type === "tool_progress") {
            onProgress?.(obj);
          } else if (obj.type === "tool_finished") {
            lastFinished = obj;
          }
        }
      }
      if (!lastFinished) {
        return "[regenerate_briefing failed: stream ended without tool_finished event]";
      }
      if (lastFinished.ok !== true) {
        const summary = typeof lastFinished.summary === "string" ? lastFinished.summary : "unknown";
        return `[regenerate_briefing failed: ${summary}]`;
      }
      const summary =
        typeof lastFinished.summary === "string"
          ? lastFinished.summary
          : "Regenerated briefing.";
      const briefing = lastFinished.briefing as { items?: unknown[] } | undefined;
      const itemCount = Array.isArray(briefing?.items) ? briefing.items.length : 0;
      return `[regenerate_briefing ok: ${summary} (${itemCount} item${itemCount === 1 ? "" : "s"} on /today)]`;
    }
    if (call.name === "trigger_scan" || call.name === "trigger_signal_scan") {
      // Minimal job-kickoff model — POST returns 202 with job_id, scan
      // continues in background. Tool result tells the agent the job is
      // running so it can acknowledge and stay interactive. The user can
      // ask about progress later via /today (or a future check_scan_status
      // tool in v1.1).
      const routePath = call.name === "trigger_scan" ? "../run-scan/route" : "../run-signal-scan/route";
      const mod = (await import(routePath)) as { POST: (req: Request) => Promise<Response> };
      const req = new Request("http://internal/api/run-scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      const res = await mod.POST(req);
      const json = (await res.json()) as Record<string, unknown>;
      if (res.status === 429) {
        const retry = typeof json.retryAfterSeconds === "number" ? json.retryAfterSeconds : 0;
        return `[${call.name} cooldown active: ${json.message ?? `try again in ${retry}s`}]`;
      }
      if (!res.ok || !json.job_id) {
        return `[${call.name} failed (HTTP ${res.status}): ${JSON.stringify(json)}]`;
      }
      const chained = Array.isArray(json.chained) ? json.chained.join(" → ") : "";
      const chainNote = chained ? ` Will chain: ${chained}.` : "";
      return (
        `[${call.name} started · job_id=${json.job_id} · status=${json.status}.${chainNote} ` +
        `Results will appear in /today when it completes (typical 2-5 min). ` +
        `Tell the user the scan is running and let them keep chatting — don't poll.]`
      );
    }
    return `[mutating tool error: unknown tool "${call.name}"]`;
  } catch (err) {
    return `[mutating tool error: ${err instanceof Error ? err.message : "unknown"}]`;
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
export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string };

export interface AgentMessage {
  role: "user" | "assistant";
  content: string | ContentBlock[];
}

/** Open a streaming Claude call and return the fetch Response. Caller is
 *  responsible for reading the SSE stream and translating events. Throws
 *  on transport errors or non-200 status (with credit-exhausted detection
 *  preserved from the previous non-streaming implementation). When tools
 *  are provided, the agent loop in the POST handler runs multi-round. */
export async function openClaudeStream(args: {
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

// ── Shared agent loop (PR b) ────────────────────────────────────────────────
// Drives one or more rounds of Claude streaming + tool execution. Used by
// both POST /api/chat (fresh turn) and POST /api/chat/respond-to-tool (resume
// after user confirmed/cancelled a mutating tool). Caller passes:
//   - the open upstream stream to read from first
//   - the conversation state matching that upstream
//   - cumulative counters (text-so-far, tool_rounds, usage) — for resume,
//     these carry over from the pre-pause turn
// The loop:
//   1. Reads each upstream's SSE deltas, streaming text to the client.
//   2. Collects tool_use blocks + stop_reason per round.
//   3. On stop_reason "tool_use":
//        - If ANY tool requires confirmation, freezes state and emits
//          tool_request — returns without writing to chat history.
//        - Otherwise, executes the tools, appends turns, opens next stream.
//   4. On natural stop or round cap, persists assistant text + sends done.

export const MAX_TOOL_ROUNDS = 3;

export async function runAgentLoop(
  args: {
    date: string;
    file: ChatFile;
    systemText: string;
    convo: AgentMessage[];
    initialUpstream: Response;
    startRound: number;
    initialAssistantText: string;
    initialToolRounds: number;
    initialUsage: ClaudeUsage | undefined;
    totalEst: number;
    /** Agent config — provides the `agent.tools` policy. When omitted, the
     *  loop falls back to per-tool-kind defaults (auto for reads, confirm
     *  for mutating). respond-to-tool passes this through from the
     *  re-loaded user-context.yaml on resume so a yaml edit between turns
     *  takes effect on the next round. */
    agent?: AgentConfig;
  },
  send: (payload: unknown) => void,
): Promise<void> {
  const { date, file, systemText, totalEst } = args;
  // Effective policy resolver, closed over the call's agent config so a
  // future round doesn't have to re-resolve. Defaults to the per-tool-kind
  // fallback when no config was supplied.
  const policyFor = (name: string): ToolPolicy => {
    if (args.agent) return effectiveToolPolicy(name, args.agent);
    return MUTATING_TOOLS.has(name) ? "confirm" : "auto";
  };
  let assistantTextAcrossRounds = args.initialAssistantText;
  let usage: ClaudeUsage | undefined = args.initialUsage;
  let toolRounds = args.initialToolRounds;
  const convo = args.convo;
  let currentUpstream: Response | null = args.initialUpstream;

  for (let round = args.startRound; round < MAX_TOOL_ROUNDS; round++) {
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

    // Natural stop or no tools requested → exit the loop and persist.
    if (roundStop !== "tool_use" || roundTools.length === 0) {
      currentUpstream = null;
      break;
    }
    toolRounds++;

    // Resolve each tool's effective policy (auto / confirm / deny). The
    // confirmation gate only triggers for `confirm`; `auto` mutating tools
    // execute inline alongside reads; `deny` returns a synthetic refusal
    // tool_result that the agent reads as the user saying no.
    const toolsWithPolicy = roundTools.map((t) => ({ ...t, policy: policyFor(t.name) }));
    const confirmingTools = toolsWithPolicy.filter((t) => t.policy === "confirm");

    if (confirmingTools.length > 0) {
      // v1 single-mutation-per-round rule still applies when confirmation
      // is needed. Mixing one confirm-required tool with auto-policy reads
      // would mean the read result depends on whether the user accepts the
      // mutation — surprising behavior, so we reject.
      if (toolsWithPolicy.length > 1) {
        const errMsg =
          "[server constraint: a tool requiring confirmation (e.g. " +
          `${confirmingTools[0].name}) must be called alone in a round, ` +
          "not alongside other tools. Re-issue with just the confirming " +
          "tool, gathering any read data in a separate prior round.]";
        const assistantBlocks: ContentBlock[] = [];
        if (roundText) assistantBlocks.push({ type: "text", text: roundText });
        for (const t of roundTools) {
          assistantBlocks.push({ type: "tool_use", id: t.id, name: t.name, input: t.input });
        }
        convo.push({ role: "assistant", content: assistantBlocks });
        const toolResultBlocks: ContentBlock[] = roundTools.map((t) => ({
          type: "tool_result",
          tool_use_id: t.id,
          content: errMsg,
        }));
        convo.push({ role: "user", content: toolResultBlocks });
        currentUpstream = await openClaudeStream({
          systemText,
          messages: convo,
          tools: AGENT_TOOLS,
        });
        continue;
      }

      // Single confirm tool — pause for confirmation.
      const t = roundTools[0];
      const preview = buildConfirmationPreview(t.name, t.input);

      const assistantBlocks: ContentBlock[] = [];
      if (roundText) assistantBlocks.push({ type: "text", text: roundText });
      assistantBlocks.push({ type: "tool_use", id: t.id, name: t.name, input: t.input });
      convo.push({ role: "assistant", content: assistantBlocks });

      writePendingFile({
        date,
        system_text: systemText,
        convo,
        pending_tool: { id: t.id, name: t.name, input: t.input, preview },
        text_so_far: assistantTextAcrossRounds,
        tool_rounds: toolRounds,
        usage,
        total_est: totalEst,
        next_round: round + 1,
      });

      send({
        type: "tool_request",
        id: t.id,
        name: t.name,
        input: t.input,
        preview,
      });
      // paused: signals client the stream is closing intentionally (vs. an
      // unexpected disconnect). Final history is NOT persisted yet.
      send({
        type: "paused",
        debug: { tokens_estimate: totalEst, usage, tool_rounds: toolRounds },
      });
      return;
    }

    // Execute round. Each tool dispatches by policy + kind:
    //   - deny    → synthetic refusal tool_result (agent reads "user said no")
    //   - auto + read tool      → runTool (sync, returns text)
    //   - auto + mutating tool  → executeMutatingTool (async; for
    //                              regenerate_briefing's sync block we
    //                              forward progress events to the client)
    const assistantBlocks: ContentBlock[] = [];
    if (roundText) assistantBlocks.push({ type: "text", text: roundText });
    for (const t of roundTools) {
      assistantBlocks.push({ type: "tool_use", id: t.id, name: t.name, input: t.input });
    }
    convo.push({ role: "assistant", content: assistantBlocks });

    const toolResultBlocks: ContentBlock[] = await Promise.all(
      toolsWithPolicy.map(async (t) => {
        let content: string;
        if (t.policy === "deny") {
          content = `[tool denied by user-context policy: agent.tools.${t.name} = "deny"]`;
        } else if (MUTATING_TOOLS.has(t.name)) {
          // auto policy on a mutating tool. Forward progress events to the
          // chat stream so the panel's widget renders live (matches the
          // confirmation-flow shape — same `tool_progress` event type).
          content = await executeMutatingTool({ id: t.id, name: t.name, input: t.input }, (event) => {
            send({ type: "tool_progress", id: t.id, event });
          });
        } else {
          content = runTool(t);
        }
        return { type: "tool_result", tool_use_id: t.id, content };
      }),
    );
    convo.push({ role: "user", content: toolResultBlocks });

    currentUpstream = await openClaudeStream({
      systemText,
      messages: convo,
      tools: AGENT_TOOLS,
    });
  }

  // Hit the round cap with the loop still wanting tools — surface a notice
  // so the user sees something honest rather than dead silence.
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
      debug: { tokens_estimate: totalEst, usage, tool_rounds: toolRounds },
    });
    return;
  }
  send({
    type: "done",
    history: file.messages,
    debug: { tokens_estimate: totalEst, usage, tool_rounds: toolRounds },
  });
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
  // A fresh user message supersedes any prior unresolved confirmation. The
  // previous turn's pending tool_use never executed; its assistant text was
  // not persisted (held only in pending state). Silently discard it; the
  // user can re-issue if they meant to confirm. PR c's UI will catch this
  // case before POSTing.
  deletePendingFile(date);

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

  // Drive the multi-round agent loop via the shared helper. The helper
  // owns: streaming text to the client, collecting tool_use blocks,
  // pausing for confirmation on mutating tools, persisting on natural
  // stop. Same code path used by /api/chat/respond-to-tool on resume.
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      function send(payload: unknown) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      }
      try {
        await runAgentLoop(
          {
            date,
            file,
            systemText,
            convo: messages.slice() as AgentMessage[],
            initialUpstream: firstUpstream,
            startRound: 0,
            initialAssistantText: "",
            initialToolRounds: 0,
            initialUsage: undefined,
            totalEst,
            agent,
          },
          send,
        );
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
  // Surface unresolved confirmation state — the chat panel uses this on
  // hydration to re-render the confirmation card after a page refresh. We
  // deliberately don't ship `convo` or `system_text` (large + sensitive).
  const pending = readPendingFile(date);
  const pendingPayload = pending
    ? {
        tool_call_id: pending.pending_tool.id,
        name: pending.pending_tool.name,
        input: pending.pending_tool.input,
        preview: pending.pending_tool.preview,
        text_so_far: pending.text_so_far,
      }
    : null;
  return Response.json({ history: file.messages, pending: pendingPayload });
}
