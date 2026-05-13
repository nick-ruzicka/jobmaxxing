import type { ScoreProvenance } from "@/lib/types";

const SCORE_STYLES: Record<string, { bg: string; text: string; border: string; glow: string }> = {
  high:   { bg: "var(--emerald-dim)", text: "var(--emerald)", border: "rgba(52,211,153,0.2)", glow: "0 0 8px rgba(52,211,153,0.15)" },
  good:   { bg: "var(--accent-dim)", text: "var(--accent)", border: "rgba(129,140,248,0.2)", glow: "0 0 8px rgba(129,140,248,0.15)" },
  mid:    { bg: "var(--amber-dim)", text: "var(--amber)", border: "rgba(251,191,36,0.2)", glow: "0 0 8px rgba(251,191,36,0.12)" },
  low:    { bg: "var(--surface-3)", text: "var(--text-muted)", border: "var(--border-subtle)", glow: "none" },
};

function getTier(score: number) {
  if (score >= 8) return "high";
  if (score >= 6) return "good";
  if (score >= 4) return "mid";
  return "low";
}

// Corner-dot color + tooltip label per score provenance. ("override" joins this in Fix #4.)
const PROVENANCE: Record<ScoreProvenance, { dot: string; label: string }> = {
  enriched:    { dot: "#34d399",          label: "Score from Claude JD analysis" },          // emerald-500
  application: { dot: "var(--accent)",    label: "Score from the application tracker" },      // indigo
  heuristic:   { dot: "var(--text-muted)", label: "Score from title/location heuristic — JD not analyzed" },
};

export function ScorePill({
  score,
  provenance,
  scoreCapped,
}: {
  score: number;
  provenance?: ScoreProvenance;
  scoreCapped?: boolean;
}) {
  const s = SCORE_STYLES[getTier(score)];
  const p = provenance ? PROVENANCE[provenance] : null;
  const title = p
    ? p.label + (scoreCapped ? " — heuristic score capped at 7 (Claude has not analyzed this JD)" : "")
    : undefined;
  return (
    <span
      className="relative inline-flex items-center justify-center px-2 py-0.5 text-xs font-semibold rounded-md tabular-nums transition-shadow"
      style={{
        background: s.bg,
        color: s.text,
        border: `1px solid ${s.border}`,
      }}
      title={title}
      onMouseEnter={(e) => { e.currentTarget.style.boxShadow = s.glow; }}
      onMouseLeave={(e) => { e.currentTarget.style.boxShadow = "none"; }}
    >
      {score}
      {p && (
        <span
          aria-hidden
          className="absolute h-1 w-1 rounded-full"
          style={{
            top: "2px",
            right: "2px",
            background: scoreCapped ? "transparent" : p.dot,
            boxShadow: scoreCapped ? `inset 0 0 0 1px ${p.dot}` : "none", // hollow ring when capped
          }}
        />
      )}
    </span>
  );
}
