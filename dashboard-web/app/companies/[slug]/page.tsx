// /companies/[slug] — per-company drilldown view.
//
// Server component: reads the aggregate + cached thesis (readOnly — never
// spends a Claude call on cold load), then hands the rendered payload off
// to the client component for interactivity (regenerate thesis, dismiss).

import { notFound } from "next/navigation";
import { getCompanyDetailWithThesis, type CompanyDetailWithThesis } from "@/lib/company-detail";
import { getSignals, getStats, getConfig } from "@/lib/data";

import { CompanyDetailClient } from "./company-detail-client";

export const dynamic = "force-dynamic";

export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const normalized = decodeURIComponent(slug).toLowerCase().replace(/[^a-z0-9]/g, "");

  // readOnly: never call Claude during a page load. The Regenerate button on
  // the page is the only path that triggers generation (?generate=1&force=1).
  const detail = (await getCompanyDetailWithThesis(normalized, {
    readOnly: true,
  })) as CompanyDetailWithThesis | null;

  if (!detail) {
    notFound();
  }

  // Shell sidebar context — same payload the other routes pass through.
  const signals = getSignals();
  const stats = getStats();
  const config = getConfig();
  const highConviction = signals.filter((s) => s.result === "high").length;
  const companyCount = config.ashby.length + config.greenhouse.length;

  return (
    <CompanyDetailClient
      detail={detail}
      activePursuing={stats.activelyPursuing}
      highConviction={highConviction}
      companyCount={companyCount}
      signalCount={signals.length}
      hasWarmLeads={stats.hasWarmLeads}
    />
  );
}
