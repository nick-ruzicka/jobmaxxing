import { redirect } from "next/navigation";

/**
 * /today is deprecated as a separate destination per the AI feature audit
 * Step 2 — the briefing now lives as a panel on /pipeline. This route is
 * kept as a redirect so existing bookmarks, deep links from older briefing
 * emails, and sidebar nav from past versions keep working without 404ing.
 *
 * The today-client.tsx file is preserved in the repo for now in case the
 * briefing-first surface comes back as a separate route later (e.g. on
 * mobile where the dense pipeline table doesn't fit). It is not imported
 * by anything after this redirect.
 */
export const dynamic = "force-dynamic";

export default function Page() {
  redirect("/pipeline");
}
