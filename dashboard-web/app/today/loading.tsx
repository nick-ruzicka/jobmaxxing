import { Skeleton } from "@/components/ui";

/**
 * Suspense fallback for /today — shows a briefing-shaped skeleton so the page
 * appears to load instantly even when the server component is still computing
 * stats. Matches the briefing card + stat strip layout.
 */
export default function Loading() {
  return (
    <div className="space-y-6 p-6" aria-busy="true">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <Skeleton width={80} height={22} />
          <Skeleton width={180} height={14} />
        </div>
        <div className="flex gap-2">
          <Skeleton width={100} height={32} className="rounded-md" />
          <Skeleton width={100} height={32} className="rounded-md" />
        </div>
      </div>

      {/* Morning briefing card skeleton */}
      <div className="rounded-lg border border-border-subtle bg-surface-2">
        <div className="flex items-center justify-between border-b border-border-subtle px-4 py-2.5">
          <Skeleton width={120} height={14} />
          <Skeleton width={60} height={20} className="rounded-md" />
        </div>
        <div className="divide-y divide-border-subtle">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-start gap-3 px-4 py-3">
              <Skeleton width={16} height={16} className="mt-0.5 shrink-0 rounded" />
              <div className="flex-1 space-y-1.5">
                <Skeleton width="70%" height={14} />
                <Skeleton width="50%" height={12} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Stat strip */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} height={56} className="rounded-lg" />
        ))}
      </div>
    </div>
  );
}
