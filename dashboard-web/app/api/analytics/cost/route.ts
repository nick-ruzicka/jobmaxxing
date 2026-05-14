import { NextRequest } from "next/server";
import {
  loadRollups,
  aggregateTotals,
  aggregateByDate,
  Range,
} from "@/lib/analytics";

export const dynamic = "force-dynamic";

function parseRange(s: string | null): Range {
  if (s === "7d" || s === "30d" || s === "60d" || s === "90d") return s;
  return "30d";
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const range = parseRange(url.searchParams.get("range"));
  const rollups = loadRollups(range);
  const totals = aggregateTotals(rollups, range);
  const by_date = aggregateByDate(rollups);

  return Response.json({
    range,
    summary: {
      claude_cost_usd: totals.claude_cost_usd,
      exa_cost_usd: totals.exa_cost_usd,
      total_cost_usd: totals.total_cost_usd,
      claude_tokens_input: totals.claude_tokens_input,
      claude_tokens_output: totals.claude_tokens_output,
      cost_per_high_fit_role: totals.cost_per_high_fit_role,
      cost_per_application: totals.cost_per_application,
      roles_fit_6plus: totals.roles_fit_6plus,
      applications_attributed: totals.applications_attributed,
    },
    daily: by_date.map((d) => ({
      date: d.date,
      claude_cost_usd: d.claude_cost_usd,
      exa_cost_usd: d.exa_cost_usd,
      total_cost_usd: d.total_cost_usd,
      cost_per_high_fit: d.cost_per_high_fit,
      data_completeness: d.data_completeness,
    })),
  });
}
