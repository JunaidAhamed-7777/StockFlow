import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { paginateRows } from "../utils/listState.mjs";

/** Committed list filters are shareable; unsubmitted text stays with the page's form. */
export function useListFilters(defaults) {
  const [params, setParams] = useSearchParams();
  const filters = Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => [key, params.get(key) ?? fallback]));
  function setFilters(patch) {
    setParams((current) => {
      const next = new URLSearchParams(current);
      for (const [key, value] of Object.entries(patch)) {
        const text = String(value).trim();
        if (!text || text === defaults[key]) next.delete(key);
        else next.set(key, text);
      }
      next.delete("page");
      return next;
    });
  }
  return { filters, setFilters };
}

/** Complete API arrays use bounded client paging until the API supports cursors. */
export function usePaginatedRows(rows, { pageKey = "page", pageSize = 20, ready = true } = {}) {
  const [params, setParams] = useSearchParams();
  const requestedPage = params.get(pageKey);
  const pagination = paginateRows(rows, requestedPage, pageSize);
  useEffect(() => {
    // Do not erase a restored page while the initial dataset is still loading.
    if (!ready || requestedPage === null || requestedPage === String(pagination.page)) return;
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (pagination.page === 1) next.delete(pageKey);
      else next.set(pageKey, String(pagination.page));
      return next;
    }, { replace: true });
  }, [ready, requestedPage, pagination.page, pageKey, setParams]);
  function setPage(page) {
    const target = paginateRows(rows, page, pagination.pageSize).page;
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (target === 1) next.delete(pageKey);
      else next.set(pageKey, String(target));
      return next;
    });
  }
  return { ...pagination, setPage };
}
