import { MapPin } from "lucide-react";
import { CLUSTER_META } from "@/lib/location-clusters";

const TONE_STYLES: Record<string, { bg: string; text: string; border: string }> = {
  "in-scope":     { bg: "var(--emerald-dim)", text: "var(--emerald)", border: "rgba(52,211,153,0.15)" },
  "out-of-scope": { bg: "var(--surface-3)",   text: "var(--text-secondary)", border: "var(--border-subtle)" },
  unknown:        { bg: "var(--surface-3)",   text: "var(--text-muted)", border: "var(--border-subtle)" },
};

export function LocationTag({ location, cluster }: { location: string; cluster?: string }) {
  const tone = (cluster && (CLUSTER_META as Record<string, { tone: string }>)[cluster]?.tone) || "unknown";
  const s = TONE_STYLES[tone] || TONE_STYLES.unknown;
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded-md"
      style={{ background: s.bg, color: s.text, border: `1px solid ${s.border}` }}
    >
      <MapPin size={10} />
      {location}
    </span>
  );
}
