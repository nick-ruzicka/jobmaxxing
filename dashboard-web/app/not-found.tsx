import { FileQuestion } from "lucide-react";
import { EmptyState, Button } from "@/components/ui";

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <EmptyState
        icon={<FileQuestion size={28} />}
        title="Page not found"
        description="That page doesn't exist."
        action={<Button href="/">Back to Pipeline</Button>}
      />
    </div>
  );
}
