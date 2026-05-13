# Daily Briefing — Setup Notes

The `/today` route reads `data/briefings/YYYY-MM-DD.json`, produced by:

```bash
npm run briefing
```

That runs `scripts/generate-briefing.mjs`. The script:

- reads `data/enrichments.json`, `data/seen-urls.json`, `data/applications.md`,
  and `modes/_profile.md` (user goals) — falls back to a documented default
  if `_profile.md` is missing,
- pre-computes candidate pools (apply / follow-up / missed / verify-location
  / recalibrate) deterministically,
- makes **one** Claude API call (`ANTHROPIC_API_KEY` from `.env`) to compose
  the final briefing,
- writes `data/briefings/<today>.json`,
- writes `data/briefings/last-regen.json` (timestamp used by the on-demand
  regeneration rate limiter — Task 3),
- prunes `data/chats/*.json` files older than 30 days (Task 5 chat history
  retention).

## Cron — recommended setup (not configured automatically)

The hybrid runtime is "scheduled at 7am + on-demand from the UI." The
on-demand path is wired automatically (Regenerate button in the briefing
card). The scheduled path is a manual cron entry — we don't write to
`crontab` automatically because that's a per-machine concern.

To schedule a daily run at **7:00 AM Eastern**:

```cron
# m  h  dom mon dow   command
  0  7   *   *   *   cd /Users/nicholasruzicka/projects/job-search/nick-career-ops-agent && /opt/homebrew/opt/node@25/bin/node scripts/generate-briefing.mjs >> logs/briefing.log 2>&1
```

Install it with `crontab -e`. Verify with `crontab -l`. macOS will prompt for
"Full Disk Access" for `cron` the first time it runs — grant it in System
Settings → Privacy & Security → Full Disk Access if the logs show permission
errors.

If you prefer `launchd` (macOS-native), use a `.plist` in
`~/Library/LaunchAgents/`. There's no template here yet; ask the agent to
generate one if you want it.

## Troubleshooting

- **"ANTHROPIC_API_KEY is not set"**: the script loads `.env` at the project
  root. Confirm the file exists and contains a `ANTHROPIC_API_KEY=...` line.
  In worktrees, `.env` is symlinked from the canonical repo — verify the
  symlink target.
- **Briefing has 0 items**: not necessarily a bug. If the pipeline is genuinely
  quiet (no stale applications, no fresh high-fit Discovered roles, no
  unverified locations), the agent will return `{ "items": [] }` and `/today`
  renders the "No urgent actions today — pipeline is healthy" state.
- **JSON parse error after Claude call**: the parser is lenient (handles
  markdown fences and leading chatter) but will fail if the model returned
  prose. The agent has been instructed to return JSON only; if it drifts,
  add a few-shot example to `buildPrompt()` in `scripts/generate-briefing.mjs`.

## Pipeline Health Briefing

The `/sources` route runs the same architecture for the system-maintainer view:

```bash
node scripts/generate-pipeline-health.mjs   # or, equivalently:
node scripts/generate-briefing.mjs --kind=pipeline-health
```

See `scripts/generate-pipeline-health.mjs` for what it surfaces (extractor
regressions, new URL patterns, label opportunities, suggested commands).
