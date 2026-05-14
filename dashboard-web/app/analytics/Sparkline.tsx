/**
 * Sparkline.tsx — minimal SVG line chart.
 *
 * Deliberately dependency-free: shipping recharts (~80KB gzipped) for four
 * lines on one page is overkill. We render directly to SVG with the project's
 * design tokens.
 *
 * Usage:
 *   <Sparkline data={[3, 5, 4, 9, 7]} color="emerald" height={48} />
 */

import type { BadgeColor } from "@/components/ui/Badge";

interface SparklineProps {
  data: Array<number | null>;
  color?: BadgeColor;
  height?: number;
  width?: number;
  /** Optional formatted labels for each point, used as title on hover. */
  labels?: string[];
  /** When provided, fixes the y-axis to [0, yMax] rather than autoscaling. */
  yMax?: number;
  /** When provided, renders the max value as faint text in the top-right. */
  showMaxLabel?: (max: number) => string;
}

const COLOR_VAR: Record<BadgeColor, string> = {
  neutral: "var(--color-text-tertiary)",
  accent: "var(--color-accent)",
  emerald: "var(--color-emerald)",
  amber: "var(--color-amber)",
  blue: "var(--color-blue)",
  violet: "var(--color-violet)",
  red: "var(--color-red)",
};

export function Sparkline({
  data,
  color = "blue",
  height = 48,
  width = 200,
  labels,
  yMax,
  showMaxLabel,
}: SparklineProps) {
  if (data.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-md bg-surface-3 text-[11px] text-text-muted"
        style={{ height, width }}
      >
        no data
      </div>
    );
  }

  const valid = data.map((v) => (v === null || Number.isNaN(v) ? null : v));
  const numeric = valid.filter((v): v is number => v !== null);
  const max = yMax !== undefined ? yMax : Math.max(...numeric, 1);
  const min = Math.min(...numeric, 0);
  const range = Math.max(max - min, 1);

  const pad = 4;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  const stepX = valid.length > 1 ? innerW / (valid.length - 1) : 0;

  const points = valid.map((v, i) => {
    if (v === null) return null;
    const x = pad + i * stepX;
    const y = pad + innerH - ((v - min) / range) * innerH;
    return { x, y, value: v, index: i };
  });

  // Build the polyline path, breaking on null gaps so the line doesn't lie about missing days.
  const segments: Array<Array<{ x: number; y: number }>> = [];
  let cur: Array<{ x: number; y: number }> = [];
  for (const p of points) {
    if (p === null) {
      if (cur.length > 0) {
        segments.push(cur);
        cur = [];
      }
    } else {
      cur.push({ x: p.x, y: p.y });
    }
  }
  if (cur.length > 0) segments.push(cur);

  const stroke = COLOR_VAR[color];

  return (
    <svg
      width={width}
      height={height}
      role="img"
      aria-label={`Trend over ${data.length} points`}
      className="block"
    >
      {/* baseline */}
      <line
        x1={pad}
        y1={height - pad}
        x2={width - pad}
        y2={height - pad}
        stroke="var(--color-border-subtle)"
        strokeWidth={1}
      />
      {segments.map((seg, si) => (
        <polyline
          key={si}
          fill="none"
          stroke={stroke}
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          points={seg.map((p) => `${p.x},${p.y}`).join(" ")}
        />
      ))}
      {/* Last-point marker */}
      {points.length > 0 &&
        (() => {
          for (let i = points.length - 1; i >= 0; i--) {
            const p = points[i];
            if (p) {
              return <circle cx={p.x} cy={p.y} r={2.5} fill={stroke} />;
            }
          }
          return null;
        })()}
      {/* Faint max-value annotation top-right */}
      {showMaxLabel && numeric.length > 0 && (
        <>
          <line
            x1={pad}
            y1={pad}
            x2={width - pad}
            y2={pad}
            stroke="var(--color-border-subtle)"
            strokeWidth={1}
            strokeDasharray="2 3"
          />
          <text
            x={width - pad}
            y={pad - 1}
            fontSize="10"
            fill="var(--color-text-muted)"
            textAnchor="end"
          >
            max {showMaxLabel(max)}
          </text>
        </>
      )}
      {/* Hover targets */}
      {points.map((p, i) =>
        p === null ? null : (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={4}
            fill="transparent"
            stroke="transparent"
          >
            <title>
              {labels?.[i] ? `${labels[i]}: ` : ""}
              {p.value}
            </title>
          </circle>
        ),
      )}
    </svg>
  );
}
