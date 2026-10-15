import test from "node:test";
import assert from "node:assert/strict";
import { paginateRows } from "../src/utils/listState.mjs";

test("complete datasets restore a URL page and clamp after filtering or deletion", () => {
  const records = Array.from({ length: 44 }, (_, id) => ({ id }));
  assert.deepEqual(paginateRows(records, "3").rows.map(({ id }) => id), [40, 41, 42, 43]);
  const filtered = paginateRows(records.slice(0, 21), "3");
  assert.equal(filtered.page, 2);
  assert.equal(filtered.total, 21);
  assert.equal(filtered.rows[0].id, 20);
  const deleted = paginateRows(records.slice(0, 20), "2");
  assert.equal(deleted.page, 1);
  assert.equal(deleted.rows.length, 20);
});

test("invalid pages and empty lists stay on a usable first page without mutating records", () => {
  const records = [{ id: 1 }, { id: 2 }];
  for (const page of [null, undefined, "0", "-1", "NaN", "1.5", "1e3", "9007199254740992", Infinity, {}, []]) {
    assert.equal(paginateRows(records, page).page, 1);
  }
  assert.deepEqual(paginateRows([], "99"), { rows: [], page: 1, pageSize: 20, pageCount: 1, total: 0 });
  paginateRows(records, 1).rows.pop();
  assert.equal(records.length, 2);
});
