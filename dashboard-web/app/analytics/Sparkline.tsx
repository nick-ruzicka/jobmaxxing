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
  // Natural max from the data. The fallback to 1 is ONLY to avoid divide-by-zero
  // when the series is all-zeros — previously we floored to 1 unconditionally,
  // which made every sub-dollar cost chart display 'max $1.00'.
  const naturalMax = numeric.length > 0 ? Math.max(...numeric) : 0;
  const max = yMax !== undefined ? yMax : naturalMax > 0 ? naturalMax : 1;
  const min = Math.min(...numeric, 0);
  // range must be positive; the >0 epsilon here only matters for all-zero series.
  const range = max - min > 0 ? max - min : 1;

  // Top padding leaves room for the "max N" label when it's shown; otherwise
  // we don't waste vertical space. Bottom padding always leaves room for the
  // baseline rule.
  const padX = 4;
  const padTop = showMaxLabel ? 14 : 4;
  const padBottom = 4;
  const innerW = width - padX * 2;
  const innerH = height - padTop - padBottom;
  const stepX = valid.length > 1 ? innerW / (valid.length - 1) : 0;

  const points = valid.map((v, i) => {
    if (v === null) return null;
    const x = padX + i * stepX;
    const y = padTop + innerH - ((v - min) / range) * innerH;
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
        x1={padX}
        y1={height - padBottom}
        x2={width - padX}
        y2={height - padBottom}
        stroke="var(--color-border-subtle)"
        strokeWidth={1}
      />
      {/* Faint max-value annotation in the reserved top strip.
          The dashed line sits at padTop (top of the plot area). The text
          is drawn ABOVE the line at y=padTop-3, where there's room because
          we reserved padTop=14 of vertical space. */}
      {showMaxLabel && numeric.length > 0 && (
        <>
          <line
            x1={padX}
            y1={padTop}
            x2={width - padX}
            y2={padTop}
            stroke="var(--color-border-subtle)"
            strokeWidth={1}
            strokeDasharray="2 3"
          />
          <text
            x={width - padX}
            y={padTop - 3}
            fontSize="10"
            fill="var(--color-text-muted)"
            textAnchor="end"
          >
            max {showMaxLabel(max)}
          </text>
        </>
      )}
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
