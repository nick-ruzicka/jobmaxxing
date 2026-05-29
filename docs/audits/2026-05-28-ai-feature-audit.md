# AI feature audit — gap between vision and reality

**Date:** 2026-05-28 (drafted overnight 2026-05-29 UTC) · **Mode:** structural read of every AI surface against the stated vision. No code changes here; just findings + migration shape.

**Stated vision (quoting Nick):**
> "The agent has all the context on you as well as all the pipeline metrics, analytics, everything in the app. It can help you go through the jobs — it can do anything."

**Verdict in one line:** the AI is currently a **conversational summary of today's briefing summary**, not an agent-with-full-context. The gap is large but the migration path is well-defined — most of it is plumbing additional context into prompts + relocating the chat surface; the hard part is adding action capability (tool use).

---

## Vision vs reality matrix

| Pillar of the vision | What the code actually does | Gap |
|---|---|---|
| **"Full context on you"** | `buildPrompt()` includes `goals` (one paragraph) | Missing: CV (`cv.md`, 7.8 KB), profile (`config/profile.yml`), user-context (`config/user-context.yaml` incl. the new `archetype_fit`), score-overrides, application history |
| **"All the pipeline metrics, analytics, everything"** | Briefing is collapsed to `[idx] type: title — subtitle` lines | Missing: live roles, scores, statuses, signals, analytics rollups, source health, applications status |
| **"It can help you go through the jobs"** | Chat lives only on `/today` (the briefing page). Not visible on `/pipeline`, `/signals`, `/companies`, anywhere else | The agent cannot follow you to the job-browsing surface |
| **"It can do anything"** | The chat is prose-out-only — no tool use, no state mutations, no actions | Cannot mark applied, update status, draft a message, schedule follow-up, re-score a role, anything |

---

## Axis 1 — IA / navigation

**The architectural decision Nick is reconsidering** is encoded in `dashboard-web/app/page.tsx`:

```tsx
export default function Page() {
  redirect("/today");  // root URL → briefing-first landing
}
```

And `app/today/page.tsx` is documented as **"briefing-first, not table-first"**. So:

- `/today` (the briefing) is the homepage
- `/pipeline` (the table) is one click away
- Chat lives behind a button on `/today` only

Nick's new framing — *"AI as an assistant in the pipeline, not its own location"* — inverts this. The pipeline becomes the home, the briefing becomes a panel or banner inside it, the chat follows the user.

**Implication:** the redirect at `/` is a one-line change. The harder work is collapsing `/today`'s content into `/pipeline` as panels without losing the briefing's affordances.

---

## Axis 2 — State / context

**Where each AI surface reads from:**

| Surface | Reads | Misses |
|---|---|---|
| `/api/chat` (`buildPrompt`) | goals + today's briefing summary + chat history + optional itemContext | CV, profile, user-context, score-overrides, live pipeline, analytics, applications, signals, past chats from other days |
| `/api/briefing/regenerate` | Runs `scripts/generate-briefing.mjs` which **does** read full pipeline state + applications + scoring | Bounded by the briefing JSON shape — what gets generated is then frozen for the day |
| `/api/process-notes` | Reads one interview prep doc + meeting notes section | Same prompt-only, no agent-loop |
| `MorningBriefing.tsx` | Reads briefing items from props | No live role data — only what the generator captured into the JSON |

**The structural problem:** the **briefing-generation Claude call** has rich context; the **chat Claude call** has the post-generation summary. The agent talks to you about *the briefing's view of the world*, not the world itself.

**Cheapest fix:** thread more into `buildPrompt()`. Specifically:
1. Load `cv.md` (one-time read, 8KB; well within token budget)
2. Load `config/user-context.yaml` (compact, ~50 lines)
3. Load `getRoles()` filtered to roles the user has actively touched + the top-20 by score (probably 50-100 roles; needs compaction)
4. Load `data/applications.md` for active pipeline
5. Past chat history from N most recent days, not just today

That alone closes the "full context on you" gap.

