import { Skeleton } from "@/components/ui";

/**
 * Suspense fallback for the dashboard routes. With the current sync (file-read) data
 * layer this rarely renders, but it's the shape every page shares: title bar, a row of
 * stat cards, a table.
 */
export default function Loading() {
  return (
    <div className="space-y-6 p-6" aria-busy="true">
      {/* page header */}
      <div className="flex items-center justify-between">
        <Skeleton width={140} height={22} />
        <Skeleton width={220} height={30} />
      </div>

      {/* stat strip */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} height={64} className="rounded-lg" />
        ))}
      </div>

      {/* table */}
      <div className="space-y-2.5 rounded-lg border border-border-subtle bg-surface-2 p-3">
        {Array.from({ length: 9 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton width={64} height={20} />
            <Skeleton className="flex-1" height={14} />
            <Skeleton width={100} height={20} />
          </div>
        ))}
      </div>
    </div>
  );
}
