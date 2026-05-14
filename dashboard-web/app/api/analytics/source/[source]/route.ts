import { NextRequest } from "next/server";
import { getSourceDetail } from "@/lib/source-detail";
import type { Range } from "@/lib/analytics";

export const dynamic = "force-dynamic";

function parseRange(s: string | null): Range {
  if (s === "7d" || s === "30d" || s === "60d" || s === "90d") return s;
  return "30d";
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ source: string }> },
) {
  const { source } = await params;
  const host = decodeURIComponent(source).toLowerCase();
  const range = parseRange(req.nextUrl.searchParams.get("range"));
  const detail = getSourceDetail(host, range);
  return Response.json(detail);
}
