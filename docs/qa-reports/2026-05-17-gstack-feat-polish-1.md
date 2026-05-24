# QA Report — JobOps dashboard (feat/polish-1)

- **Target:** http://localhost:3000 (`next dev` Turbopack, Next.js 16.2.3, React 19.2)
- **Date:** 2026-05-17
- **Mode:** Diff-aware (branch: `feat/polish-1`, 8 modified routes/APIs)
- **Auth:** none required (local dev)
- **Screenshots:** `.gstack/qa-reports/screenshots/`

## Summary

| Severity | Count |
|---|---|
| Critical | 1 |
| High | 5 |
| Medium | 5 |
| Low | 4 |

**Health score: 52 / 100** — One server-side crash takes out 1 of 6 new/changed routes, plus a cluster of data-consistency bugs where the same entity reports different counts/states across views. Polish bugs are minor; the data layer is what's bleeding.

### Top 3 Things to Fix

1. **🔴 `/qa-reports` page + `/api/qa-reports` both crash on load** — homegrown `yaml-mini.mjs` doesn't support YAML folded scalars (`>`). All 6 persona files use `background: >`, so loadPersonas throws and the page renders an unstyled "Something went wrong" error boundary with no sidebar/nav.
2. **🟠 Same company shows different counts/states across views** — Mistral AI is "WARMING · 1 matching role · Acting On Now" on /signals, but `/api/companies/mistralai` returns `roles: []`, `hiring_velocity: "cold"`. Pipeline filtered to that company shows 0 of 1262 even with all filters cleared. EliseAI: list says 13 roles, drilldown says 26, badges sum to 16.
3. **🟠 Sidebar nav badges are unstable across routes** — "Signals" pill shows `15` on /today, `21` on /signals, `15` on /pipeline. Same component, same label, three numbers in one session. Suggests the sidebar pulls live data on /signals but a stale snapshot elsewhere.

---

## Issues

### ISSUE-001 — /qa-reports crashes with YAML parser error (CRITICAL · Functional)
- **Severity:** Critical
- **Category:** Functional
- **Pages:** `/qa-reports`, `GET /api/qa-reports`
- **Evidence:** `screenshots/06-qa-reports.png`

**Repro:**
1. Navigate to `http://localhost:3000/qa-reports`
2. Page renders a bare-screen "Something went wrong / yaml: unexpected indent on line 5: AI Operations Lead at a Series A AI startup. Wears every operational" with a "Try again" button
3. **Sidebar disappears entirely** — user has no nav until they hand-type a URL or use browser back
4. `curl http://localhost:3000/api/qa-reports` → `HTTP 500` (empty body)

**Root cause:** `dashboard-web/lib/qa-reports.ts` (line 13) imports `parseYaml` from `scripts/lib/yaml-mini.mjs` — a 246-line homegrown parser that does not implement YAML folded scalars (`>` on `background:`). All 6 persona files under `qa/personas/` use folded scalar syntax. Reproduced directly:

```
$ node -e "const {parseYaml} = await import('./scripts/lib/yaml-mini.mjs'); …"
ERR: yaml: unexpected indent on line 5:     AI Operations Lead at a Series A AI startup. Wears every operational
```

**Suggested fix:** swap `yaml-mini` for `js-yaml` (already in `package-lock.json` at `^4.1.1`) for persona loading specifically, *or* reformat all 6 persona files to inline strings, *or* extend `yaml-mini` to support `>` and `|`.

**API divergence note:** the page exposes the raw YAML parser message to the user; the API returns an empty 500. Pick one error surface.

---

### ISSUE-002 — Same company has 3 different counts/states across views (HIGH · Functional/Data integrity)
- **Severity:** High
- **Category:** Functional
- **Pages:** `/signals`, `/companies/[slug]`, `/pipeline?company=…`
- **Evidence:** `screenshots/04-signals.png`, `04b-signals-mistral-click.png`, `04c-signals-mistral-allfilter.png`

