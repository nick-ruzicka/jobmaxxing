<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Design system

Before any visual or UI change in this app, read **`../DESIGN.md`** — it's the canonical
design system (tokens, type/spacing scales, component primitives in `components/ui/`,
motion). Style with the `@theme` token classes (`bg-surface-2`, `text-text-secondary`,
`border-border-subtle`, `shadow-1`, …), not inline `style={{ var(--…) }}` and not raw
Tailwind palette colors (`text-indigo-400`, `bg-violet-500/15`). The live spec renders at
`/design-system`.
