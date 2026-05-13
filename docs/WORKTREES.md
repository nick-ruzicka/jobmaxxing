# Worktrees & Terminals

This repo is worked from several git worktrees in parallel ("terminals"): `nick-career-ops`
(main), `nick-career-ops-sync`, `nick-career-ops-scan`, `nick-career-ops-design`. The `data/`
directory in the non-main worktrees symlinks to `nick-career-ops/data/` (single source of truth
for `enrichments.json`, `seen-urls.json`, `applications.md`).

## Node version (important)

`dashboard-web` is Next.js 16 + React 19 + Tailwind 4 + vitest 4 — these require **Node ≥ 20**
(Next mandates ≥ 20.9; vitest 4 needs ≥ 20.19). The machine's default `node` is **18.16.0**, which
will fail with `You are using Node.js 18.16.0. For Next.js, Node.js version ">=20.9.0" is required.`

Use the Homebrew `node@25` keg for all dashboard work — prefix `PATH` rather than changing the
global node:

```bash
export PATH="/opt/homebrew/opt/node@25/bin:$PATH"   # node 25.9.0, npm 11.x
cd dashboard-web && npm run dev      # / npm run build / npm test / npm run lint
```

If `node_modules` was last installed under Node 18, `@tailwindcss/postcss`'s native binding can be
broken (npm optional-deps bug) — `rm -rf node_modules && npm install` under Node 25 fixes it.

## Backlog (Phase 11 / housekeeping)

- **Pre-existing lint failures** in `dashboard-web` (unrelated to the comp-extraction sweep —
  leave them alone within feature work, fix in a dedicated pass): 4 errors + 6 warnings —
  `app/api/process-notes/route.ts` (`@typescript-eslint/no-require-imports` ×2),
  `app/api/update-status/route.ts` (`prefer-const`),
  `components/PipelineTable.tsx` (`react-hooks/set-state-in-effect` — `useEffect(() => setVisibleCount(50), [filtersKey])`),
  plus unused-import warnings in `app/signals/signals-client.tsx`, `components/FilterBar.tsx`,
  `components/PipelineTable.tsx`, `lib/data.ts`.
- Reconcile the two scoring paths (`scan-jobs.mjs` coarse `+2`/`min(4)` vs `score-overrides.json`
  precise `/5×2`) — see the TODO comment in `lib/data.ts`.
