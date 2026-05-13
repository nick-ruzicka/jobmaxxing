import { MapPin } from "lucide-react";

const LOC_STYLES: Record<string, { bg: string; text: string; border: string }> = {
  nyc:     { bg: "var(--emerald-dim)", text: "var(--emerald)", border: "rgba(52,211,153,0.15)" },
  hybrid:  { bg: "var(--blue-dim)", text: "var(--blue)", border: "rgba(96,165,250,0.15)" },
  remote:  { bg: "var(--accent-dim)", text: "var(--accent)", border: "rgba(129,140,248,0.15)" },
  unknown: { bg: "var(--surface-3)", text: "var(--text-muted)", border: "var(--border-subtle)" },
};

function getLocStyle(location: string) {
  const l = location.toLowerCase();
  if (l.includes("nyc")) return LOC_STYLES.nyc;
  if (l.includes("hybrid")) return LOC_STYLES.hybrid;
  if (l.includes("remote")) return LOC_STYLES.remote;
  return LOC_STYLES.unknown;
}

export function LocationTag({ location }: { location: string }) {
  const s = getLocStyle(location);
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
