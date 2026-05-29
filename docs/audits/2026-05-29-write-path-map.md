# Write-path map — blocker doc for AI migration Step 7

**Date:** 2026-05-29 · **Mode:** inventory + recommendation. Pre-req for AI feature audit Step 7 (mutating agent tools). The audit §5d called this out: "Before any mutating tool lands, every 'write' needs a documented destination. Untracked drift is how state-of-truth degrades."

This doc enumerates every kind of mutation the agent might propose, identifies the source-of-truth file each one touches, and either points at an existing updater or flags what needs to be written. Without it, the first time the agent says "I'll mark Hebbia as Applied" we don't know if it should write to `data/applications.md`, `data/seen-urls.json`, or both — and the dashboard may or may not notice the change.

---

## Existing mutation endpoints — the foundation

Six API routes already exist for human-driven mutations. The agent tools in Step 7 should **reuse these** rather than writing to source-of-truth files directly. That guarantees the agent goes through the same validation + side-effects path the dashboard does.

| Endpoint | Source-of-truth file(s) | What it does | Reusable as agent tool? |
|---|---|---|---|
| `POST /api/update-status` | `data/applications.md` | Updates a role's status, upserting a new row if the role isn't already tracked. Matches on company + title (substring); falls back to upsert when no match. | **Yes — direct fit for `update_application_status` tool** |
| `POST /api/save-notes` | `interview-prep/<slug>.md` | Saves a "Meeting Notes" section into a prep doc. Creates the prep doc if missing. Idempotent: replaces existing Meeting Notes block. | **Yes — direct fit for `add_interview_notes` tool** |
| `POST /api/process-notes` | `interview-prep/<slug>.md` | Runs a Claude call to fold meeting notes into the prep doc's structured sections, then clears the Meeting Notes block. | **Yes — natural follow-up to `add_interview_notes`; could be auto-chained or exposed as `polish_prep_doc`** |
| `POST /api/apply-handoff` | `autoapply/*` (handoff payload) | Hands off a role to the autoapply pipeline (generates the personalized CV, drafts the cover letter, opens the apply queue). | **Yes — fits `start_application_handoff` tool, but heavyweight; needs confirmation UX** |
| `POST /api/briefing/regenerate` | `data/briefings/<date>.json` + `data/briefings/last-regen-daily.json` | Re-runs `scripts/generate-briefing.mjs`. Rate-limited to 1/5 min server-side. | **Yes — fits `regenerate_briefing` tool (Step 8 triggered action, not Step 7)** |
| `POST /api/run-scan`, `POST /api/run-signal-scan` | side-effect heavy (writes `data/seen-urls.json`, `data/enrichments.json`, etc.) | Triggers a fresh scan via `scripts/scan-jobs.mjs` / `scripts/scan-signals.mjs`. | **Yes — Step 8 triggered actions, not Step 7** |

---

## Proposed agent tools and their write paths

Each row lists a tool name, the agent intent it captures, the API endpoint or file it writes through, the confirmation pattern needed, and whether it's Step 7 (mutating) or Step 8 (triggered/heavy).

