import { redirect } from "next/navigation";

/**
 * Root entry — the homepage is now /pipeline (the table surface). Previously
 * redirected to /today (briefing-first), but the AI feature audit Step 2
 * collapsed the briefing into /pipeline as a top panel, so the pipeline view
 * is the primary surface and the briefing rides along contextually. The
 * /today route still exists but redirects here too, so existing bookmarks
 * keep working.
 *
 * `dynamic = "force-dynamic"` is necessary: without it, Next.js pre-renders /
 * statically and the redirect happens at build time. force-dynamic pushes the
 * redirect to request time so Next returns an actual 307.
 */
export const dynamic = "force-dynamic";

export default function Page() {
  redirect("/pipeline");
}