---

## Axis 3 — Prompts / capability

**`buildPrompt()` structure (chat/route.ts:104-150):**

```
You are the user's job-search agent...
USER GOALS AND CONTEXT: <goals string>
TODAY'S BRIEFING (<date>): <one-line-per-item summary>
[optional itemContext block — JSON stringified]
CONVERSATION SO FAR: <transcript>
USER'S NEW MESSAGE: <message>

Respond directly in plain prose. No lists unless the user asks for one...
```

**No tool definitions.** No `tools=[...]` kwarg in the Claude call. The agent's only output channel is prose — same architectural limit CohortQA hit (and accepted, because that framework explicitly doesn't want side-effects).

For careerops, the user wants **the opposite** — actions are the point. Worth doing:

| Action the user might ask the agent to take | Required tool |
|---|---|
| "Mark Hebbia applied" | `update_application_status({slug, status})` |
| "Show me Hebbia's notes" | `read_prep_doc({slug})` |
| "Draft a follow-up to the Anthropic recruiter" | `draft_message({role_url, recipient_role, prompt})` |
| "Re-score Stripe — I learned they're remote-friendly" | `update_user_override({company_slug, kind: "boost"})` |
| "Run a fresh signal scan" | `trigger_scan({mode})` |
| "Who's stale in my pipeline more than 10 days?" | `query_roles({filter: stalled_days_gt: 10})` |

This is the *real* "it can do anything" — and it's substantial work. Per the per-archetype-experience-bar-v2 memory note's "v3" deferrals, tool-use is the natural place for the agent to consume `archetype_fit` and `user-context.yaml` at decision time.

---

## Axis 4 — UX / patterns

**Two concrete bugs, one a pattern:**

### Bug A — "View in pipeline" link is bare
`MorningBriefing.tsx:314`:
```tsx
<Link href="/pipeline" onClick={...}>View in pipeline <ArrowRight /></Link>
```

It's `/pipeline` (root), even though `/pipeline` supports `?company=X` and `?from=signals` query params (`pipeline-client.tsx:79-80`). The role's company is in the briefing item but isn't being threaded into the link. **One-line fix per link**, but it's a pattern: anywhere the briefing surfaces a role, the link should carry the role's identity.

### Bug B — Chat panel lives only on `/today`
`AgentChatPanel` is imported into `today-client.tsx` only. The chat literally cannot follow the user to `/pipeline`, `/signals`, `/companies`, etc. So when the user clicks "View in pipeline" from the briefing, they leave the chat context entirely.

### The pattern
**State-loss across navigation.** The briefing has a per-item `context` payload (free-form `Record<string, unknown>`) but no enforced schema, so the deep-link contract isn't typed. If the audit fix is just "add the company slug to the link," the pattern recurs. **The right shape:**
- BriefingItem gets a `role_url` and `company_slug` as first-class typed fields
- The chat panel becomes a global drawer (layout-level, not page-level)
- Navigating to /pipeline?role=<url> opens the panel scoped to that role

---

## Axis 5 — Operational + productization

The first four axes covered the architectural migration. This axis covers the concerns that hit *during and after* that migration — the stuff that turns a working prototype into a production assistant other people would use.

### 5a — Operational (hits during step 3+ implementation)

