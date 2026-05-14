import { NextRequest } from "next/server";
import { loadRollups, collectAnomalies, Range } from "@/lib/analytics";

export const dynamic = "force-dynamic";

function parseRange(s: string | null): Range {
  if (s === "7d" || s === "30d" || s === "60d" || s === "90d") return s;
  return "7d";
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const range = parseRange(url.searchParams.get("range"));
  const rollups = loadRollups(range);
  const anomalies = collectAnomalies(rollups);

  return Response.json({
    range,
    count: anomalies.length,
    high_severity_count: anomalies.filter((a) => a.severity === "high").length,
    anomalies,
  });
}
