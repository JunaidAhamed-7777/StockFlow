import { Button } from "./Button";

/** Pagination for a complete fetched dataset. Callers slice using the same clamped page. */
export function Pagination({ page, total, pageSize = 20, onPageChange, label = "Records", busy = false }) {
  const size = Number.isSafeInteger(pageSize) && pageSize > 0 ? pageSize : 20;
  const count = Number.isSafeInteger(total) && total >= 0 ? total : 0;
  const pageCount = Math.max(1, Math.ceil(count / size));
  const currentPage = Math.min(pageCount, Math.max(1, Number.isSafeInteger(page) ? page : 1));
  const start = count ? (currentPage - 1) * size + 1 : 0;
  const end = Math.min(currentPage * size, count);

  return (
    <nav aria-label={`${label} pagination`} aria-busy={busy || undefined} className="flex flex-col sm:flex-row sm:items-center justify-between gap-space-sm border-t border-outline-variant px-space-base py-space-md">
      <p className="text-sm text-on-surface-variant tabular-nums" role="status">{start}–{end} of {count} {label.toLowerCase()}</p>
      <div className="flex items-center justify-between sm:justify-end gap-space-sm">
        <Button variant="outline" disabled={busy || currentPage === 1} onClick={() => onPageChange(currentPage - 1)}>Previous</Button>
        <span className="px-space-xs text-sm text-on-surface-variant tabular-nums whitespace-nowrap" aria-label={`Page ${currentPage} of ${pageCount}`}>{currentPage} / {pageCount}</span>
        <Button variant="outline" disabled={busy || currentPage === pageCount} onClick={() => onPageChange(currentPage + 1)}>Next</Button>
      </div>
    </nav>
  );
}
