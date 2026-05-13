"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { EmptyState, Button } from "@/components/ui";

// Next 16.2 also passes `unstable_retry` (re-fetch + re-render); `reset` (re-render only)
// is enough here since the data layer re-runs on a force-dynamic route.
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <EmptyState
        icon={<AlertTriangle size={28} />}
        title="Something went wrong"
        description={error.message || "An unexpected error occurred while loading this page."}
        action={
          <Button variant="secondary" onClick={() => reset()}>
            Try again
          </Button>
        }
      />
    </div>
  );
}