**Repro:**
1. Go to `/signals` — Mistral AI is in "Acting On Now (1)" with badges `WARMING`, `$830M`, `1 matching roles`, `AI Ops`
2. Click the Mistral AI card → routes to `/pipeline?company=mistralai&from=signals`
3. Pipeline page renders: "0 of 1262 roles · No roles match your filters"
4. Click the `All` score-filter and confirm: still "0 of 1262 roles"
5. `curl http://localhost:3000/api/companies/mistralai` returns:
   - `roles: []`
   - `hiring_velocity: "cold"`
   - `archetype_distribution: {}`

Three sources of truth, three different answers. Companies list shows EliseAI with "13 roles"; the drilldown header says "OPEN ROLES (26)"; the archetype badges sum to 16 (GTM Eng·10 + AI Ops·5 + Web3 BD·1).

**Likely cause:** the Signals data layer (signals page) and the Companies/Pipeline data layer (drilldown + table) compute "matching roles" from different snapshots or different filters. The drilldown badges and the Open Roles count appear to filter differently (badges may exclude aggregator/null-archetype rows; list may dedupe by title; drilldown table dumps everything).

**Suggested fix:** define one canonical "open roles for company X" query, reuse it in three places.

---

### ISSUE-003 — Sidebar "Signals" badge changes value across routes (HIGH · Functional)
- **Severity:** High
- **Category:** Functional
- **Pages:** all routes (sidebar)
- **Evidence:** `screenshots/01-today.png` (`Signals 15`), `04-signals.png` (`Signals 21`), `02-pipeline.png` (`Signals 15`)

**Repro:**
1. `/today` → sidebar shows "Signals **15**"
2. Click "Signals" → /signals → sidebar shows "Signals **21**"
3. Click "Pipeline" → /pipeline → sidebar shows "Signals **15**" again
4. Bottom-of-sidebar indicator consistently reads "65 signals" across all three

The page header on /signals reads `65 tracked · 1 acting · 20 warming · 44 monitor · 2 filtered`. None of 15, 21, 65 line up with each other.

**Suggested fix:** decide what the sidebar pill means (acting-only? warming+acting? "needs attention"?), document it, and compute it server-side once.

---

### ISSUE-004 — Signal→Pipeline bridge sets search but not filters; URL contract broken (HIGH · UX)
- **Severity:** High
- **Category:** UX / Functional
- **Page:** `/pipeline?company=…&from=signals`

Even if ISSUE-002 weren't a data bug, the bridge UX is broken: clicking a signal card lands the user on a Pipeline view where the default `4+` score filter and `Discovered` status pill are still active, so legitimately-low-fit "matching roles" wouldn't show. The bridge should land with **all filters cleared** when arriving via `from=signals`, or it should apply only `company=` and leave everything else open.

**Suggested fix:** in the pipeline page, treat `?from=signals` as "show me everything for this company; don't pre-apply scoring/status filters."

---

### ISSUE-005 — `/analytics` route loses the sidebar entirely (HIGH · Navigation)
- **Severity:** High
- **Category:** UX / Navigation
- **Page:** `/analytics`
- **Evidence:** `screenshots/08b-analytics-viewport.png`

**Repro:**
1. From any page, click "Analytics" in the sidebar
2. Analytics renders full-width; the JobOps sidebar disappears
3. No back-link, no breadcrumb — user must browser-back or retype a URL to return

Every other workspace page (`/today`, `/pipeline`, `/signals`, `/companies`, `/companies/[slug]`, `/sources`, `/qa-reports`) keeps the sidebar. `/design-system` is also full-width but that's a documentation page, not a workspace destination.

**Suggested fix:** wrap `/analytics` in the same workspace layout shell.

---

### ISSUE-006 — Analytics funnel disagrees with /today + /pipeline counts (HIGH · Data)
- **Severity:** High
- **Category:** Content / Data
- **Page:** `/analytics`
- **Evidence:** `screenshots/08b-analytics-viewport.png`

Pipeline Funnel widget (30d): Discovered **0**, After dedup **0**, After filter **0**, Enriched 3, High-fit 3, Applied **0**.

But on `/today` the stats card reads "517 Discovered", `/pipeline` has a "Discovered 891" status pill and "Applied 23" pill. Analytics says applications: 0 and discoveries: 0. The "Pipeline Efficiency 0 → 3 / no discoveries yet" tile contradicts the headline "517 Discovered" two routes away.

**Suggested fix:** the Analytics funnel is probably scoped to "today's discoveries on this branch" while the stats cards are all-time. Make the time window explicit on every card so a user can reconcile.

