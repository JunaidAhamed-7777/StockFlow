import { useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { pageRequestKey, readRequestedPage, remotePageReplacement, requestedPageFromParams, resolveRemotePage, setPageQuery } from "../utils/remotePage.mjs";

/** Remote counterpart to usePaginatedRows: returned rows are already a complete server page. */
export function useRemotePagination(result, { filters = {}, pageSize = 20, pageKey = "page", loadedRequestKey, ready = false } = {}) {
  const [params, setParams] = useSearchParams();
  const query = params.toString();
  const requestedPage = requestedPageFromParams(params, pageKey);
  const requestKey = pageRequestKey(filters, requestedPage, pageSize);
  const pagination = useMemo(() => resolveRemotePage({ result, requestedPage, pageSize, requestKey, loadedRequestKey, ready }), [result, requestedPage, pageSize, requestKey, loadedRequestKey, ready]);

  useEffect(() => {
    const options = { expectedQuery: query, pageKey, result, pageSize, requestKey, loadedRequestKey, ready };
    if (!remotePageReplacement(query, options)) return;
    setParams((current) => remotePageReplacement(current, options) ?? current, { replace: true });
  }, [query, pageKey, result, pageSize, requestKey, loadedRequestKey, ready, setParams]);

  function setPage(page) {
    if (!pagination.ready) return;
    const target = Math.min(readRequestedPage(page), pagination.pageCount);
    setParams((current) => current.toString() === query ? setPageQuery(current, target, pageKey) : current);
  }

  return { ...pagination, requestedPage, requestKey, setPage };
}
