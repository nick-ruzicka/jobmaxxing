import { redirect } from "next/navigation";

/**
 * Root entry — the homepage is now /today (the daily-agent briefing surface).
 * The pipeline table lives at /pipeline. This redirect keeps existing bookmarks
 * and the sidebar logo working without forcing a hard rename of the route tree.
 *
 * `dynamic = "force-dynamic"` is necessary: without it, Next.js pre-renders /
 * statically and the redirect happens at build time (the served page becomes
 * /today's HTML at URL `/` — browsers' URL bars don't update). force-dynamic
 * pushes the redirect to request time so Next returns an actual 307.
 */
export const dynamic = "force-dynamic";

export default function Page() {
  redirect("/today");
}