| Concern | Current state | What needs to land |
|---|---|---|
| **Streaming responses** | Non-streaming. Spinner shows "Thinking…" for 2-5s then full response renders. | Switch to streaming with `stream: true` on the Anthropic call. Render tokens as they arrive. Critical once responses get longer (tool use + bigger context). |
| **Prompt caching** | None. Every chat turn re-ships the full prompt (goals + briefing + history). Once CV + user-context + roles get threaded in, costs balloon. | Add `cache_control: {type: "ephemeral"}` on the stable prefix (system prompt + CV + user-context + briefing). 90%+ cache hit rate on the second turn within a session ≈ 10× cheaper. CohortQA's pattern is the reference. |
| **Token budget compaction** | No compaction layer. Step 3 says "keep < 20K tokens" without specifying how. | Define a compaction strategy: top-N roles by score, applications from last 30 days, CV always full, user-context always full, history capped at last 20 turns or last 14 days. Move the long-tail to a `query_roles` tool call instead. |
| **Tool failure handling** | N/A (no tools yet). When step 6 lands, what happens if `query_roles` throws or returns malformed data? | Each tool returns `{ ok: bool, result?: T, error?: string }`. Tool errors are passed back to the model as `tool_result.is_error: true` so it can recover. Surface a small "tool failed" indicator in the UI without breaking the chat. |
| **Loading states for slow tools** | N/A. Some tools (trigger_scan, regenerate_briefing) take 30-90s. | Streaming "Agent is running `trigger_scan`…" with a progress hint. Tool calls render as collapsible blocks in the conversation so the user knows what the agent is doing. |
| **Observability / audit log** | Chat history is the only record. No "what tools fired with what args." | Append every tool call + result to `data/chats/<date>.jsonl` (one event per line). Step 7's mutating tools especially — you want a record before debugging "wait, why did my pipeline change?". |
| **Confirmation UX for destructive tools** | N/A. Step 7 mentions "each needs confirmation" but not the pattern. | Two-phase: model proposes the mutation as a tool call → UI renders a diff/preview + ✓/✗ → user confirms → second tool call executes. Same pattern Claude Code uses for `Edit`. |
| **Per-tool authorization** | Single ANTHROPIC_API_KEY, single user, full trust. | For productization: per-user permission flags (e.g., `tools.update_application_status: confirm_each` vs `tools.trigger_scan: auto`). Lives in `user-context.yaml` alongside the other prefs. |

### 5b — Productization (when the audience is "any user", not Nick)

| Concern | Current state | What needs to land |
|---|---|---|
| **First-time onboarding** | Empty chat panel with one input box. New user has no idea what to ask. | Empty-state with 4-6 suggested prompts pulled from the user's actual state ("Why did Anthropic drop?" "Who's stale?" "What should I apply to today?"). Conditional on data presence. |
| **Capability discovery** | None. Users have to guess what the agent knows. | A `/capabilities` slash-command, or a small ⓘ that lists the tool catalog with examples. Once tools exist, this is mostly auto-generated from the tool definitions. |
| **Agent persona / voice** | Hardcoded in chat/route.ts:117 ("Be concrete, candid, and specific — name companies, score numbers… Push back when…"). Nick's voice, baked in. | Extract to `user-context.yaml`: `agent.voice: "direct"` / `"warm"` / `"analytical"` / `"custom: <prompt>"`. The hardcoded line becomes a default. |
| **Privacy posture** | CV → Anthropic on every chat (once step 3 lands). User has no opt-out per field. | Document what gets sent. Add optional `agent.redact: [salary_history, address, phone]` field. Long-term: support a self-hosted/local-model mode for sensitive fields. |
| **Mobile responsiveness** | `AgentChatPanel` is 480px slide-in, desktop-only design. | When chat moves to root layout (step 1), the responsive story has to be solved at the same time. Bottom-sheet on narrow viewports is the conventional pattern. |
| **Keyboard shortcuts** | None. | `Cmd+K` opens chat, `Cmd+Enter` sends, `Esc` closes panel. Table-stakes for an assistant the user opens dozens of times a day. |

### 5c — Memory / continuity

| Concern | Current state | What needs to land |
|---|---|---|
| **Cross-session memory** | Chats are per-day JSON files. Last Tuesday's chat about Anthropic is unreachable from today's session. | Two-tier: recent (last 14 days) is full prompt context, older is searchable via a `recall({query, since_date})` tool. Pruning is then a question of disk, not context. |
| **What persists vs what's session-only** | All chat history persists; nothing else. | Decide: do *user-stated facts* get persisted? ("I prefer remote roles" said in chat — should that get written to user-context.yaml? Or just remembered for the day?). Default: ephemeral with an explicit `pin_to_context` tool. |
| **Chat pruning** | 30-day retention (CHAT_PRUNING_DAYS, generate-briefing.mjs). | Probably fine for v1. Revisit when memory tooling lands. |

