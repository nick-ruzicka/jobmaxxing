// GET /api/companies/[slug] — aggregate view for one company.
//
// Thin wrapper around lib/company-detail's getCompanyDetail(). The aggregate
// itself is computed deterministically from on-disk data files, so this route
// is read-only and idempotent.

import { NextRequest } from "next/server";
import { getCompanyDetail } from "@/lib/company-detail";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  // Defensive: callers may pass URL-encoded or mixed-case slugs. Re-derive
  // the dashboard's standard form (lowercase alphanumeric) so a stray "%20"
  // or trailing dash still resolves.
  const normalized = decodeURIComponent(slug).toLowerCase().replace(/[^a-z0-9]/g, "");

  const detail = getCompanyDetail(normalized);
  if (!detail) {
    return Response.json(
      { error: "Company not found", slug: normalized },
      { status: 404 }
    );
  }
  return Response.json(detail);
}
