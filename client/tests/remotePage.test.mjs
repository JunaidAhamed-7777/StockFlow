import test from "node:test";
import assert from "node:assert/strict";
import { normalizePageEnvelope, pageRequestKey, readRequestedPage, remotePageReplacement, requestedPageFromParams, resolveRemotePage, setPageQuery } from "../src/utils/remotePage.mjs";

function envelope({ page = 1, pageSize = 20, total = 44 } = {}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  return {
    success: true,
    data: Array.from({ length: Math.min(pageSize, total - (page - 1) * pageSize) }, (_, index) => ({ id: (page - 1) * pageSize + index + 1 })),
    pagination: { page, pageSize, total, pageCount, hasNext: page < pageCount, hasPrevious: page > 1 },
    summary: { productCount: total },
  };
}

function response({ query = "page=2", filters = { search: "desk" }, requestedPage = 2, returnedPage = requestedPage, pageSize = 20, total = 44, ready = true } = {}) {
  const result = normalizePageEnvelope(envelope({ page: returnedPage, pageSize, total }), { requestedPage, pageSize });
  const requestKey = pageRequestKey(filters, requestedPage, pageSize);
  return { expectedQuery: query, result, pageSize, requestKey, loadedRequestKey: requestKey, ready };
}

test("remote page normalization preserves page-two rows and complete totals without slicing again", () => {
  const source = envelope({ page: 2 });
  const result = normalizePageEnvelope(source, { requestedPage: 2, pageSize: 20 });
  assert.equal(result.rows.length, 20);
  assert.equal(result.rows[0].id, 21);
  assert.equal(result.rows.at(-1).id, 40);
  assert.equal(result.total, 44);
  assert.equal(result.pageCount, 3);
  assert.deepEqual(result.summary, { productCount: 44 });
  assert.notEqual(result.rows, source.data);
  result.rows.pop();
  assert.equal(source.data.length, 20);
});

test("empty and final pages retain an exact server count and consistent navigation flags", () => {
  const empty = normalizePageEnvelope(envelope({ total: 0 }), { requestedPage: 999 });
  assert.deepEqual(empty.rows, []);
  assert.equal(empty.page, 1);
  assert.equal(empty.pageCount, 1);
  assert.equal(empty.hasNext, false);
  assert.equal(empty.hasPrevious, false);
  const final = normalizePageEnvelope(envelope({ page: 3 }), { requestedPage: 999 });
  assert.deepEqual(final.rows.map(({ id }) => id), [41, 42, 43, 44]);
  assert.equal(final.hasNext, false);
  assert.equal(final.hasPrevious, true);
});

test("missing legacy or inconsistent envelopes fail instead of inventing an empty result", () => {
  for (const body of [null, [], {}, { success: true, data: [] }, { data: [], pagination: {} }, { success: false, data: [], pagination: {} }]) assert.throws(() => normalizePageEnvelope(body), /invalid page/);
  const mutations = [
    (value) => { value.pagination.page = "1"; },
    (value) => { value.pagination.page = 0; },
    (value) => { value.pagination.pageSize = 101; },
    (value) => { value.pagination.total = "44"; },
    (value) => { value.pagination.total = Number.MAX_SAFE_INTEGER + 1; },
    (value) => { value.pagination.total = -1; },
    (value) => { value.pagination.pageCount = 2; },
    (value) => { value.pagination.hasNext = "true"; },
    (value) => { value.pagination.hasPrevious = true; },
    (value) => { value.data.pop(); },
    (value) => { value.data.push({ id: 21 }); },
    (value) => { value.data[0] = null; },
    (value) => { value.data[0] = []; },
    (value) => { delete value.data[0]; },
    (value) => { value.summary = []; },
    (value) => { value.summary = new Date(); },
  ];
  for (const mutate of mutations) {
    const value = envelope(); mutate(value);
    assert.throws(() => normalizePageEnvelope(value), /invalid page/);
  }
  assert.throws(() => normalizePageEnvelope(envelope(), { requestedPage: 2 }), /invalid page/);
  assert.throws(() => normalizePageEnvelope(envelope(), { pageSize: 12 }), /invalid page/);
});

