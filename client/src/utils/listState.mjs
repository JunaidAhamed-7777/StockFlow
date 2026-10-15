export function paginateRows(rows, requestedPage, requestedSize = 20) {
  const items = Array.isArray(rows) ? rows : [];
  const pageSize = Number.isSafeInteger(requestedSize) && requestedSize > 0 ? requestedSize : 20;
  const value = typeof requestedPage === "string" && /^[1-9]\d*$/.test(requestedPage) ? Number(requestedPage) : requestedPage;
  const requested = Number.isSafeInteger(value) && value > 0 ? value : 1;
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const page = Math.min(requested, pageCount);
  return { rows: items.slice((page - 1) * pageSize, page * pageSize), page, pageSize, pageCount, total: items.length };
}
