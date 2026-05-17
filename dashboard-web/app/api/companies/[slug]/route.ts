// GET /api/companies/[slug] — aggregate view for one company, plus a thesis.
//
// Thin wrapper around lib/company-detail. Defaults to `readOnly` — the GET
// path returns whatever's cached on disk (or a null thesis) and never spends
// a Claude call on its own. To trigger generation, pass `?generate=1` (used
// by the page's "Regenerate" button). Force a regenerate-from-scratch with
// `?generate=1&force=1`.

import { NextRequest } from "next/server";
import {
  getCompanyDetailWithThesis,
  defaultClaudeCall,
} from "@/lib/company-detail";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  // Defensive: callers may pass URL-encoded or mixed-case slugs. Re-derive
  // the dashboard's standard form (lowercase alphanumeric) so a stray "%20"
  // or trailing dash still resolves.
  const normalized = decodeURIComponent(slug).toLowerCase().replace(/[^a-z0-9]/g, "");

  const generate = req.nextUrl.searchParams.get("generate") === "1";
  const force = req.nextUrl.searchParams.get("force") === "1";

  const detail = await getCompanyDetailWithThesis(normalized, {
    readOnly: !generate,
    force,
    claudeCall: generate ? defaultClaudeCall : undefined,
  });
  if (!detail) {
    return Response.json(
      { error: "Company not found", slug: normalized },
      { status: 404 }
    );
  }
  return Response.json(detail);
}