### 5d — Write-path mapping (blocker for step 7)

Before any mutating tool lands, every "write" needs a documented destination. Untracked drift is how state-of-truth degrades.

| Agent intent | Source-of-truth file | Updater function (exists / needs writing) |
|---|---|---|
| "Mark Hebbia applied" | `data/applications.md`? `data/seen-urls.json`? | **Both?** Needs investigation. There's `dashboard-web/app/api/update-status/route.ts` — start there. |
| "Add note about Anthropic recruiter" | `interview-prep/<slug>.md`? `data/applications.md`? | Check `api/save-notes/route.ts` for the existing pattern. |
| "Boost Stripe" | `data/score-overrides.json` | Direct write OK; the file is already user-owned. |
| "Skip BD-only roles" | `config/user-context.yaml`? | Likely. The archetype-fit gate we just shipped is the right plumbing — the agent updates the YAML field. |
| "Schedule follow-up for Friday" | ??? | No existing destination. Need a decision: add `data/follow-ups.json`, or punt to calendar integration. |

**Action item:** before tool #7 ships, write `docs/audits/2026-05-28-write-path-map.md` enumerating every mutation and its destination. Otherwise the first bug will be "the agent updated the wrong file and the dashboard didn't notice."

### 5e — Background runs + first-class panes (deferred features)

These aren't blockers for the migration; they're *what comes next* once the chat-as-assistant pattern works.

- **Background agent** — "while you sleep, the agent watches the pipeline and surfaces what changed when you open the app." Different from synchronous chat — runs on a cron or after a scan completes. Could surface findings as new briefing items or as inbox-style notifications.
- **"Agent right now" pane** — a persistent surface on `/pipeline` showing pending follow-ups, stale roles, action items the agent thinks you should look at. Complementary to chat, not redundant.

Both deserve their own scoping pass once steps 1-8 land. Noting them so they don't get re-discovered as "missing features" later.

---

## Recommended migration path (ordered by leverage)

The 8 architectural steps from before, with the operational concerns from §5 inlined as caveats:

