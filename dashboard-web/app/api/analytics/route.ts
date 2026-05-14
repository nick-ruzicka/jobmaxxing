import { NextRequest } from "next/server";
import {
  loadRollups,
  aggregateTotals,
  aggregateBySource,
  aggregateByTier,
  aggregateByDate,
  Range,
  GroupBy,
} from "@/lib/analytics";

export const dynamic = "force-dynamic";

function parseRange(s: string | null): Range {
  if (s === "7d" || s === "30d" || s === "60d" || s === "90d") return s;
  return "30d";
}

function parseGroupBy(s: string | null): GroupBy {
  if (s === "source" || s === "tier" || s === "date") return s;
  return "source";
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const range = parseRange(url.searchParams.get("range"));
  const group_by = parseGroupBy(url.searchParams.get("group_by"));
  const sourceFilter = url.searchParams.get("source");

  const rollups = loadRollups(range);
  const totals = aggregateTotals(rollups, range);

  let by_source = aggregateBySource(rollups);
  if (sourceFilter) {
    const wanted = new Set(sourceFilter.split(",").map((s) => s.trim().toLowerCase()));
    by_source = by_source.filter((s) => wanted.has(s.host));
  }
  const by_tier = aggregateByTier(rollups);
  const by_date = aggregateByDate(rollups);

  return Response.json({
    range,
    group_by,
    totals,
    by_source,
    by_tier,
    by_date,
    rollup_count: rollups.length,
  });
}
