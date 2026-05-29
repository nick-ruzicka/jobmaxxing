# Triggered actions — scoping doc for AI migration Step 8

**Date:** 2026-05-29 · **Mode:** inventory + recommendation. Pre-req for AI feature audit Step 8 (triggered actions / heavy jobs). Companion to [docs/audits/2026-05-29-write-path-map.md](./2026-05-29-write-path-map.md) which scoped Step 7's mutating tools.

The write-path map carved off "triggered actions" as deserving their own scoping pass because:

> Step 8 (triggered actions) — `trigger_scan`, `regenerate_briefing`. These need progress-update streaming (different from the current single-turn tool flow) and deserve their own scoping pass.

This doc settles the architecture and lists the implementation order. Three candidate tools, six decision points, ~6h of implementation work for v1.

---

## Existing endpoints — the foundation

Three API routes already exist for human-initiated triggers (the dashboard's "Run scan" / "Regenerate briefing" buttons). The Step 8 agent tools should reuse these (or extend them), not spawn child processes from `route.ts` directly.

| Endpoint | Underlying script | Latency | Current shape | Reusable? |
|---|---|---|---|---|
| `POST /api/briefing/regenerate` | `scripts/generate-briefing.mjs` | ~30s | `execFileAsync` blocking + JSON response. 5-min rate limit (per-kind file in `data/briefings/last-regen-<kind>.json`). Credit-exhausted → 402. | **Yes — already the right shape for sync blocking.** |
| `POST /api/run-scan` | `scripts/scan-jobs.mjs` | minutes (varies by source count × extraction cost) | `child_process.exec` with raw stdout/stderr streamed as `text/plain`. No rate limit. No timeout. No structured progress. | **Yes — but needs upgrade to SSE + structured events.** |
| `POST /api/run-signal-scan` | `scripts/scan-signals.mjs` | minutes | Same shape as `/api/run-scan`. | **Yes — same upgrade.** |

The mismatch is obvious: regenerate-briefing is a clean JSON endpoint, scan/run-signal-scan are debug-terminal streams. v1 of Step 8 should unify the wire shape so the agent loop and the chat panel can handle all three the same way.

---

## Proposed agent tools

| Tool | Agent intent (example) | Writes through | Confirmation UX | ETA |
|---|---|---|---|---|
| `regenerate_briefing` | "Regenerate today's briefing" | `POST /api/briefing/regenerate` | **Confirm** — shows last-regen-at + cooldown remaining | ~30s |
| `trigger_scan` | "Pull a fresh scan, I want to see what's new" | `POST /api/run-scan` (upgraded) | **Confirm** — shows last-scan-at + source count + cost estimate | minutes |
| `trigger_signal_scan` | "Run a signal scan, I haven't done one this week" | `POST /api/run-signal-scan` (upgraded) | **Confirm** — same shape | minutes |

All three reuse the Step 7 two-phase confirmation card. The card preview text just gets a "ETA: ~5 min · last run: 4h ago" line so the user knows what they're authorizing.

---

## Open decisions

### Decision 1 — Streaming model

The Anthropic tool-use protocol expects `tool_result` to be a single text block returned once. A 5-min scan can't literally stream its progress through `tool_result` — there's no "partial tool_result" wire shape. The agent sees the final summary; the user sees progress.

| Option | Pros | Cons |
|---|---|---|
| **A. Sync block, no progress** | Trivial — already how briefing/regenerate works | User stares at a spinner for 5 min with no signal |
| **B. Sync block + progress SSE events to the panel** | Agent unblocked, user gets a live progress widget. No new persistence. | If user closes the panel, progress is lost (scan completes server-side, but the chat doesn't see it). Sync-block freezes the chat for the duration. |
| **C. Kick-off + job registry** | Robust to disconnects; chat stays interactive | More surface area — new persistence (`data/scans/<job_id>.json`), detached spawn |

**Resolved: split by tool based on actual runtime data.**

Measured from `logs/scan-morning.log` / `logs/scan-evening.log`:

| Job | Typical runtime | Worst case observed |
|---|---|---|
| `regenerate_briefing` | ~30s | 90s (script timeout ceiling) |
| `trigger_scan` (incremental) | 2-5 min | 30+ min (763-role enrichment backlog; today's morning run was cut off mid-flight at the 27-min mark) |
| `trigger_signal_scan` | 2-5 min | similar |

Scans are squarely in the "routinely multi-minute" zone, so sync-block would mean a 5-min hostage panel in the common case. Splitting Decision 1:

- **`regenerate_briefing`** → **Option B** (sync block + progress widget). 30s is well under the threshold; widget shows live progress in the same slot the confirmation card occupied. Agent's `tool_result` text summarizes the new briefing items.
- **`trigger_scan` / `trigger_signal_scan`** → **Option C — minimal version**. Server starts the script with `spawn` (detached so the Next.js process can exit cleanly without orphaning), writes a job record to `data/scans/<job_id>.json`, returns the job_id to the agent immediately. Tool_result text is `[scan started · job_id=X · ETA ~5min · results will show on /today when done]`. Agent stays interactive — user can keep chatting. **No status-poll tool in v1** — the dashboard's existing `/today` surfaces results, and a future v1.1 `check_scan_status` tool can read the same JSON file if the user wants in-chat updates.

Minimal-version surface area for Option C:
1. One job-record file format: `data/scans/<job_id>.json` with `{ status, kind, started_at, ended_at?, summary?, progress_log_path }`. Write-only by the server, read-only by clients.
2. `spawn` with `detached: true` and `stdio: ["ignore", fd, fd]` redirecting stdout/stderr to a per-job log file at `data/scans/<job_id>.log` (or a JSONL progress file when `--progress-json` is set).
3. A small "completion watcher" that updates the job record's `status` from `running` to `completed` / `failed` when the child exits. Implementation: register a `child.on("close")` handler before detaching — Node's event loop holds the listener alive even on detached children as long as the parent's `unref()` is NOT called on the IPC channel.
4. No new poll endpoint in v1. If the agent ever needs to check, it reads the JSON file directly (same project root as everything else).

Estimated extra work vs sync-block for the two scans: **+1h** (worth it; 5-min hostage panels would feel broken).

### Decision 2 — Structured progress from the scripts

`scan-jobs.mjs` currently prints unstructured text:

```
=== Job Scan — 2026-05-29 ===
[Tier 1] Ashby API — 47 companies
  Found 12 matching roles (3 404s)
[Tier 1] Greenhouse API — 23 companies
  Found 4 matching roles (1 404s)
```

The route parses this into SSE events how?

| Option | Pros | Cons |
|---|---|---|
| **A. Regex-parse stdout in the route** | No script changes | Brittle — every print-statement edit breaks parsing |
| **B. Add `--progress-json` flag to the scripts; emit one JSON object per line** | Stable contract; script and route evolve independently | Touches every long-running script (3 of them) |
| **C. Sidecar status file the script writes to** | Decoupled from stdout entirely | Polling overhead; extra fs trips |

**Recommendation: B.** Add a `--progress-json` flag to `scan-jobs.mjs` / `scan-signals.mjs` / `generate-briefing.mjs`. When set, emit one line per progress event:

```jsonl
{"type":"start","ts":"2026-05-29T14:00:00Z","total_sources":47}
{"type":"source_done","source":"ashby","ok":12,"errors":0,"ms":340}
{"type":"source_done","source":"greenhouse","ok":4,"errors":1,"ms":210}
…
{"type":"done","ok":47,"errors":3,"new_roles":12,"duration_ms":323000}
```

Default output (no flag) stays the existing human-readable text — preserves terminal use + the existing dashboard "Run scan" button behavior. The agent route passes `--progress-json` and parses line-by-line. Total script-side work: ~30 min per script (3 scripts).

### Decision 3 — Rate limiting

`regenerate_briefing` already has 1/5 min via `data/briefings/last-regen-<kind>.json`. Scans are heavier; need their own throttle.

| Tool | Proposed cooldown | Override path |
|---|---|---|
| `regenerate_briefing` | 5 min (existing) | None — the cooldown is short enough |
| `trigger_scan` | 15 min | `force: true` in tool input; preview shows the cooldown so user sees what they're skipping |
| `trigger_signal_scan` | 15 min | Same |

The cooldown timestamp lives in `data/briefings/last-regen-<kind>.json` (briefing) and proposed new `data/scans/last-scan-<kind>.json` for scans. Lift the read/write into `dashboard-web/lib/rate-limit.ts` so all three endpoints share the implementation.

The tool's confirmation preview should fetch the last-run timestamp and display it:

```
Run full scan
  Last scan: 4h 12m ago
  Sources: ~47 (Ashby + Greenhouse + Lever + YC + Exa)
  ETA: ~5 minutes
  Cost: ~50 Claude calls for enrichment
```

If still cooling down:

```
Run full scan — COOLDOWN ACTIVE
  Last scan: 8m ago (cooldown lifts in 7m)
  Re-confirm with "force: true" to override
```

### Decision 4 — Cancellation

5-minute scans need a stop button. But the v1 sync-block model doesn't have a clean cancel point — the agent loop is awaiting `tool_result`.

**Recommendation for v1: no cancellation.** The scan runs to completion or times out (90s for briefing, ~7 min hard ceiling for scans). The user can close the panel; the scan finishes server-side; the chat loses the result. Not ideal but contained.

v2: add `POST /api/chat/cancel-tool-execution` that SIGTERMs the child process. Server returns a "cancelled" tool_result to the agent. Same shape as `respond-to-tool` but for in-flight tools.

### Decision 5 — UI affordance

Progress widget design:

```
┌──────────────────────────────────────────────────┐
│ ⚡ Running: trigger_scan                         │
│                                                  │
│ Scanning Greenhouse API — source 18 of 47        │
│ ████████████░░░░░░░░░░░░░░░░░░░  38%             │
│                                                  │
│ Found so far: 7 new roles · elapsed 1m 47s       │
└──────────────────────────────────────────────────┘
```

Replaces the confirmation card in the same slot after the user clicks Confirm. Collapses to a one-line summary on `tool_finished`:

```
✓ Scanned 47 sources, 12 new roles · 5m 23s
```

The agent's follow-up text streams in below, summarizing in its own voice ("Found 12 new roles. Two stand out: …").

If the scan fails mid-flight (script exit code ≠ 0, network error, etc.), the widget shows the failure inline and the agent gets `[trigger_scan failed: <reason>]` as its tool_result so it can react.

### Decision 6 — Confirm vs auto via `agent.tools` policy

The deferred Step 9 leftover is the `agent.tools:` block in `user-context.example.yaml` that's documented but not honored. It defines per-tool policies:

```yaml
agent:
  tools:
    query_roles: auto
    read_prep_doc: auto
    update_application_status: confirm
    trigger_scan: confirm
    regenerate_briefing: confirm
```

Step 8's natural pairing: **make this block live as part of the same PR.** Default for triggered actions stays `confirm`. Power user can opt one or two into `auto` for routine work (e.g. `regenerate_briefing: auto` for the morning workflow).

`deny` doubles as a safety/productization hook: a forked deployment for a user who doesn't want the agent kicking off scans at all can set everything to `deny` and the agent will refuse cleanly.

---

## Wire shape

New SSE events from the chat stream during a triggered action:

```jsonc
// After confirmation, before execution starts
{ "type": "tool_started", "id": "toolu_…", "name": "trigger_scan", "eta_seconds": 300 }

// One per progress event from the script's --progress-json output
{ "type": "tool_progress", "id": "toolu_…", "step": 18, "total": 47, "message": "Scanning Greenhouse API — source 18 of 47" }

// On completion (replaces the progress widget with the summary line)
{ "type": "tool_finished", "id": "toolu_…", "ok": true, "summary": "Scanned 47 sources, 12 new roles", "duration_ms": 323000 }
```

The `tool_result` text the agent sees (and the `delta`/`done` flow afterward) is unchanged from Step 7. The new events are purely for the UI's progress widget.

---

## Implementation order

1. **`--progress-json` flag in the three scripts** — backward-compatible. Each script gains a `--progress-json` arg; when set, emits one JSON object per line instead of human-readable text. Each script also emits a final `{ "type": "done", … }` line with a structured summary. **~1h** across all three.
2. **Lift rate-limit helper** into `dashboard-web/lib/rate-limit.ts` — read/write a `last-run-<kind>.json` sidecar; shared by all three endpoints. **~30 min.**
3. **Refactor `/api/run-scan` and `/api/run-signal-scan` to SSE** — parse `--progress-json` line-by-line, emit `tool_progress` SSE events, return a structured summary on `done`. Also add rate limiting via the lib. **~1.5h.**
4. **Three new tool definitions in `AGENT_TOOLS`** — `regenerate_briefing`, `trigger_scan`, `trigger_signal_scan`. Add to `MUTATING_TOOLS` (the existing confirmation gate works). Build per-tool confirmation previews that show last-run-at + ETA. **~30 min.**
5. **Extend `executeMutatingTool` for trigger tools** — calls the appropriate endpoint, consumes the SSE stream, forwards `tool_progress`/`tool_finished` events through the chat SSE stream to the panel, builds the structured tool_result text the agent sees. **~1.5h.**
6. **`AgentChatPanel` progress widget** — new component that renders during `tool_progress` events, collapses on `tool_finished`. Reuses the slot the confirmation card occupies. **~1.5h.**
7. **Honor `agent.tools` policy** (closes the Step 9 deferred item) — read the block in `loadAgentConfig`, gate tool execution by policy: `auto` runs without the confirmation card, `confirm` keeps the current behavior, `deny` makes the agent's tool call return `[tool denied by user-context policy]`. **~1h.**

Total v1: **~7.5h** (revised up from the earlier "~6h" estimate after looking at the actual /api/run-scan shape — it needs more refactoring than I thought).

---

## What's deliberately NOT in v1

- **Cancellation UI** (Decision 4) — sync-block model doesn't have a clean cancel point; v2 work.
- **Persistent job registry** (Decision 1, option C) — graduate to this for `trigger_scan` in v2 when disconnect-loss becomes a real problem.
- **Multi-job parallelism** — agent can only have one trigger tool in flight at a time. Same constraint as Step 7's mutating tools. Future work if a user actually wants "scan + regenerate briefing" in parallel.
- **Cron-aware regenerate** — `com.jobops.scan-morning.plist` and `com.jobops.scan-evening.plist` already trigger scans on schedule. The agent should ideally know "scheduled scan is 2 hours away, want me to wait?" but that's a v2 productization concern.
- **Step 10 (background runs)** — the agent watching the pipeline while you sleep. Separate scoping pass once trigger tools are stable in v1.

---

## Files touched

For implementation reference. Read-only inventory; no edits in this doc.

- `scripts/scan-jobs.mjs` — add `--progress-json` flag
- `scripts/scan-signals.mjs` — add `--progress-json` flag
- `scripts/generate-briefing.mjs` — add `--progress-json` flag (also surfaces structured summary for the existing /api/briefing/regenerate endpoint)
- `dashboard-web/lib/rate-limit.ts` — NEW; shared cooldown helper
- `dashboard-web/app/api/run-scan/route.ts` — refactor to SSE + structured progress
- `dashboard-web/app/api/run-signal-scan/route.ts` — same
- `dashboard-web/app/api/briefing/regenerate/route.ts` — minor: emit progress when invoked with `?progress=sse` so the new pattern is uniform (preserves the existing JSON shape when called without the flag)
- `dashboard-web/app/api/chat/route.ts` — new tool defs; extend `executeMutatingTool` + the agent loop's SSE forwarding
- `dashboard-web/components/AgentChatPanel.tsx` — new ProgressWidget component; new event handling in `consumeChatStream`
- `config/user-context.example.yaml` — annotate the `agent.tools` block as LIVE (currently documented as not-yet-live)