---

### ISSUE-007 — Pipeline header reports 3 mutually-inconsistent totals (MEDIUM · Content)
- **Severity:** Medium
- **Category:** Content
- **Page:** `/pipeline`
- **Evidence:** `screenshots/02b-pipeline-all.png`

On a single page, with the `All` score filter and no status filter pressed:
- Page header: "Pipeline · **931** roles"
- Right of search bar: "**931** of **1262** roles"
- Stat card: "**517** Discovered · 202 NYC / 324 Remote"
- Status row pill: "Discovered **891**"
- Status row pill: "Stale **332**", "Aggregator **331**"

The stat card "517 Discovered" is identical to the count produced by the `4+` filter — so the card label is misleading; it should read something like "Active 4+" or "Pursuing-eligible". 931 vs 1262 is also confusing without a tooltip ("active dataset vs all-time").

**Suggested fix:** rename or tooltip the stat cards so labels match what they actually count. Pick one canonical "total" for the header.

---

### ISSUE-008 — Company list ↔ drilldown role counts disagree (MEDIUM · Data)
- **Severity:** Medium
- **Category:** Content / Data
- **Page:** `/companies`, `/companies/[slug]`
- **Evidence:** `screenshots/05-companies.png`, `05b-eliseai.png`

- `/companies` table: **EliseAI = 13 roles**
- `/companies/eliseai`: header badges sum to **16** (GTM Eng·10 + AI Ops·5 + Web3 BD·1), Open Roles header says "**(26)**"
- Same disagreement on Rillet: list says 2 roles, drilldown says 4.

**Suggested fix:** see ISSUE-002 — single canonical "open roles for company X" query.

---

### ISSUE-009 — Duplicate-looking rows in Open Roles with no disambiguation (MEDIUM · UX)
- **Severity:** Medium
- **Category:** UX / Content
- **Page:** `/companies/[slug]`
- **Evidence:** `screenshots/03-company-rillet.png`

On `/companies/rillet`, "Sara's List - GTM Engineer at Rillet" appears twice with identical title, identical "—" archetype, identical "—" score. The API confirms they're technically distinct (different IDs and different links — one NY listing, one SF) but the UI gives the user no way to tell them apart. Looks like a bug, isn't quite one, but reads as one.

**Suggested fix:** show city/location in the row, or collapse aggregator entries from different sources under a "view alt postings" disclosure.

---

### ISSUE-010 — `View in pipeline` from Rillet drilldown not exercised; in-table company link doesn't navigate (MEDIUM · Functional)
- **Severity:** Medium
- **Category:** Functional
- **Page:** `/pipeline` row-cell company links

Clicking the Rillet anchor inside a pipeline row (`@e68 [link] "Rillet"` in the cell) did not navigate to `/companies/rillet`. URL stayed at `/pipeline`. Direct nav to `/companies/rillet` works. So the in-row link is either pointing nowhere, or its click is being swallowed by the row-expander handler. Compared to that, clicking the company name on `/companies` (the list page) **does** navigate correctly — so the link target exists, just not wired in the pipeline table.

**Suggested fix:** confirm the `<a>` on company-cells in `PipelineTable.tsx` is a real link (not absorbed by `onClick` row toggle) and routes to `/companies/[slug]`.

---

### ISSUE-011 — "Never show this company again" is a one-click destructive action with no confirm or undo (LOW · UX)
- **Severity:** Low
- **Category:** UX
- **Page:** `/signals`

The dismiss X on each signal card writes `excluded_companies` to `user-context.yaml` permanently (per branch commit `1b25066 feat(signals): permanent dismiss action — writes excluded_companies to user-context.yaml`). No confirmation, no toast with undo, no visible "Manage dismissed companies" surface anywhere I could find. One stray click = company removed forever.

**Suggested fix:** add a 5-second toast with "Undo", or a confirmation dialog, or a managed-excluded-list page (e.g., under `/context`).

---

### ISSUE-012 — Content sloppiness: title casing, name parsing, truncated pills (LOW · Content)
- **Severity:** Low
- **Category:** Content
- **Pages:** `/pipeline`, `/companies/[slug]`

