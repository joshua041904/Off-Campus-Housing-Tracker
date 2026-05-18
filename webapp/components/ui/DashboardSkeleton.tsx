"use client";

type SkeletonProps = {
  rows?: number;
  className?: string;
  "data-testid"?: string;
};

export function TableRowsSkeleton({ rows = 5, className = "", "data-testid": testId }: SkeletonProps) {
  return (
    <ul className={`animate-pulse divide-y divide-slate-100 ${className}`} data-testid={testId}>
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="px-4 py-4">
          <div className="h-4 w-2/3 rounded bg-slate-200" />
          <div className="mt-2 h-3 w-1/2 rounded bg-slate-100" />
        </li>
      ))}
    </ul>
  );
}

export function CardGridSkeleton({ rows = 3, className = "", "data-testid": testId }: SkeletonProps) {
  return (
    <div
      className={`grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 ${className}`}
      data-testid={testId}
    >
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="animate-pulse rounded-xl border border-slate-200 bg-white p-4">
          <div className="h-32 rounded-lg bg-slate-200" />
          <div className="mt-3 h-4 w-3/4 rounded bg-slate-200" />
          <div className="mt-2 h-3 w-1/2 rounded bg-slate-100" />
        </div>
      ))}
    </div>
  );
}

export function InboxListSkeleton({ rows = 4 }: { rows?: number }) {
  return <TableRowsSkeleton rows={rows} data-testid="inbox-list-skeleton" />;
}

export function PageAuthLoading({ label = "Loading…" }: { label?: string }) {
  return (
    <p className="mt-6 text-sm text-slate-600" data-testid="page-auth-loading">
      {label}
    </p>
  );
}
