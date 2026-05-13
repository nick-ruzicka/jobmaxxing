import { MapPin } from "lucide-react";
import { CLUSTER_META } from "@/lib/location-clusters";
import { Badge, type BadgeColor } from "@/components/ui";

// Map cluster tone (from hybrid's location infra) to Badge color (from design system).
const TONE_TO_BADGE: Record<string, BadgeColor> = {
  "in-scope": "emerald",
  "out-of-scope": "neutral",
  unknown: "neutral",
};

function clusterColor(cluster?: string): BadgeColor {
  const tone = (cluster && (CLUSTER_META as Record<string, { tone: string }>)[cluster]?.tone) || "unknown";
  return TONE_TO_BADGE[tone] || "neutral";
}

export function LocationTag({ location, cluster }: { location: string; cluster?: string }) {
  return (
    <Badge color={clusterColor(cluster)} icon={<MapPin size={10} className="shrink-0" />}>
      {location}
    </Badge>
  );
}