test("URL parsing restores only canonical positive safe pages and preserves pending high pages", () => {
  for (const value of [null, undefined, "", "0", "-1", "01", "1.5", "1e3", " 2", "2 ", "NaN", Infinity, {}, [], true, "9007199254740992"]) assert.equal(readRequestedPage(value), 1);
  assert.equal(readRequestedPage("7"), 7);
  assert.equal(readRequestedPage(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER);
  assert.equal(requestedPageFromParams("page=99"), 99);
  assert.equal(requestedPageFromParams("page=2&page=3"), 1);
  assert.equal(requestedPageFromParams("page=8&lowPage=3", "lowPage"), 3);
});

test("request identity includes committed filters page and size with stable key ordering", () => {
  const first = pageRequestKey({ search: "desk", supplier: 2, category: "" }, 2, 20);
  assert.equal(first, pageRequestKey({ category: "", supplier: 2, search: "desk", omitted: undefined }, 2, 20));
  assert.notEqual(first, pageRequestKey({ search: "chair", supplier: 2, category: "" }, 2, 20));
  assert.notEqual(first, pageRequestKey({ search: "desk", supplier: 3, category: "" }, 2, 20));
  assert.notEqual(first, pageRequestKey({ search: "desk", supplier: 2, category: "" }, 3, 20));
  assert.notEqual(first, pageRequestKey({ search: "desk", supplier: 2, category: "" }, 2, 12));
  for (const filters of [null, [], new Date(), { search: {} }, { supplier: Infinity }, { search: ["desk"] }]) assert.throws(() => pageRequestKey(filters));
  for (const size of [0, "20", 0.5, 101, Infinity]) assert.throws(() => pageRequestKey({}, 1, size), /Page size/);
});

test("only a matching successful request makes remote rows and totals ready", () => {
  const current = response();
  const matched = resolveRemotePage({ ...current, requestedPage: 2 });
  assert.equal(matched.ready, true);
  assert.equal(matched.busy, false);
  assert.equal(matched.rows[0].id, 21);
  assert.equal(matched.rows.length, 20);
  for (const patch of [
    { ready: false }, { ready: "true" }, { result: null }, { loadedRequestKey: undefined },
    { loadedRequestKey: pageRequestKey({ search: "old" }, 2, 20) },
    { loadedRequestKey: pageRequestKey({ search: "desk" }, 1, 20) },
    { loadedRequestKey: pageRequestKey({ search: "desk" }, 2, 12) },
  ]) {
    const pending = resolveRemotePage({ ...current, ...patch, requestedPage: 2 });
    assert.equal(pending.ready, false);
    assert.equal(pending.busy, true);
    assert.deepEqual(pending.rows, []);
    assert.equal(pending.total, 0);
    assert.equal(pending.page, 2);
  }
  assert.equal(resolveRemotePage({ ...current, result: { rows: [null] }, loadedRequestKey: "superseded", requestedPage: 2 }).ready, false);
  assert.throws(() => resolveRemotePage({ ...current, result: { rows: [null] }, requestedPage: 2 }), /invalid page/);
});

test("late success cannot clamp a restored or newer URL before its matching successful load", () => {
  const query = "search=desk&page=99&lowPage=4";
  const loaded = response({ query, requestedPage: 99, returnedPage: 3 });
  assert.equal(remotePageReplacement(query, { ...loaded, ready: false }), null);
  assert.equal(remotePageReplacement(query, { ...loaded, loadedRequestKey: pageRequestKey({ search: "old" }, 99, 20) }), null);
  const clamped = remotePageReplacement(query, loaded);
  assert.equal(clamped.get("page"), "3");
  assert.equal(clamped.get("search"), "desk");
  assert.equal(clamped.get("lowPage"), "4");
  assert.equal(remotePageReplacement(clamped, loaded), null, "the completed clamp cannot rewrite its replacement query again");
  for (const newer of ["search=chair&page=99&lowPage=4", "search=desk&page=2&lowPage=4", "search=desk&page=99&lowPage=5"]) assert.equal(remotePageReplacement(newer, loaded), null);
  assert.equal(remotePageReplacement("page=2", response()), null);
});

test("empty results and malformed URL pages canonicalize only after successful matching responses", () => {
  const empty = response({ query: "search=none&page=9", filters: { search: "none" }, requestedPage: 9, returnedPage: 1, total: 0 });
  assert.equal(remotePageReplacement(empty.expectedQuery, empty).toString(), "search=none");
  const malformed = response({ query: "page=invalid&supplier=2", requestedPage: 1 });
  assert.equal(remotePageReplacement(malformed.expectedQuery, { ...malformed, ready: false }), null);
  assert.equal(remotePageReplacement(malformed.expectedQuery, malformed).toString(), "supplier=2");
});

test("independent pager changes preserve sibling filters and never mutate existing URL state", () => {
  const query = new URLSearchParams("search=desk&page=2&lowPage=3");
  assert.equal(setPageQuery(query, 1).toString(), "search=desk&lowPage=3");
  assert.equal(setPageQuery(query, 4, "lowPage").toString(), "search=desk&page=2&lowPage=4");
  assert.equal(query.toString(), "search=desk&page=2&lowPage=3");
  assert.throws(() => setPageQuery(query, 0), /requested page/);
  assert.throws(() => requestedPageFromParams(query, ""), /page query key/);
});
