import test from "node:test";
import assert from "node:assert/strict";
import { pagedReadQuery, normalizeReadPage } from "../src/utils/pagedReads.mjs";

test("paged adapters opt in explicitly and reject an owner override or malformed ID before a request", () => {
  assert.deepEqual(pagedReadQuery("products", { page: 2, pageSize: 12, search: "  late SKU  ", supplier: "2", category: "", stock: "low" }),
    { page: 2, pageSize: 12, search: "late SKU", supplier: 2, stock: "low" });
  assert.deepEqual(pagedReadQuery("suppliers", { includeProductCounts: true }), { page: 1, pageSize: 20, includeProductCounts: "true" });
  assert.throws(() => pagedReadQuery("orders", { customerId: 99 }), /Unsupported/);
  for (const supplier of ["0x2", "2.0", true, "2147483648", {}, [2]]) assert.throws(() => pagedReadQuery("products", { supplier }));
  assert.throws(() => pagedReadQuery("products", { pageSize: 101 }));
  assert.throws(() => pagedReadQuery("products", { search: "x".repeat(201) }));
});

function body(summary) {
  return { success: true, data: [{ id: 21 }], pagination: { page: 2, pageSize: 20, total: 21, pageCount: 2, hasNext: false, hasPrevious: true }, summary };
}

test("a final page uses complete totals and rejects missing, non-finite or page-only aggregates", () => {
  const summary = { productCount: 21, totalQuantity: 100, lowStockCount: 7, criticalStockCount: 3, outOfStockCount: 1, inventoryValue: 256.5 };
  const page = normalizeReadPage("products", body(summary), { page: 2, pageSize: 20 });
  assert.equal(page.rows.length, 1);
  assert.equal(page.summary.productCount, 21);
  for (const patch of [{ productCount: 1 }, { inventoryValue: Infinity }, { totalQuantity: 1.5 }, { criticalStockCount: undefined }]) {
    assert.throws(() => normalizeReadPage("products", body({ ...summary, ...patch }), { page: 2, pageSize: 20 }), /incomplete list totals/);
  }
  assert.throws(() => normalizeReadPage("products", body(undefined), { page: 2, pageSize: 20 }));
});

test("order and customer-directory summaries cannot be mistaken for each other", () => {
  const summary = { orderCount: 21, visibleLineCount: 30, visibleUnits: 45, visibleAmount: 123,
    statusCounts: { PENDING: 7, PROCESSING: 4, SHIPPED: 2, DELIVERED: 7, CANCELLED: 1 } };
  const query = { page: 2, pageSize: 20 };
  assert.equal(normalizeReadPage("orders", body(summary), query).summary.visibleAmount, 123);
  assert.throws(() => normalizeReadPage("orders", body({ ...summary, statusCounts: { ...summary.statusCounts, PENDING: 6 } }), query));
  const grouped = { customerCount: 21, totalSpending: 1500 };
  assert.equal(normalizeReadPage("orders", body(grouped), { ...query, view: "customers" }).summary.totalSpending, 1500);
  assert.throws(() => normalizeReadPage("orders", body(grouped), query));
  assert.throws(() => normalizeReadPage("orders", body(summary), { ...query, view: "customers" }));
});
