#!/bin/bash
# Wrapper for launchd — sources .env and runs the scan
cd "$(dirname "$0")/.." || exit 1

# Load .env
if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

# sync-score-feedback.mjs reconciles score-overrides.json against applications.md and is
# dry-run by default — the automated pipeline needs --write to actually apply the reconciliation.
/opt/homebrew/bin/node scripts/sync-score-feedback.mjs --write
/opt/homebrew/bin/node scripts/scan-jobs.mjs
/opt/homebrew/bin/node scripts/enrich-roles.mjs

# Morning-only briefing regeneration. Opt-in: --from-cron makes the script a
# no-op unless scheduled_tasks.regenerate_briefing is true in
# config/user-context.yaml (a regen is a paid LLM call, so default is off).
# Hour gate keeps afternoon/evening scan runs from re-billing the briefing.
HOUR=$((10#$(date +%H)))
if [ "$HOUR" -lt 12 ]; then
  /opt/homebrew/bin/node scripts/generate-briefing.mjs --from-cron
fi

# Signal scan runs once daily (morning only, controlled by day-of-week check)
DOW=$(date +%u)  # 1=Monday
if [ "$DOW" -eq 1 ]; then
  # Weekly: signal scan + liveness check
  /opt/homebrew/bin/node scripts/scan-signals.mjs
  /opt/homebrew/bin/node scripts/check-liveness.mjs --apply

  # Monthly: prune stale roles (first Monday)
  DOM=$(date +%d)
  if [ "$DOM" -le 7 ]; then
    /opt/homebrew/bin/node scripts/prune-stale.mjs --apply
  fi
fi
