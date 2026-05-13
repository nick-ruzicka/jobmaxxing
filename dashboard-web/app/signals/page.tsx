import { getSignals, getRoles, getStats, getConfig } from "@/lib/data";
import { SignalsPage } from "./signals-client";

export const dynamic = "force-dynamic";

export default function Page() {
  const signals = getSignals();
  const roles = getRoles();
  const stats = getStats();
  const config = getConfig();

  // Cross-reference: find signals whose companies also have posted roles
  const roleCompanies = new Set(
    roles.map((r) => r.company.toLowerCase().replace(/[^a-z0-9]/g, ""))
  );

  const warmLeads = signals.filter(
    (s) => s.result === "high" || roleCompanies.has(s.slug.replace(/[^a-z0-9]/g, ""))
  );
  const monitoring = signals.filter(
    (s) => s.result === "monitor" && !roleCompanies.has(s.slug.replace(/[^a-z0-9]/g, ""))
  );
  const posting = signals.filter((s) => s.result === "posting");

  const highConviction = signals.filter((s) => s.result === "high").length;
  const companyCount = config.ashby.length + config.greenhouse.length;

  return (
    <SignalsPage
      warmLeads={warmLeads}
      monitoring={monitoring}
      posting={posting}
      totalSignals={signals.length}
      highConviction={highConviction}
      companyCount={companyCount}
      signalCount={signals.length}
      hasWarmLeads={stats.hasWarmLeads}
      activePursuing={stats.activelyPursuing}
    />
  );
}
