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

export function ScorePill({ score }: { score: number }) {
  const s = SCORE_STYLES[getTier(score)];
  return (
    <span
      className="inline-flex items-center justify-center px-2 py-0.5 text-xs font-semibold rounded-md tabular-nums transition-shadow"
      style={{
        background: s.bg,
        color: s.text,
        border: `1px solid ${s.border}`,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.boxShadow = s.glow; }}
      onMouseLeave={(e) => { e.currentTarget.style.boxShadow = "none"; }}
    >
      {score}
    </span>
  );
}
