import { getRoles, getCompanies } from "../lib/data";
import { writeFileSync } from "fs";

const args = process.argv.slice(2);
const outPath = args[0] || "/tmp/roles-snapshot.json";

const all = getRoles({ includeAggregator: true });
const allTrusted = getRoles();
const companies = getCompanies();

function pick(r: ReturnType<typeof getRoles>[number]) {
  return {
    score: r.score,
    title: r.title,
    company: r.company,
    url: r.url,
    provenance: r.scoreProvenance,
    capped: r.scoreCapped,
    status: r.status,
    closed: r.closed,
    stale: r.stale,
    sourceTier: r.source_tier,
    locationCluster: r.location_cluster,
    enrichmentFit: r.enrichment?.fit_score ?? null,
    enrichmentBase: (r.enrichment as { score_base?: number } | null)?.score_base ?? null,
    enrichmentAdjusted: (r.enrichment as { score_adjusted?: number } | null)?.score_adjusted ?? null,
  };
}

const pipeline = allTrusted
  .filter((r) => r.score >= 4 && !r.closed && r.status !== "Rejected" && r.status !== "Skipped")
  .slice(0, 10);
const today = all.slice(0, 10);
const companiesTop = companies.slice(0, 10).map((c) => ({
  name: c.name,
  slug: c.slug,
  rolesFound: c.rolesFound,
  topRoleScore: c.roles[0]?.score ?? null,
  topRoleTitle: c.roles[0]?.title ?? null,
}));
const anaconda = companies.find((c) => c.slug === "anaconda");
const anacondaRoles = anaconda ? anaconda.roles.slice(0, 10).map(pick) : [];

function findByPattern(pattern: string, list: ReturnType<typeof getRoles>) {
  return list.find((r) =>
    (r.company.toLowerCase().includes(pattern.toLowerCase())
      || r.title.toLowerCase().includes(pattern.toLowerCase()))
  );
}
const named = {
  anaconda: pick(findByPattern("anaconda", all) ?? ({} as never)),
  openai_product: (() => {
    const r = all.find(
      (x) => x.company.toLowerCase().includes("openai") && x.title.toLowerCase().includes("product engineer")
    );
    return r ? pick(r) : null;
  })(),
  introhive: pick(findByPattern("introhive", all) ?? ({} as never)),
  enable: pick(findByPattern("enable", all) ?? ({} as never)),
  databricks: pick(findByPattern("databricks", all) ?? ({} as never)),
  built_in_boston: (() => {
    const r = all.find(
      (x) => x.company.toLowerCase().includes("built in") || x.title.toLowerCase().includes("built in")
    );
    return r ? pick(r) : null;
  })(),
  replit: pick(findByPattern("replit", all) ?? ({} as never)),
  snowflake: pick(findByPattern("snowflake", all) ?? ({} as never)),
  sift_stack: pick(findByPattern("sift", all) ?? ({} as never)),
  eve: pick(findByPattern("eve ", all) ?? ({} as never)),
  xai: pick(findByPattern("xai", all) ?? ({} as never)),
  you_com: pick(findByPattern("you.com", all) ?? ({} as never)),
  vibecodecareers: pick(findByPattern("vibecodecareers", all) ?? ({} as never)),
  fireworks: pick(findByPattern("fireworks", all) ?? ({} as never)),
  solv: pick(findByPattern("solv", all) ?? ({} as never)),
};
const provenanceCounts: Record<string, number> = {};
for (const r of all) {
  provenanceCounts[r.scoreProvenance] = (provenanceCounts[r.scoreProvenance] ?? 0) + 1;
}
const snapshot = {
  capturedAt: new Date().toISOString(),
  total: all.length,
  totalTrusted: allTrusted.length,
  provenanceCounts,
  topPipeline: pipeline.map(pick),
  topToday: today.map(pick),
  topCompanies: companiesTop,
  anacondaRoles,
  named,
};
writeFileSync(outPath, JSON.stringify(snapshot, null, 2));
console.log("Wrote " + outPath);
console.log("Total roles: " + all.length);
console.log("Provenance:", provenanceCounts);
