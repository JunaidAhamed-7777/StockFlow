const readError = (message, status = 400) => Object.assign(new Error(message), { status });

function positiveInteger(value, maximum = Number.MAX_SAFE_INTEGER) {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > maximum) {
    throw readError('Invalid positive integer query value');
  }
  return Number(value);
}

function pageRequested(query = {}) {
  if (Object.keys(query).some((key) => /^(?:page|pageSize)(?:\[|\.)/.test(key))) throw readError('Structured page parameters are invalid');
  return Object.hasOwn(query, 'page') || Object.hasOwn(query, 'pageSize');
}

function parsePageQuery(query, { allowed, sorts, defaultSort = 'id', defaultOrder = 'asc' }) {
  for (const [key, value] of Object.entries(query)) {
    if (!allowed.includes(key) || typeof value !== 'string') throw readError('Unknown, repeated or structured page query parameter');
  }
  if (!Object.hasOwn(query, 'page')) throw readError('page is required for paged reads');
  const page = positiveInteger(query.page);
  const pageSize = Object.hasOwn(query, 'pageSize') ? positiveInteger(query.pageSize, 100) : 20;
  const search = (query.search ?? '').trim();
  if (search.length > 200 || /[\u0000-\u001f\u007f]/.test(search)) throw readError('Invalid search query');
  const sortBy = query.sortBy ?? defaultSort;
  const sortOrder = query.sortOrder ?? defaultOrder;
  if (!sorts.includes(sortBy) || !['asc', 'desc'].includes(sortOrder)) throw readError('Invalid page sort');
  return { page, pageSize, search, sortBy, sortOrder };
}

function pageInfo(options, total) {
  const pageCount = Math.max(1, Math.ceil(total / options.pageSize));
  const page = Math.min(options.page, pageCount);
  return { page, pageSize: options.pageSize, total, pageCount, hasNext: page < pageCount, hasPrevious: page > 1 };
}

const positiveId = (value) => positiveInteger(value, 2_147_483_647);
// PostgreSQL LIKE uses backslash as its default escape; user wildcards stay literal.
const literalLike = (value) => `%${value.replace(/[\\%_]/g, '\\$&')}%`;

module.exports = { readError, positiveId, pageRequested, parsePageQuery, pageInfo, literalLike };
