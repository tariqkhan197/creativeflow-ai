import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="grid gap-8" aria-busy="true" aria-label="Loading">
      <div className="grid gap-2">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-80" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-40 rounded-xl" />
        ))}
      </div>
    </div>
  );
}
