export function Loading({ label = "Loading…" }) {
  return (
    <div role="status" className="flex flex-col items-center justify-center py-space-3xl gap-space-sm text-on-surface-variant">
      <span aria-hidden="true" className="material-symbols-outlined animate-spin text-secondary text-2xl">progress_activity</span>
      <p className="font-label-sm text-label-sm">{label}</p>
    </div>
  );
}

export function Skeleton({ className = "" }) {
  return <div aria-hidden="true" className={`animate-pulse bg-surface-container rounded ${className}`} />;
}

export function PageSkeleton() {
  return (
    <div role="status" aria-label="Loading page" className="space-y-space-lg">
      <Skeleton className="h-24 w-full rounded-xl" />
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-space-base">
        <Skeleton className="h-28 rounded-xl" />
        <Skeleton className="h-28 rounded-xl" />
        <Skeleton className="h-28 rounded-xl" />
        <Skeleton className="h-28 rounded-xl" />
      </div>
      <Skeleton className="h-80 w-full rounded-xl" />
    </div>
  );
}
