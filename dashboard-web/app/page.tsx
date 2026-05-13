import { redirect } from "next/navigation";

/**
 * Root entry — the homepage is now /today (the daily-agent briefing surface).
 * The pipeline table lives at /pipeline. This redirect keeps existing bookmarks
 * and the sidebar logo working without forcing a hard rename of the route tree.
 */
export default function Page() {
  redirect("/today");
}
