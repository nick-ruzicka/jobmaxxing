import { getCompanies, getStats, getSignals, getConfig } from "@/lib/data";
import { CompaniesPage } from "./companies-client";

export const dynamic = "force-dynamic";

export default function Page() {
  const companies = getCompanies();
  const stats = getStats();
  const signals = getSignals();
  const config = getConfig();

  const highConviction = signals.filter((s) => s.result === "high").length;
  const companyCount = config.ashby.length + config.greenhouse.length;

  return (
    <CompaniesPage
      companies={companies}
      highConviction={highConviction}
      companyCount={companyCount}
      signalCount={signals.length}
      hasWarmLeads={stats.hasWarmLeads}
      activePursuing={stats.activelyPursuing}
    />
  );
}
