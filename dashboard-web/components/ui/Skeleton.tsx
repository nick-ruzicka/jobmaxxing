interface SkeletonProps {
  className?: string;
  width?: number | string;
  height?: number | string;
}

/** A loading placeholder block — opacity pulse (no shimmer gradient). Honors prefers-reduced-motion via globals.css. */
export function Skeleton({ className = "", width, height }: SkeletonProps) {
  return <div className={`animate-pulse rounded-md bg-surface-2 ${className}`} style={{ width, height }} aria-hidden />;
}