Caught in passing:
- `/pipeline`: company name "**Clockwork Systems, .**" — trailing `,` then `.` literal, never trimmed
- `/pipeline`: location pill "**Remote (Excludes Hav**" — truncated mid-word with no ellipsis and no hover tooltip
- `/companies/eliseai`: role title "**Gtm Engineer**" (lowercase tm) appears beside "**GTM Engineer**" — case-folding inconsistency in role titles
- `/signals`: card "**Applied AI Lab depthfirst**" — `depthfirst` looks like a source-attribution tag that got concatenated into the company name

**Suggested fix:** strip trailing punctuation in name normalizer; enforce uppercase GTM in role titles; render the source attribution as a separate badge instead of as inline text.

---

### ISSUE-013 — Singular/plural copy and badge case (LOW · Content)
- **Severity:** Low
- **Category:** Content
- **Pages:** `/signals`, `/companies/[slug]`

- `/signals` Mistral AI card: "**1 matching roles**" → should be "1 matching role"
- Hiring-velocity badges mix styles: `WARMING` (small blue) on Rillet vs `ON FIRE` (small red) on EliseAI — both upper case, fine — but the visual treatment difference is heavy. Confirm it matches `DESIGN.md` token classes; the live spec is at `/design-system`.

---

### ISSUE-014 — `/api/qa-reports` 500 returns empty body (LOW · API hygiene)
- **Severity:** Low
- **Category:** Functional / API
- **Page:** `GET /api/qa-reports`

When the underlying YAML parse throws, the API returns `HTTP 500` with **0 bytes** — no JSON error shape. The /qa-reports page leaks the raw parser message to the user. Pick one: either both surface a structured `{"error":"persona_load_failed","slug":"ai-ops-lead-early-stage","line":5}` or both surface a generic "Something went wrong" — but be consistent.

---

### ISSUE-015 — Next.js dev warning: multiple lockfiles → wrong workspace root (LOW · Dev hygiene)
- **Severity:** Low
- **Category:** Dev / config
- **From:** `next dev` startup log

> Warning: Next.js inferred your workspace root, but it may not be correct. We detected multiple lockfiles and selected the directory of `$HOME/package-lock.json` as the root directory.

There's a stray `package-lock.json` in `$HOME` (not the project) that's confusing Turbopack's root inference. Either delete the home-dir lockfile or set `turbopack.root` in `next.config`. Not user-facing but spammy in dev logs.

---

## Console health

Across all routes visited, the only server-thrown error was the YAML parser (ISSUE-001), and it only fired on `/qa-reports` initial load. No client-side hydration errors observed (the recent commit `9284bb3 fix(dashboard): eliminate duplicate React keys + nested <a> hydration errors` appears to have stuck — `/today` and `/pipeline` are clean).

## Pages visited

| Route | Status | Console clean |
|---|---|---|
| `/today` | 200 | ✅ |
| `/pipeline` | 200 | ✅ |
| `/signals` | 200 | ✅ |
| `/companies` | 200 | ✅ |
| `/companies/rillet` | 200 | ✅ |
| `/companies/eliseai` | 200 | ✅ |
| `/qa-reports` | 200 (server-side error rendered in client error-boundary) | ❌ |
| `/sources` | 200 | ✅ |
| `/analytics` | 200 | ✅ |
| `/design-system` | 200 | ✅ |
| `GET /api/companies/rillet` | 200 | n/a |
| `GET /api/companies/zzznonexistent` | 404 (clean error JSON) | n/a |
| `GET /api/qa-reports` | **500** (empty body) | n/a |
| `GET /api/briefing/regenerate` | 405 | n/a |
| `GET /api/chat` | 400 (clean error JSON) | n/a |
| `POST /api/chat` (valid) | 200 (response: "I don't have a briefing or pursuit list loaded" — chat's data layer can't see the same data the dashboard renders) | n/a |

## Out-of-scope observations

The chat reply suggests the `/api/chat` handler doesn't load the same briefing data that `/today` renders. Not strictly a bug on this branch's diff, but worth noting since the recent commit `41ffea8 fix(briefing+chat): graceful Anthropic-credit-exhausted handling` touched both surfaces.

---

*Generated by `/qa-only` on 2026-05-17. Run `/qa` instead if you want me to fix these.*
