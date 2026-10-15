const record = (value) => value !== null && typeof value === "object" && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const positive = (value) => Number.isSafeInteger(value) && value > 0;
const invalid = () => { throw new Error("The server returned an invalid page. Try loading the list again."); };

function requirePageSize(value) {
  if (!positive(value) || value > 100) throw new Error("Page size must be a whole number from 1 to 100.");
  return value;
}

function requirePageKey(value) {
  if (typeof value !== "string" || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value)) throw new Error("Invalid page query key.");
  return value;
}

/** Invalid URL state falls back to page one; no incomplete dataset is used to clamp it. */
export function readRequestedPage(value) {
  const parsed = typeof value === "string" && /^[1-9]\d*$/.test(value) ? Number(value) : value;
  return positive(parsed) ? parsed : 1;
}

export function requestedPageFromParams(params, pageKey = "page") {
  const values = new URLSearchParams(params).getAll(requirePageKey(pageKey));
  return values.length === 1 ? readRequestedPage(values[0]) : 1;
}

/** Opted-in reads must not silently accept a legacy array or missing pagination metadata. */
export function normalizePageEnvelope(body, { requestedPage, pageSize } = {}) {
  if (!record(body) || body.success !== true || !Array.isArray(body.data) || !record(body.pagination)) invalid();
  const { page, pageSize: size, total, pageCount, hasNext, hasPrevious } = body.pagination;
  if (!positive(page) || !positive(size) || size > 100 || !Number.isSafeInteger(total) || total < 0 || !positive(pageCount)) invalid();
  if (pageCount !== Math.max(1, Math.ceil(total / size)) || page > pageCount || hasNext !== (page < pageCount) || hasPrevious !== (page > 1)) invalid();
  if (body.data.length !== Math.min(size, total - (page - 1) * size)) invalid();
  for (const row of body.data) if (!record(row)) invalid();
  if (requestedPage !== undefined && (!positive(requestedPage) || page !== Math.min(requestedPage, pageCount))) invalid();
  if (pageSize !== undefined && (!positive(pageSize) || pageSize > 100 || size !== pageSize)) invalid();
  if (Object.hasOwn(body, "summary") && !record(body.summary)) invalid();
  return {
    rows: body.data.slice(), page, pageSize: size, total, pageCount, hasNext, hasPrevious,
    ...(Object.hasOwn(body, "summary") ? { summary: body.summary } : {}),
  };
}

/** Stable identity for committed filters, requested page and fixed page size. */
export function pageRequestKey(filters = {}, page = 1, pageSize = 20) {
  if (!record(filters) || !positive(page)) throw new Error("Invalid page request.");
  requirePageSize(pageSize);
  const entries = Object.entries(filters).filter(([, value]) => value !== undefined).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  if (entries.some(([, value]) => value !== null && typeof value !== "string" && typeof value !== "boolean" && !(typeof value === "number" && Number.isFinite(value)))) throw new Error("Page filters must contain plain query values.");
  return JSON.stringify([entries, page, pageSize]);
}

/** A stale or pending response cannot establish rows, totals, or a canonical URL page. */
export function resolveRemotePage({ result, requestedPage = 1, pageSize = 20, requestKey, loadedRequestKey, ready = false } = {}) {
  if (!positive(requestedPage)) throw new Error("Invalid requested page.");
  requirePageSize(pageSize);
  const matched = ready === true && typeof requestKey === "string" && requestKey.length > 0 && loadedRequestKey === requestKey && result !== null && result !== undefined;
  if (!matched) return { rows: [], page: requestedPage, pageSize, total: 0, pageCount: 1, hasNext: false, hasPrevious: false, ready: false, busy: true };
  const normalized = normalizePageEnvelope({
    success: true, data: result.rows, pagination: result,
    ...(Object.hasOwn(result, "summary") ? { summary: result.summary } : {}),
  }, { requestedPage, pageSize });
  return { ...normalized, ready: true, busy: false };
}

/** Change one pager while preserving committed filters and independent sibling pagers. */
export function setPageQuery(params, page, pageKey = "page") {
  requirePageKey(pageKey);
  if (!positive(page)) throw new Error("Invalid requested page.");
  const next = new URLSearchParams(params);
  if (page === 1) next.delete(pageKey);
  else next.set(pageKey, String(page));
  return next;
}

/** Recheck the whole query at commit time so a late effect cannot overwrite newer navigation. */
export function remotePageReplacement(params, { expectedQuery, pageKey = "page", ...response } = {}) {
  const current = new URLSearchParams(params);
  if (typeof expectedQuery !== "string" || current.toString() !== expectedQuery) return null;
  const state = resolveRemotePage({ ...response, requestedPage: requestedPageFromParams(current, pageKey) });
  if (!state.ready) return null;
  const next = setPageQuery(current, state.page, pageKey);
  return next.toString() === current.toString() ? null : next;
}