| # | Step | Effort | Operational caveats (see §5) |
|---|---|---|---|
| **1** | **Move `AgentChatPanel` to the root layout** so it's available on every page. | Small (~2h) | Solve mobile/responsive at the same time (§5b). Add `Cmd+K` open shortcut (§5b). |
| **2** | **Make `/` redirect to `/pipeline` instead of `/today`.** Fold briefing into `/pipeline` as a top panel. | Small (~3h) | If retiring `/today`, redirect old bookmarks. |
| **3** | **Thread real context into `buildPrompt()`** — CV, user-context, roles (top 50 by score), applications, recent chat history. | Medium (~4h) | **Add prompt caching** (`cache_control: ephemeral`) on the stable prefix — without it, this step makes chat 10× more expensive (§5a). Switch to streaming responses while you're in the file (§5a). Document the compaction strategy (§5a). |
| **4** | **Type-fix `BriefingItem.context`** with explicit fields (role_url, company_slug, score, etc.). | Small (~1h) | — |
| **5** | **Fix "View in pipeline" link + similar deep-links** to use the typed fields. | Small (~30min, after #4) | — |
| **5.5** | **Write `docs/audits/2026-05-28-write-path-map.md`** enumerating every mutation the agent might propose + its destination file. | Small (~1h) | Blocker for step 7 (§5d). Better to have the doc before writing tool implementations. |
| **6** | **Add tool-use to the agent** — start with 3-4 **read** tools: `query_roles`, `read_prep_doc`, `get_company_summary`, `recall_past_chat`. | Medium (~6h) | Define tool error shape (§5a). Add tool-call rendering UI (collapsible block in the chat thread). Add observability — log every tool call to `data/chats/<date>.jsonl` (§5a). |
| **7** | **Add 2-3 mutating tools** — `update_application_status`, `add_note`, `update_user_override`. | Medium (~6h) | Two-phase confirmation UX (propose → preview/diff → confirm → execute) (§5a). Per-tool authorization flags in user-context (§5a). All writes go through the destinations mapped in #5.5 (§5d). |
| **8** | **Triggered actions** — `trigger_scan`, `regenerate_briefing`. | Medium (~4h) | Loading states with progress hints in chat (§5a). Streaming token-by-token output while the long action runs. |
| **9** | **Productization polish** — onboarding empty-states, capability discovery, persona extraction to `user-context.yaml`, privacy/redaction config, `user-context.example.yaml` template. | Medium (~5h) | Closes the v3 productization gap from the per-archetype-experience-bar memory note. |
| **10** | **(Deferred)** Background runs + first-class "agent right now" pane on `/pipeline`. | Large, scope-later | Out of the v1 critical path (§5e). |

**Revised estimate to the user-stated vision:** ~35-40 hours for steps 1-9 (the productizable v1). Step 10 is its own scoping pass.

---

## Out of scope for this audit

- **The OSS extraction** (the 3.9 MB of personal data baggage we discussed). That work is downstream — extract once the architecture matches the vision, not before.
- **Briefing content quality.** The audit didn't evaluate whether the briefing's recommendations are good — only the architecture around them.
- **Model selection.** Sticking with the current Claude default for now. Picking between Opus/Sonnet/Haiku per-tier (cheap classification on Haiku, conversation on Sonnet, complex tool-orchestration on Opus) is a separate optimization pass.
- **Self-hosted / local-model support.** Mentioned in §5b as a productization concern. Out of scope for v1 architectural migration; revisit if privacy-sensitive adopters become a real user segment.

---

## Recommended sequencing

The user's expressed priorities from the conversation were (in order): AI as assistant > AI bugs > OSS prep. That maps cleanly to:

1. **Now:** decide on the IA reframe (steps 1+2) — they're cheap and the most opinionated decisions
2. **Soon:** plumb context with caching from day one (step 3) — biggest "wow", and the caching/streaming caveats from §5a are non-negotiable here
3. **Then:** fix deep-link patterns (steps 4+5) + write the write-path map (5.5) — eliminates the bug class, unblocks step 7
4. **Then:** read tools (step 6), mutating tools (step 7), triggered actions (step 8) — the long arc to "agent can do anything", each with the operational concerns inlined
5. **Then:** productization polish (step 9) — onboarding, capability discovery, persona, privacy
6. **Eventually:** background runs + agent-right-now pane (step 10) — separate scoping
7. **After all of that:** OSS extraction recipe (similar to cohortqa) — extract once the architecture is what you want to publish

---

## Files touched (read-only inventory for this audit)

- `dashboard-web/app/page.tsx` — root redirect
- `dashboard-web/app/today/page.tsx` + `today-client.tsx` — briefing-first surface
- `dashboard-web/app/pipeline/pipeline-client.tsx` — table view, deep-link support
- `dashboard-web/app/api/chat/route.ts` — chat prompt assembly, persistence
- `dashboard-web/app/api/briefing/regenerate/route.ts` — briefing regen pipeline
- `dashboard-web/app/api/process-notes/route.ts` — interview-notes AI rewrite
- `dashboard-web/app/api/update-status/route.ts` — existing mutation surface (referenced in §5d)
- `dashboard-web/app/api/save-notes/route.ts` — existing mutation surface (referenced in §5d)
- `dashboard-web/components/AgentChatPanel.tsx` — chat UI
- `dashboard-web/components/MorningBriefing.tsx` — briefing display (deep-link bug source)
- `dashboard-web/lib/types.ts` — `BriefingItem` shape, untyped context field
- `scripts/generate-briefing.mjs` — daily briefing generator
- `config/user-context.yaml` — where the new productization fields land (agent.voice, agent.redact, tool authz)
