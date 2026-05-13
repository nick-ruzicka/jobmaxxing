# Design System — JobOps

> Canonical design system for the `dashboard-web/` Next.js app. **Read this before any visual or UI change.** All tokens, scales, components, and motion live here. Do not deviate without explicit approval. The live spec renders at `/design-system`.
>
> Created 2026-05-12 by `/design-consultation`. Status: **proposed — awaiting approval.**

---

## Product context

- **What this is:** JobOps — a personal AI job-search command center (pipeline tracking, offer evaluation, signal scanning, interview prep). Single-operator tool, not multi-tenant.
- **Who it's for:** one person running a focused, high-quality job search. Power user. Lives in this dashboard for minutes at a time, many times a day.
- **Project type:** data-dense dark-mode web app (dashboard). Not a marketing site, not editorial.
- **The one thing it should communicate:** *quiet competence.* The kind of dashboard a Linear PM would build for themselves — nothing shouts, everything is deliberate. If a hiring manager glances at it, they should think "this person has product taste," not "this person used a CSS framework."

## Aesthetic direction

- **Direction:** refined minimalism — Linear / Asana / Stripe Dashboard / Vercel.
- **Decoration level:** minimal. Typography, spacing, and 1px borders do the work. No gradients, no shadows beyond a single subtle elevation, no decorative anything.
- **Mood:** calm, dense-but-legible, instrument-panel. Color is rare and always means something.
- **What that rules out (hard constraints):**
  - One typeface: **Inter** (already in use). A monospace (`--font-mono`) is allowed *only* for terminal output and inline `<code>` — never for UI chrome. *(Open decision: if you want strictly-Inter-everywhere, say so and I'll set the terminal/code to Inter too — but proportional fonts make terminal output hard to scan.)*
  - **No emoji** anywhere in the UI. Use Lucide icons (1.5px stroke, 14–16px, monochrome by default).
  - **No gradients.** The only exception is a functional skeleton shimmer (and even that we'll do as an opacity pulse, not a moving gradient).
  - **No drop shadows beyond 1px-border / minimal elevation.** Exactly one shadow token (`--shadow-1`), used only for floating layers (dropdowns, popovers). Cards and table containers get a 1px border, no shadow.
  - **No colored left-borders on cards** (`border-left: Npx solid <accent>`). This is the most recognizable AI-generated pattern. Status goes in a badge or a dot, not a border.
  - **No tinted icon-in-circle chips** as decoration (stat cards, sidebar logo, table signal markers). Icons are monochrome (`--text-tertiary`); tints are reserved for badges that carry semantic meaning.
  - **No centered-everything**, no decorative blobs/dividers, no 3-column icon-feature grids.
- **Reference apps:** linear.app (the canonical one), Vercel dashboard, Stripe dashboard.

---

## Tokens & conventions

### Convention: Tailwind v4 `@theme`

All tokens are defined **once** in `globals.css` under `@theme`, which exposes them as Tailwind utilities. Components write `className="bg-surface-2 border border-border-subtle text-text-secondary"` — **not** inline `style={{ background: "var(--surface-2)" }}` and **not** `text-[var(--text-secondary)]` and **never** hardcoded hex (`#2e2e3e`) or raw Tailwind palette colors (`text-indigo-400`, `bg-violet-500/15`). One convention, site-wide. (Today there are three; the interviews page is the worst offender — see DECISIONS LOG.)

```css
/* globals.css */
@theme {
  /* surfaces (darkest → lightest) */
  --color-surface-0: #0a0a10;   /* page / deepest bg */
  --color-surface-1: #0e0e16;   /* sidebar bg, table header rows */
  --color-surface-2: #14141e;   /* cards, table container, inputs */
  --color-surface-3: #1a1a26;   /* hover, elevated */
  --color-surface-4: #20202e;   /* active / pressed */
  --color-surface-row: #161620; /* zebra-stripe (even rows) */

  /* borders */
  --color-border-subtle: #1e1e2a;
  --color-border-default: #26263a;
  --color-border-strong: #32324a;

  /* text — muted tiers raised to meet WCAG AA 4.5:1 on surface-0/1 */
  --color-text-primary: #edeef0;   /* ~14:1  — headings, key values */
  --color-text-secondary: #a8adb7; /* ~8:1   — body, default reading */
  --color-text-tertiary: #8a909c;  /* ~5:1   — labels, secondary cells, section labels (was #6b7280 ≈4.2:1) */
  --color-text-muted: #787e8b;     /* ~4.5:1 — incidental hints, keyboard cues, empty-state copy (was #454b55 ≈2.5:1 — FAIL) */

  /* accent — INDIGO IS FOR INTERACTIVE/SELECTED STATE ONLY */
  --color-accent: #818cf8;         /* selected nav, focus ring, links */
  --color-accent-strong: #6366f1;  /* primary button fill */
  --color-accent-dim: rgba(129, 140, 248, 0.12);
  --color-accent-border: rgba(129, 140, 248, 0.25);

  /* semantic — each owns its meaning; score & status use these, not --accent */
  --color-emerald: #34d399;  --color-emerald-dim: rgba(52,211,153,0.12);  --color-emerald-border: rgba(52,211,153,0.25);
  --color-amber:   #fbbf24;  --color-amber-dim:   rgba(251,191,36,0.12);  --color-amber-border:   rgba(251,191,36,0.25);
  --color-blue:    #60a5fa;  --color-blue-dim:    rgba(96,165,250,0.12);  --color-blue-border:    rgba(96,165,250,0.25);
  --color-violet:  #a78bfa;  --color-violet-dim:  rgba(167,139,250,0.12);  --color-violet-border:  rgba(167,139,250,0.25);
  --color-red:     #f87171;  --color-red-dim:     rgba(248,113,113,0.10);  --color-red-border:     rgba(248,113,113,0.22);

  /* radii */
  --radius-sm: 6px;   /* badges, pills, buttons */
  --radius-md: 8px;   /* inputs, small surfaces */
  --radius-lg: 10px;  /* cards, table containers, dropdowns */
  --radius-full: 9999px;

  /* one shadow only — floating layers (dropdowns/popovers) */
  --shadow-1: 0 1px 2px rgba(0,0,0,0.4), 0 4px 12px rgba(0,0,0,0.3);

  /* motion */
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --duration-fast: 120ms;
  --duration: 150ms;
  --duration-slow: 220ms;

  /* type */
  --font-sans: var(--font-inter), system-ui, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace; /* terminal + <code> ONLY */
}

html { color-scheme: dark; }            /* native scrollbars, form controls, autofill */
body { background: var(--color-surface-0); color: var(--color-text-secondary); font-size: 14px; -webkit-font-smoothing: antialiased; }

/* form controls don't inherit font-family by default — this fixes the ui-sans-serif leak on <button>/<input>/<select> */
button, input, textarea, select { font: inherit; }

/* one focus language, app-wide. delete every per-input `focus:outline-none` and every inline `outline:1px solid` */
*:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--color-surface-0), 0 0 0 4px var(--color-accent); border-radius: var(--radius-sm); }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; transition-duration: 0.01ms !important; scroll-behavior: auto !important; }
}
```

### Color usage rules

| Color | Means | Used for |
|---|---|---|
| `accent` (indigo) | "interactive / selected" | selected nav item, focus ring, links, primary button, segmented-control active state — **and nothing else** |
| `emerald` | "good / done / present" | score 8–10, `Offer` status, "build component / AI signal" flags, "Posting detected" |
| `amber` | "warning / attention / mid" | score 4–5, "needs prep doc", high-conviction signal, stale rows |
| `blue` | "informational / in-progress" | score 6–7, `Interview` status, `Hybrid` location, `Watched` company tier |
| `violet` | "secondary action / applied" | `Applied` status, "enhanced with AI" markers |
| `red` | "negative / destructive" | `Rejected` status, red flags, danger buttons |
| neutral (`surface-3`/`text-tertiary`) | "no signal" | score < 4, `Discovered`/`Skipped` status, `Scan` tier, unknown location |

Color is **never decoration.** If a colored thing doesn't encode state, it shouldn't be colored. (Kills: the amber left-border on every Signals card, the per-section colored icons on Interviews, the tinted icon-chips in StatStrip.)

---

## Typography

Inter, one family. Tabular numerics (`font-variant-numeric: tabular-nums`) on **every** numeric column, badge count, score, and stat value — no exceptions (catch the Interviews header counts).

| Token | Size / weight / tracking / line-height | Use |
|---|---|---|
| `display` | 22px / 700 / **−0.02em** / 1.2 / tabular | stat-card values, the rare hero number |
| `title` (`h1`) | 18px / 600 / **−0.02em** / 1.3 | page titles ("Pipeline", "Signals") |
| `heading` (`h2`) | 14px / 600 / **−0.01em** / 1.4 | card/section titles, prep-doc title |
| `subheading` (`h3`) | 13px / 600 / −0.01em / 1.4 | sub-sections (or just use `body-strong`) |
| `body` | 14px / 400 / normal / 1.5 | default reading text |
| `body-strong` | 14px / 500 / normal / 1.5 | emphasis, company names in tables |
| `small` | 13px / 400 / normal / 1.45 | dense table cells, secondary text |
| `caption` | 12px / 400 / normal / 1.4 | metadata, helper text, sub-labels |
| `micro` | 11px / 500 / normal / 1.3 / tabular | badge counts, "Found" column, tiny labels |
| `section-label` | 11px / 600 / **0.06em UPPERCASE** / 1 / color `text-tertiary` | Linear-style group headers ("WORKSPACE", "TOOLS"), Signals section headers — `<SectionLabel>` |
| `mono` | 12px / 400 / `--font-mono` | terminal output, inline `<code>` only |

**Rules:** negative tracking only on `display`/`title`/`heading`/`subheading` (it hurts legibility on small text). No letterspacing on lowercase body text. Body ≥ 14px (the 14px floor is deliberate — matches Linear/Stripe density; the muted *colors* are what we fixed, not the size). Headings never float between paragraphs (always closer to the section they introduce).

---

## Spacing

**Base unit: 4px.** Scale (aligned with Tailwind's defaults so utilities map 1:1):

| Name | px | Tailwind | Use |
|---|---|---|---|
| `1` | 4 | `gap-1`, `p-1` | icon-to-label gaps, tightest |
| `2` | 8 | `gap-2`, `p-2` | inside badges/buttons, tight stacks |
| `2.5` | 10 | `py-2.5` | **dense-table cell vertical padding only** — named exception, ~40–42px rows with 14px text. Use it consistently (header AND body cells), not `py-2` for headers and `py-2.5` for body. |
| `3` | 12 | `gap-3`, `p-3` | between related controls, table cell horizontal padding |
| `4` | 16 | `gap-4`, `p-4` | card padding, between fields |
| `6` | 24 | `space-y-6`, `p-6` | between page sections, page content padding (`<main>` is `p-6`) — **every page wrapper is `space-y-6`** (kill the `space-y-8` on Signals) |
| `8` | 32 | `gap-8` | between major page regions |
| `12` | 48 | `py-12` | empty-state vertical padding |
| `16` | 64 | — | rare, top-level breathing room |

Snap everything to this. Audit out: bare `gap-2.5` outside tables, `pt-5` magic offsets (`ExpandedRow`), `py-0` weirdness. Border-radius hierarchy: badges/pills/buttons `rounded-md` (6px), inputs `rounded-md`(8px), cards/tables/dropdowns `rounded-lg` (10px), avatars/dots `rounded-full`. **Never use bare `rounded`** (4px — not in the scale).

---

## Layout

- **Approach:** grid-disciplined app shell. Fixed 240px sidebar (`bg-surface-1`, 1px right border, no shadow) + fluid content (`<main className="flex-1 min-w-0 overflow-y-auto p-6">` — the `min-w-0` matters). Sidebar has a logo block, a `<SectionLabel>`-headed nav group, scan-action buttons *moved into the page header* (not the sidebar bottom), and a thin footer.
- **Page structure:** `<PageHeader>` (title + count/subtitle + actions-right) → content with `space-y-6`. The header is real estate that earns its keep — title, a count or one-line context, and the page's primary action(s) on the right.
- **Max content width:** none (fluid) — but tables live inside `overflow-x-auto` containers so they never push the page wide. Confirmed: no horizontal overflow at 1024/1280/1440/1680.
- **Tables:** ~40–42px rows. Zebra via CSS `[&_tr:nth-child(even)]:bg-surface-row` (or `even:bg-surface-row`), hover via CSS `hover:bg-surface-3`. **Zero JavaScript hover handlers.** Dimmed rows (rejected/skipped/stale): `opacity-50` only — no strikethrough, no left-border; the status badge already says why.

---

## Component primitives

Extract these. Today they're re-implemented 5–15× each with drift (two "primary" button shades, three table shells, four badge implementations).

### `<Button variant size>`
- variants: `primary` (`bg-accent-strong` / white text / hover ~+8% lightness), `secondary` (`bg-surface-2` / `border border-border-default` / `text-text-secondary` / hover `bg-surface-3`), `ghost` (transparent / `text-text-tertiary` / hover `bg-surface-3`), `danger` (`bg-red-dim` / `text-red` / `border border-red-border` / hover `bg-red-dim` darker).
- sizes: `sm` = `px-3 py-1.5 text-[13px]`, `md` = `px-4 py-2 text-[13px]`. Both: `rounded-md font-medium inline-flex items-center gap-1.5 transition-[background-color,border-color,color] duration-150 ease-out`, `:active` translateY(0.5px), `disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none`, `:focus-visible` (global ring). Optional `as={Link}` for navigation buttons.

### `<Badge color variant>`
- `color`: `neutral | accent | emerald | amber | blue | violet | red`.
- `variant`: `soft` (default) = `bg-{color}-dim text-{color} border border-{color}-border rounded-md px-2 py-0.5 text-[11px] font-medium tabular-nums`; `dot` = a 6px `bg-{color} rounded-full` + label in `text-text-secondary` (lighter weight than a chip — for status that shouldn't shout).
- `ScorePill`, `LocationTag`, the company `tier` badge, the filter `Chip` count, the sidebar nav count → all become thin wrappers over `<Badge>`.

### `<ScoreDot tier>` / score display
- Score 8–10 → `<Badge color="emerald">{n}</Badge>`, 6–7 → `<Badge color="blue">{n}</Badge>`, 4–5 → `<Badge color="amber">{n}</Badge>`, <4 → `<Badge color="neutral">{n}</Badge>`. No hover glow.
- **Provenance dots** (next to the score, from the data-fix plan — AI / title-only / manual / override): tiny 5px `rounded-full` dots — `emerald` (AI-enriched), `text-muted` (title-only heuristic), `blue` (manual), `violet` (override). With a tooltip. Replaces the unexplained Hammer/Cpu icon-in-circle markers; "build component" and "AI signal" become `<Badge dot>` instead of tinted circles.

### `<DataTable>` (or `<Th>` / `<Tr>` if a full component is too much)
- Container: `border border-border-subtle rounded-lg overflow-x-auto bg-surface-2` — **no shadow**.
- `<thead>`: `bg-surface-1 border-b border-border-subtle sticky top-0`. `<th>`: `px-3 py-2.5 text-left text-[11px] font-medium uppercase tracking-[0.04em] text-text-tertiary` + sort caret affordance on sortable columns.
- `<tr>`: `border-b border-border-subtle even:bg-surface-row hover:bg-surface-3 transition-colors duration-150` — CSS only. `[data-state="dimmed"]` → `opacity-50`. `[data-focused]` → the global focus ring (keyboard nav uses the same ring as everything else, not a bespoke `outline`).
- One shell, one stripe behavior, one hover behavior — used by Pipeline, Companies, Signals/Monitor.

### `<PageHeader title subtitle? count? actions?>`
- `flex items-center justify-between mb-6`. Left: `<h1 className="text-[18px] font-semibold tracking-[-0.02em] text-text-primary">` + optional `<span className="text-[12px] text-text-muted tabular-nums">{count} roles</span>` or a one-line subtitle. Right: `actions` slot — `<Button>`s. This is where "Run Job Scan" / "Signal Scan" live on the Pipeline page.

### `<SectionLabel>`
- `text-[11px] font-semibold uppercase tracking-[0.06em] text-text-tertiary` (+ optional leading 12px Lucide icon). Sidebar group headers, Signals section headers. The Linear "WORKSPACE" micro-label.

### `<EmptyState icon title description? action?>`
- Centered, `flex flex-col items-center py-12 text-center`. Icon: 28px Lucide, `text-text-muted`, `mb-3`. Title: `text-[13px] text-text-secondary`. Description: `text-[12px] text-text-muted mt-1`. Optional `<Button variant="secondary" size="sm">` below. Used for: no-search-match (Companies — currently missing), empty Monitor (Signals — currently missing), no-roles-match-filters (Pipeline — has one, conform it), no-prep-docs (Interviews — has one, conform it).

### `<Skeleton w h rounded?>` + states
- `bg-surface-2 rounded-md animate-pulse` blocks. `app/loading.tsx` = `<PageHeader>` skeleton + a row of stat-card skeletons + ~8 table-row skeletons. `app/error.tsx` (client, `{error, reset}`) = `<EmptyState icon={AlertTriangle} title="Something went wrong" description={error.message} action={<Button onClick={reset}>Try again</Button>} />`. `app/not-found.tsx` = `<EmptyState icon={FileQuestion} title="Page not found" action={<Button as={Link} href="/">Back to Pipeline</Button>} />`.

---

## Motion

- **Default:** `transition: background-color var(--duration) var(--ease-out), border-color var(--duration) var(--ease-out), color var(--duration) var(--ease-out), box-shadow var(--duration) var(--ease-out)`. **Never `transition: all`** (currently on ~750 elements — animates layout props, costs paint). List the properties.
- **Durations:** micro `120ms` (color/bg hover), default `150ms`, slow `220ms` (panel/drawer slide). Nothing slower except a full-screen transition (there are none).
- **Easing:** `--ease-out` for entrances/hover; `ease-in` for exits. No bounce, no spring.
- **Animate only `transform` and `opacity`** for movement (the expand-row uses `translateY` + `opacity` — keep). The amber "warm lead" pulse: keep but it must be inside the `prefers-reduced-motion` guard.
- **`prefers-reduced-motion: reduce`** is honored globally (see the `@media` block above) — currently nothing respects it.

---

## Interaction states (every interactive element)

- **hover** — `bg-surface-3` (rows, list items, ghost buttons), or +lightness (filled buttons). CSS `:hover` — **no `onMouseEnter`/`onMouseLeave` JS** (delete it from `PipelineTable`, `companies-client`, `signals-client`, `StatusDropdown`, `ScorePill`).
- **focus-visible** — the one global ring (`box-shadow: 0 0 0 2px surface-0, 0 0 0 4px accent`). Remove every per-input `focus:outline-none` and every inline `outline: 1px solid var(--accent)` (keyboard-nav row focus uses the global ring too).
- **active** — slight `transform: translateY(0.5px)` (buttons) or `bg-surface-4`.
- **disabled** — `opacity-40 cursor-not-allowed pointer-events-none`.
- **selected** — `bg-accent-dim text-accent` + (for nav) a 2px left accent bar — this is the *only* place a left-accent bar is allowed (it's a wayfinding indicator, not card decoration).
- Touch targets ≥ 32px tall for dense controls, ≥ 40px for primary actions (the score segmented control is 25px today; "Clear filters" is a 17px-tall text link — both get real hit areas).

---

## DECISIONS LOG

| Date | Decision | Rationale |
|---|---|---|
| 2026-05-12 | Created `DESIGN.md` via `/design-consultation` | Audit found a B− app: good token foundation, but 3 styling conventions, no loading/error states, JS-driven hover, `transition: all` everywhere, sub-AA muted text, AI-slop card left-borders + tinted icon-chips, headings with no scale between 20px and 11px and zero `letter-spacing`. This doc is the target. |
| 2026-05-12 | Adopt Tailwind v4 `@theme` as the single styling convention | Eliminates the inline-`style` vs `text-[var()]` vs hardcoded-hex split. The `interviews-client.tsx` page (`text-indigo-400`, `bg-violet-500/15`, `#2e2e3e`) is the migration's biggest job. |
| 2026-05-12 | Raise `--text-tertiary` (#6b7280→#8a909c) and `--text-muted` (#454b55→#787e8b) | Old values were ≈4.2:1 and ≈2.5:1 against `surface-0`; WCAG AA needs 4.5:1 for body text. |
| 2026-05-12 | `--accent` (indigo) restricted to interactive/selected state; score & status use semantic colors | Indigo currently carries ~8 unrelated jobs. Narrowing it makes "indigo = the app is doing something here" legible. |
| 2026-05-12 | One shadow (`--shadow-1`), borders elsewhere; kill `--shadow-md/lg/xl/glow` | Refined-minimalism: 1px elevation. `--shadow-xl` (32px blur) on a dropdown and a hover-glow on the score pill read as maximalist. |
| 2026-05-12 | Monospace (`--font-mono`) allowed for terminal output + `<code>` only | "Single typeface: Inter" holds for all UI chrome; terminal/code are unreadable in a proportional font. *Reversible if you want strictly-Inter-everywhere.* |

---

## Implementation order (after this doc is approved — one commit per chunk)

1. `feat(design): adopt @theme tokens + reset (color-scheme, focus, reduced-motion, form-font-inherit)` — `globals.css`. Keep old `:root` vars temporarily aliased so nothing breaks.
2. `feat(design): primitives — Button, Badge, SectionLabel, EmptyState, PageHeader, Skeleton`
3. `feat(design): DataTable / Th / Tr — CSS-only hover & zebra; delete JS hover handlers`
4. `refactor(pipeline): PageHeader + new filter bar + tightened table + ScoreDot/provenance` — Pipeline page onto the system.
5. `refactor(signals): rebuild high-conviction & posting cards (no left-borders, compact grid); wire/remove the "Reach out" button; SectionLabel headers`
6. `refactor(companies): hide empty Funding/Signal columns; EmptyState; drop per-row Building icon; new DataTable`
7. `refactor(interviews): migrate off Tailwind-palette/hardcoded colors onto tokens; normalize headings; questions as a numbered list; separate Story Bank`
8. `feat(design): app/loading.tsx, app/error.tsx, app/not-found.tsx`
9. `chore(design): retire old --surface-* aliases; final pass; update CLAUDE.md with the "read DESIGN.md" note`
