import { Badge, type BadgeColor } from "@/components/ui";
import type { ScoreProvenance } from "@/lib/types";

function tierColor(score: number): BadgeColor {
  if (score >= 8) return "emerald";
  if (score >= 6) return "blue";
  if (score >= 4) return "amber";
  return "neutral";
}

// Tiny corner dot on the score badge — encodes where the score came from.
// Filled = confident source; hollow ring = a capped heuristic guess.
const PROVENANCE: Record<ScoreProvenance, { dot: string; ring: string; label: string }> = {
  enriched:    { dot: "bg-emerald",   ring: "border-emerald",   label: "Score from Claude JD analysis" },
  application: { dot: "bg-blue",       ring: "border-blue",       label: "Score from the application tracker" },
  override:    { dot: "bg-violet",     ring: "border-violet",     label: "Score set manually (eval override)" },
  heuristic:   { dot: "bg-text-muted", ring: "border-text-muted", label: "Score from a title/location heuristic — JD not analyzed" },
};

export function ScorePill({
  score,
  provenance,
  scoreCapped,
  overrideReason,
}: {
  score: number;
  provenance?: ScoreProvenance;
  scoreCapped?: boolean;
  overrideReason?: string;
}) {
  const p = provenance ? PROVENANCE[provenance] : null;
  const title = p
    ? p.label
        + (provenance === "override" && overrideReason ? ` — ${overrideReason}` : "")
        + (scoreCapped ? " — heuristic score capped (Claude has not analyzed this JD)" : "")
    : undefined;

  return (
    <span className="relative inline-flex items-center" title={title}>
      <Badge color={tierColor(score)}>{score}</Badge>
      {p && (
        <span
          aria-hidden
          className={`pointer-events-none absolute right-[2px] top-[2px] h-[5px] w-[5px] rounded-full ${
            scoreCapped ? `border bg-transparent ${p.ring}` : p.dot
          }`}
        />
      )}
    </span>
  );
}
