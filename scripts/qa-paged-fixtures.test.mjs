import assert from "node:assert/strict";
import test from "node:test";
import { createFixtures } from "./qa-browser-server.mjs";
import { productPage, orderPage, orderDetail, supplierPage } from "./qa-paged-fixtures.mjs";

const params = (value = "page=1") => new URLSearchParams(value);
const fixtures = (products = 44, orders = 44) => createFixtures({ products, orders, suppliers: 4 });
const admin = { role: "ADMIN", userId: 3 };
const supplier = { role: "SUPPLIER", userId: 2, supplierId: 1 };
const customer = { role: "CUSTOMER", userId: 1 };
const failure = (call, status = 400) => assert.throws(call, (error) => error.status === status);

test("page queries reject missing, repeated, structured, malformed and unknown values", () => {
  const f = fixtures();
  for (const query of ["", "pageSize=20", "page=0", "page=-1", "page=1.5", "page=01", "page=Infinity", "page=9007199254740992", "page=1&page=2", "page[]=1", "page=1&pageSize=0", "page=1&pageSize=101", "page=1&supplier=0", "page=1&category=2147483648", "page=1&sortBy=description", "page=1&sortOrder=sideways", "page=1&stock=unknown", "page=1&stock=low&lowStock=true", "page=1&search=" + "x".repeat(201), "page=1&search=%00", "page=1&supplier=1&supplier=2", "page=1&customerId=2"]) failure(() => productPage(f, params(query)));
  for (const query of ["page=1&status=UNKNOWN", "page=1&sortBy=totalAmount", "page=1&sortBy=", "page=1&sortOrder=", "page=1&customerId=2", "page=1&supplier=2", "page=1&view=unknown", "page=1&view=customers&view=customers"]) failure(() => orderPage(f, params(query), admin));
  failure(() => orderPage(f, params(), { role: "SUPPLIER" }), 404);
  failure(() => orderPage(f, params(), { role: "CUSTOMER" }), 401);
});

test("product filters precede paging, use per-row stock thresholds and preserve full matching summaries", () => {
  const f = fixtures(1000, 0);
  const selected = f.products[900]; selected.name = "Last-page literal %_ match"; selected.quantity = 9; selected.lowStockThreshold = 20;
  const response = productPage(f, params(`page=99&pageSize=12&search=%25_&category=${selected.categoryId}&supplier=${selected.supplierId}&stock=critical`));
  assert.deepEqual(response.data.map((row) => row.id), [selected.id]);
  assert.deepEqual(response.pagination, { page: 1, pageSize: 12, total: 1, pageCount: 1, hasNext: false, hasPrevious: false });
  assert.deepEqual(response.summary, { productCount: 1, totalQuantity: 9, lowStockCount: 1, criticalStockCount: 1, outOfStockCount: 0, inventoryValue: 9 * selected.price });
  const first = productPage(f, params("page=1&pageSize=12"));
  const last = productPage(f, params("page=999&pageSize=12"));
  assert.equal(last.pagination.page, 84); assert.equal(last.data.length, 4); assert.equal(last.data.at(-1).id, 1000);
  assert.deepEqual(first.summary, last.summary);
  assert.deepEqual(first.summary, productPage(f, params("page=1&pageSize=100")).summary);
  for (const stock of ["low", "critical", "out", "in"]) {
    const response = productPage(f, params(`page=1&pageSize=100&stock=${stock}`));
    assert.ok(response.data.every((row) => stock === "low" ? row.quantity <= row.lowStockThreshold : stock === "critical" ? row.quantity <= Math.floor(row.lowStockThreshold / 2) : stock === "out" ? row.quantity === 0 : row.quantity > row.lowStockThreshold));
  }
});