| Tool | Agent intent (example) | Writes through | Confirmation UX | Step |
|---|---|---|---|---|
| `update_application_status` | "Mark Hebbia as Applied" | POST /api/update-status | **Confirm** — show diff preview (status change + matched row) | **7** |
| `add_interview_notes` | "Add this note to the Anthropic prep: recruiter mentioned …" | POST /api/save-notes | **Confirm** — show the new Meeting Notes block | **7** |
| `polish_prep_doc` | "Fold those notes into the structured prep doc" | POST /api/process-notes | **Auto** if invoked right after `add_interview_notes`; **Confirm** otherwise | 7 |
| `update_score_override` | "Boost Stripe to 8 (recruiter confirmed remote)" | Direct write to `data/score-overrides.json` (no API yet — needs `POST /api/update-override`) | **Confirm** — show the override entry preview | **7 — needs new endpoint** |
| `update_user_context` | "Stop showing me Web3 BD roles" → set `archetype_fit.web3-bd.qualified: false` | Direct write to `config/user-context.yaml` (no API yet — needs `POST /api/update-user-context`) | **Confirm** — show the YAML diff | **7 — needs new endpoint** |
| `start_application_handoff` | "Hand off the Anthropic role to autoapply" | POST /api/apply-handoff | **Confirm** — show the role + drafted message preview | **7 (heavy)** |
| `regenerate_briefing` | "Regenerate today's briefing" | POST /api/briefing/regenerate | **Confirm** — explicit user ask; rate-limited server-side | 8 |
| `trigger_scan` | "Run a fresh scan" | POST /api/run-scan | **Confirm** — long-running, user-initiated | 8 |
| `schedule_followup` | "Schedule a follow-up with the Decagon recruiter for Friday" | **No destination exists** | Defer | **deferred — see "Open decisions"** |
| `query_roles` (already shipped #64) | "What roles do I have at Anthropic?" | Read-only — no write | None | 6 ✓ |
| `read_prep_doc` (already shipped #64) | "Show me my Hebbia prep" | Read-only — no write | None | 6 ✓ |

---

## Open decisions before Step 7 lands

### Decision 1 — `update_score_override` endpoint

There's no `POST /api/update-override` today. The `data/score-overrides.json` file is currently mutated only by `scripts/sync-score-feedback.mjs` (the human pipeline) and the dashboard's score-edit UI (if there is one — `dashboard-web/lib/score-overrides-edit.ts` would be a likely home).

**Recommendation:** add `POST /api/update-override` that accepts `{ company_slug, kind: "boost"|"penalize"|"block", score?, reason }` and writes through `scripts/lib/score-overrides.mjs::applyScoreOverrides`. This puts the tool on the same code path the dashboard uses if/when it grows manual-edit support, and means we don't have to re-derive the precedence rules in two places.

### Decision 2 — `update_user_context` endpoint

`config/user-context.yaml` is currently only edited by hand. The `archetype_fit` block we shipped in v1.9.0 is the most likely target — agent says "you keep skipping web3-bd, want me to set `archetype_fit.web3-bd.qualified: false`?"

**Recommendation:** add `POST /api/update-user-context` accepting `{ path: string[] (dot-path into the YAML), value }`. Validates that the path matches the expected schema before writing (so a hallucinated path doesn't corrupt the file). Backs up to `config/user-context.yaml.bak` before writing.

**Cheap-path alternative:** require the agent to return the full new YAML in the tool input, and the endpoint just validates + replaces. Simpler validation, more brittle to bad agent output. **I'd go with the structured-path version for safety.**

### Decision 3 — `schedule_followup` has no destination

The audit's "Schedule follow-up for Friday" example has no source-of-truth file. Options:

| Option | Pros | Cons |
|---|---|---|
| **A. New `data/follow-ups.json`** | Clean, self-contained, dashboard can render a "follow-ups due today" widget | Yet another data file; another pruning question; another schema |
| **B. Use `data/applications.md` Notes column** | No new file; the human-workflow target already | Hard to query "due Friday" without parsing free text |
| **C. Punt to calendar integration** | Real productization; users have calendars they already check | Out of v1 scope; requires OAuth / iCal / Google flow |

**Recommendation for v1:** skip `schedule_followup` entirely. The agent can SAY "follow up Friday" in chat and the user remembers (or doesn't). Adding it as a feature is calendar integration territory, which is its own design pass. Document it as a v2 productization item.

### Decision 4 — Confirmation UX pattern

The audit §5a flagged this:
> Two-phase: model proposes the mutation as a tool call → UI renders a diff/preview + ✓/✗ → user confirms → second tool call executes. Same pattern Claude Code uses for Edit.

The current Step 6 tool-use flow runs tools server-side automatically (transparent to the client). For mutating tools, that's wrong — the user needs to see "I'm about to mark Hebbia as Rejected" and confirm.

**Recommended pattern:**
1. Tool definition includes `requires_confirmation: true` (custom field; passed through but ignored by Anthropic, used by our server logic).
2. Server: when agent calls a `requires_confirmation: true` tool, instead of executing it, emit an SSE event `{ type: "tool_request", id, name, input, preview }` where `preview` is a human-readable diff/description.
3. Client: renders a confirmation card with ✓ / ✗ buttons.
4. User clicks ✓: client POSTs `/api/chat/confirm-tool` with `{ tool_call_id }`, server executes the tool, returns the result, and continues the agent loop where it left off (replaying the conversation + the tool_result).
5. User clicks ✗: client POSTs `/api/chat/cancel-tool` with `{ tool_call_id, reason? }`, server feeds a synthetic tool_result back to the agent saying "user declined this mutation; reason: …", continues the loop.

**Alternative (cheaper but worse UX):** auto-execute mutations but show a toast with "Undo" — only works for reversible writes, which most of these aren't (applications.md is human-edited and `git revert` is too coarse).

I'd go with the two-phase pattern. It's more code but it's the right shape.

---

## Implementation order for Step 7

1. **Add the two new endpoints** (`POST /api/update-override`, `POST /api/update-user-context`) — independent of agent tooling; usable by the dashboard separately later. ~2h.
2. **Implement the confirmation-tool flow** in `dashboard-web/app/api/chat/route.ts` — emit `tool_request` SSE events; pair endpoints `chat/confirm-tool` and `chat/cancel-tool` that resume the loop. ~2h.
3. **Add `update_application_status` and `update_score_override`** — the two highest-leverage mutating tools, both go through existing endpoints. ~1h.
4. **Add `update_user_context`** — wired to the new endpoint. ~1h.
5. **Add the confirmation UI in `AgentChatPanel`** — render the `tool_request` event as an in-chat card with ✓ / ✗. ~2h.

Total estimate: **~8h** for Step 7's MVP. Plus `polish_prep_doc` + `start_application_handoff` as v1.1 follow-ups (~2h more).

---

## What's deliberately NOT in this doc

- **Step 8 (triggered actions)** — `trigger_scan`, `regenerate_briefing`. These need progress-update streaming (different from the current single-turn tool flow) and deserve their own scoping pass. Noted in the proposed-tools table for completeness; not designed here.
- **Step 10 (background runs)** — the agent watching the pipeline while you sleep. Out of v1 scope; lands when v1 tool use is stable.
- **Mobile / responsive confirmation UX** — the confirmation card needs to work on narrow viewports too. Pair with the audit §5b mobile pass that's already deferred.

---

## Files touched (read-only inventory for this doc)

- `dashboard-web/app/api/update-status/route.ts` — existing mutation; the `update_application_status` tool wraps it
- `dashboard-web/app/api/save-notes/route.ts` — existing mutation; `add_interview_notes`
- `dashboard-web/app/api/process-notes/route.ts` — existing mutation + Claude call; `polish_prep_doc`
- `dashboard-web/app/api/apply-handoff/route.ts` — existing heavyweight; `start_application_handoff`
- `dashboard-web/app/api/briefing/regenerate/route.ts` — existing trigger; `regenerate_briefing` (Step 8)
- `dashboard-web/app/api/run-scan/route.ts`, `run-signal-scan/route.ts` — existing triggers; `trigger_scan` (Step 8)
- `data/score-overrides.json` — needs new endpoint
- `config/user-context.yaml` — needs new endpoint
- `dashboard-web/app/api/chat/route.ts` — current Step 6 tool loop; gets the confirmation extension in Step 7
- `dashboard-web/components/AgentChatPanel.tsx` — gets the in-chat confirmation card UI in Step 7
