// Re-export of the single-source-of-truth metro module. The actual logic lives in
// scripts/lib/location-clusters.mjs (shared with the scan pipeline); tsconfig has
// allowJs + resolveJsonModule so the .mjs imports cleanly here.
export {
  METRO_CLUSTERS,
  CLUSTER_META,
  CLUSTER_ORDER,
  clusterForCity,
  clusterForLocation,
  flattenLocation,
  parseLocationString,
  looksUS,
} from "../../scripts/lib/location-clusters.mjs";

export type Workplace = "remote" | "hybrid" | "onsite" | "unknown";
export interface StructuredLocation {
  workplace: Workplace;
  city: string | null;
  region: string | null;
}