test("empty and tied product pages have deterministic identities, bounded text and no nested contact data", () => {
  const f = fixtures(5, 0);
  f.products.reverse();
  for (const row of f.products) { row.name = "x".repeat(1000); row.sku = "s".repeat(1000); row.owner = { password: "PRIVATE_PASSWORD" }; }
  const ascending = productPage(f, params("page=1&pageSize=3&sortBy=name"));
  const descending = productPage(f, params("page=1&pageSize=3&sortBy=name&sortOrder=desc"));
  assert.deepEqual(ascending.data.map((row) => row.id), [1, 2, 3]);
  assert.deepEqual(descending.data.map((row) => row.id), [5, 4, 3]);
  assert.equal(ascending.data[0].name.length, 256); assert.equal(ascending.data[0].sku.length, 128);
  assert.deepEqual(ascending.data[0].truncatedFields, ["name", "sku"]);
  assert.doesNotMatch(JSON.stringify(ascending), /description|PRIVATE|owner|supplier":/);
  const empty = productPage(f, params("page=99&search=missing"));
  assert.deepEqual(empty.data, []); assert.equal(empty.pagination.page, 1); assert.equal(empty.pagination.pageCount, 1); assert.equal(empty.pagination.total, 0);
});

test("supplier order headers and summaries use only owned lines and an independent mixed-owner flag", () => {
  const f = fixtures(44, 44);
  f.orders[0].customer = { ...f.orders[0].customer, name: "n".repeat(1000), email: "e".repeat(1000), password: "PRIVATE_PASSWORD", passwordHash: "PRIVATE_HASH", address: "PRIVATE_ADDRESS" };
  f.orders[0].orderItems[1].product.name = "FOREIGN_PRODUCT";
  const response = orderPage(f, params("page=1&pageSize=1&search=%231"), supplier);
  assert.equal(response.data[0].id, 1);
  const first = response.data[0];
  assert.equal(first.amountScope, "SUPPLIER_ITEMS"); assert.equal(first.hasOtherSuppliers, true); assert.equal(first.visibleLineCount, 1); assert.equal(first.visibleUnits, 2);
  assert.equal(first.visibleAmount, f.orders[0].orderItems[0].price * 2);
  assert.notEqual(first.visibleAmount, f.orders[0].totalAmount);
  assert.equal(first.customer.name.length, 256); assert.equal(first.customer.email.length, 254);
  assert.deepEqual(first.customer.truncatedFields, ["name", "email"]);
  assert.doesNotMatch(JSON.stringify(response), /orderItems|productId|FOREIGN|PRIVATE|password|address|totalAmount/);
  const visible = f.orders.filter((order) => order.orderItems.some((line) => line.product.supplierId === 1));
  const all = orderPage(f, params("page=1&pageSize=1"), supplier);
  assert.equal(all.summary.orderCount, visible.length);
  assert.equal(all.summary.visibleAmount, visible.reduce((sum, order) => sum + order.orderItems.filter((line) => line.product.supplierId === 1).reduce((value, line) => value + line.price * line.quantity, 0), 0));
  assert.deepEqual(all.summary, orderPage(f, params("page=2&pageSize=100"), supplier).summary);
  const detail = orderDetail(f, 1, supplier);
  assert.equal(detail.orderItems.length, 1); assert.equal(detail.hasOtherSuppliers, true); assert.equal(detail.totalAmount, first.visibleAmount);
  assert.doesNotMatch(JSON.stringify(detail), /PRIVATE|FOREIGN|password|address/);
});

test("scope precedes order search/status/count, with stable date ties and no caller-selected owner", () => {
  const f = fixtures(44, 10);
  for (const order of f.orders) order.createdAt = "2026-01-01T00:00:00.000Z";
  f.orders[9].customerId = 999; f.orders[9].customer = { id: 999, name: "Foreign person", email: "foreign@example.test" };
  const own = orderPage(f, params("page=1&pageSize=20"), customer);
  assert.equal(own.pagination.total, 9); assert.deepEqual(own.data.map((row) => row.id), [9, 8, 7, 6, 5, 4, 3, 2, 1]);
  assert.equal(orderPage(f, params("page=1&search=%2310"), customer).pagination.total, 0);
  assert.equal(orderPage(f, params("page=1&search=Foreign"), customer).pagination.total, 0);
  assert.equal(orderPage(f, params("page=1&search=Foreign"), admin).pagination.total, 1);
  const pending = orderPage(f, params("page=99&pageSize=1&status=PENDING"), customer);
  assert.equal(pending.pagination.total, 2); assert.equal(pending.pagination.page, 2);
  assert.equal(pending.summary.statusCounts.PENDING, 2); assert.equal(pending.summary.orderCount, 2);
  assert.equal(pending.summary.visibleAmount, f.orders.filter((row) => row.customerId === 1 && row.status === "PENDING").reduce((sum, row) => sum + row.totalAmount, 0));
  failure(() => orderDetail(f, 10, customer), 404);
});

test("page payloads and fixed-key summaries remain bounded as total catalog and history grow", () => {
  const small = fixtures(100, 100); const large = fixtures(10000, 10000);
  for (const run of [(f) => productPage(f, params("page=1&pageSize=20")), (f) => orderPage(f, params("page=1&pageSize=20"), admin)]) {
    const before = run(small), after = run(large);
    assert.deepEqual(before.data, after.data);
    assert.deepEqual(Object.keys(before.summary), Object.keys(after.summary));
    assert.ok(Buffer.byteLength(JSON.stringify(after)) - Buffer.byteLength(JSON.stringify(before)) < 256);
    assert.equal(after.pagination.total, 10000);
  }
  const f = fixtures(44, 1); const line = f.orders[0].orderItems[0];
  f.orders[0].orderItems = Array.from({ length: 10000 }, (_, index) => ({ ...line, id: index + 1 }));
  const response = orderPage(f, params("page=1"), supplier);
  assert.equal(response.data[0].visibleLineCount, 10000); assert.ok(JSON.stringify(response).length < 1500);
});

test("bounded directory views aggregate every product/order before grouping, searching and paging", () => {
  const f = fixtures(1000, 1000);
  const response = supplierPage(f, params("page=2&pageSize=1&includeProductCounts=true"));
  assert.equal(response.pagination.total, 4); assert.equal(response.data.length, 1); assert.equal(response.data[0].productCount, 250);
  f.orders[999].customerId = 999; f.orders[999].customer = { id: 999, name: "Another customer", email: "another@example.test", password: "PRIVATE" };
  const grouped = orderPage(f, params("page=1&pageSize=1&view=customers"), admin);
  assert.equal(grouped.pagination.total, 2); assert.equal(grouped.data[0].id, 999); assert.equal(grouped.data[0].orderCount, 1);
  const second = orderPage(f, params("page=2&pageSize=1&view=customers"), admin);
  assert.equal(second.data[0].id, 1); assert.equal(second.data[0].orderCount, 999);
  assert.deepEqual(grouped.summary, { customerCount: 2, totalSpending: f.orders.reduce((sum, row) => sum + row.totalAmount, 0) });
  assert.equal(second.data[0].totalSpending, f.orders.slice(0, 999).reduce((sum, row) => sum + row.totalAmount, 0));
  const searched = orderPage(f, params("page=99&view=customers&search=Another"), admin);
  assert.equal(searched.pagination.total, 1); assert.equal(searched.data[0].id, 999); assert.equal(searched.data[0].orderCount, 1);
  assert.doesNotMatch(JSON.stringify(grouped), /PRIVATE|orderItems|password/);
  failure(() => orderPage(f, params("page=1&view=customers"), customer), 403);
  failure(() => orderPage(f, params("page=1&view=customers&status=PENDING"), admin));
  failure(() => orderPage(f, params("view=customers"), admin));
});
