const test = require('node:test');
const assert = require('node:assert/strict');
const { createPagedReads } = require('./pagedReadService');

function fixtureClient(results, extra = {}) {
  const queries = [], transactions = [];
  const tx = { $queryRaw: async (query) => { queries.push(query); assert.ok(results.length, 'Unexpected database read'); return results.shift(); }, ...extra };
  return {
    queries, transactions,
    $transaction: async (operation, options) => { transactions.push(options); return operation(tx); },
  };
}

test('product pages use one repeatable snapshot for identical filtered aggregates and bounded projection', async () => {
  const summary = { productCount: 44, totalQuantity: 220, lowStockCount: 20, criticalStockCount: 10, outOfStockCount: 2, inventoryValue: 800 };
  const rows = [{ id: 44, name: 'Display', sku: 'SKU', price: 2, quantity: 5, lowStockThreshold: 10, categoryId: 2, supplierId: 3, truncatedFields: [] }];
  const db = fixtureClient([[summary], rows]);
  const response = await createPagedReads(db).getProductPage({ page: '999', pageSize: '20', category: '2', supplier: '3', search: "  literal%_' OR TRUE --  ", stock: 'critical', sortBy: 'name', sortOrder: 'desc' });
  assert.deepEqual(response.data, rows); assert.deepEqual(response.summary, summary);
  assert.equal(response.pagination.page, 3); assert.equal(response.pagination.total, 44);
  assert.deepEqual(db.transactions, [{ isolationLevel: 'RepeatableRead' }]);
  assert.equal(db.queries.length, 2);
  const [aggregate, page] = db.queries;
  assert.match(aggregate.text, /SUM\(p.quantity \* p.price\)/);
  assert.match(aggregate.text, /FLOOR\(p\."lowStockThreshold" \* 0.5\)/);
  assert.equal(aggregate.text.split('WHERE ').at(-1), page.text.split('WHERE ')[1].split('ORDER BY')[0].trimEnd());
  assert.doesNotMatch(page.text, /literal|OR TRUE|p\.description,/);
  assert.ok(page.values.includes("%literal\\%\\_' OR TRUE --%"));
  assert.match(page.text, /LEFT\(p.name, 256\)/); assert.match(page.text, /ORDER BY p.name DESC, p.id DESC/);
  assert.deepEqual(page.values.slice(-2), [20, 40]);
});

test('invalid product queries fail before a transaction; empty pages retain fixed summaries', async () => {
  const db = fixtureClient([]);
  for (const query of [{ page: '1', category: '0' }, { page: '1', stock: 'constructor' }, { page: '1', lowStock: 'true' }, { page: '1', supplier: ['1', '2'] }]) {
    await assert.rejects(createPagedReads(db).getProductPage(query), { status: 400 });
  }
  assert.equal(db.transactions.length, 0);
  const summary = { productCount: 0, totalQuantity: 0, lowStockCount: 0, criticalStockCount: 0, outOfStockCount: 0, inventoryValue: 0 };
  const empty = fixtureClient([[summary], []]);
  const result = await createPagedReads(empty).getProductPage({ page: '99', stock: 'in' });
  assert.deepEqual(result.data, []); assert.equal(result.pagination.page, 1);
  assert.ok(empty.queries.every((query) => query.text.includes('p.quantity > p."lowStockThreshold"')));
});

const admin = { role: 'ADMIN', id: 3 };
const customer = { role: 'CUSTOMER', id: 7 };
const supplier = { role: 'SUPPLIER', id: 8, supplierId: 9 };
const orderSummary = { orderCount: 1, statusCounts: { PENDING: 1, PROCESSING: 0, SHIPPED: 0, DELIVERED: 0, CANCELLED: 0 }, visibleLineCount: 2, visibleUnits: 5, visibleAmount: 12 };
const header = { id: 41, customerId: 7, status: 'PENDING', createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01'), customer: { id: 7, name: 'Customer', email: 'customer@example.test', truncatedFields: [] }, _totalAmount: 99 };

test('supplier pages aggregate only verified owned lines and expose an independent mixed-owner flag', async () => {
  const profileReads = [];
  const db = fixtureClient([[orderSummary], [{ ...header, _totalAmount: null, hasOtherSuppliers: true }], [{ orderId: 41, visibleLineCount: 2, visibleUnits: 5, amount: 12 }]], {
    supplier: { findUnique: async (args) => { profileReads.push(args); return { userId: 8 }; } },
  });
  const result = await createPagedReads(db).getOrderPage({ page: '999', search: '#4%_', status: 'PENDING' }, supplier);
  assert.deepEqual(profileReads, [{ where: { id: 9 }, select: { userId: true } }]);
  assert.deepEqual(result.data[0], { ...(({ _totalAmount, ...row }) => row)(header), hasOtherSuppliers: true, visibleLineCount: 2, visibleUnits: 5, visibleAmount: 12, amountScope: 'SUPPLIER_ITEMS' });
  assert.doesNotMatch(JSON.stringify(result), /_totalAmount|totalAmount|orderItems|productId|password/);
  assert.deepEqual(result.summary, orderSummary); assert.equal(result.pagination.page, 1);
  assert.equal(db.queries.length, 3); assert.deepEqual(db.transactions, [{ isolationLevel: 'RepeatableRead' }]);
  const [summary, page, lines] = db.queries;
  assert.match(summary.text, /JOIN matching m ON m.id = i\."orderId" WHERE p\."supplierId" = \$/);
  assert.match(summary.text, /SUM\(lines.amount\)/); assert.doesNotMatch(summary.text, /SUM\(m\."totalAmount"\)/);
  assert.match(page.text, /NULL::double precision AS "_totalAmount"/);
  assert.match(page.text, /foreign_product\."supplierId" <> \$/);
  assert.match(page.text, /ORDER BY o\."createdAt" DESC, o.id DESC/);
  assert.ok(summary.values.includes('%4\\%\\_%')); assert.ok(page.values.includes('%4\\%\\_%'));
  assert.match(lines.text, /i\."orderId" IN \(\$1\) AND p\."supplierId" = \$2/);
  assert.deepEqual(lines.values, [41, 9]);
});

test('customer filtering precedes database count/page and does not search other customer labels', async () => {
  const db = fixtureClient([[orderSummary], [header], [{ orderId: 41, visibleLineCount: 2, visibleUnits: 5, amount: 12 }]]);
  const result = await createPagedReads(db).getOrderPage({ page: '1', search: '#41' }, customer);
  assert.equal(result.data[0].visibleAmount, 99); assert.equal(result.data[0].amountScope, 'ORDER');
  assert.equal(result.data[0].hasOtherSuppliers, undefined);
  for (const query of db.queries.slice(0, 2)) {
    assert.match(query.text, /o\."customerId" = \$/);
    assert.match(query.text, /CAST\(o.id AS text\) ILIKE \$/);
    assert.doesNotMatch(query.text, /c.name ILIKE|c.email ILIKE/);
    assert.ok(query.values.includes(7));
  }
  assert.match(db.queries[0].text, /SUM\(m\."totalAmount"\)/);
  assert.match(db.queries[1].text, /LEFT\(c.name, 256\)/);
  assert.doesNotMatch(db.queries[1].text, /c.password|c.address|SELECT \*/);
});

test('invalid/missing supplier identities and malformed order filters fail without broad reads', async () => {
  const db = fixtureClient([]);
  const reads = createPagedReads(db);
  for (const user of [null, { role: 'OTHER', id: 1 }, { role: 'CUSTOMER' }]) await assert.rejects(reads.getOrderPage({ page: '1' }, user), { status: 401 });
  await assert.rejects(reads.getOrderPage({ page: '1' }, { role: 'SUPPLIER', id: 8 }), { status: 404 });
  for (const query of [{ page: '1', customerId: '8' }, { page: '1', supplier: '10' }, { page: '1', status: '' }, { page: '1', status: 'UNKNOWN' }, { page: '1', sortBy: 'totalAmount' }, { page: '1', view: ['customers', 'customers'] }]) await assert.rejects(reads.getOrderPage(query, admin), { status: 400 });
  assert.equal(db.transactions.length, 0);
  for (const profile of [null, { userId: 99 }]) {
    const unowned = fixtureClient([], { supplier: { findUnique: async () => profile } });
    await assert.rejects(createPagedReads(unowned).getOrderPage({ page: '1' }, supplier), { status: 404 });
    assert.equal(unowned.queries.length, 0);
  }
});

test('empty order scope skips line reads and customer directory groups lifetime orders before search', async () => {
  const emptySummary = { ...orderSummary, orderCount: 0, visibleLineCount: 0, visibleUnits: 0, visibleAmount: 0, statusCounts: Object.fromEntries(Object.keys(orderSummary.statusCounts).map((key) => [key, 0])) };
  const empty = fixtureClient([[emptySummary], []]);
  const result = await createPagedReads(empty).getOrderPage({ page: '99' }, admin);
  assert.deepEqual(result.data, []); assert.equal(result.pagination.page, 1); assert.equal(empty.queries.length, 2);
  const groupedRow = { id: 7, name: 'Customer', email: 'customer@example.test', orderCount: 1000, totalSpending: 5000, lastOrderAt: new Date('2026-01-01'), truncatedFields: [] };
  const grouped = fixtureClient([[{ customerCount: 1, totalSpending: 5000 }], [groupedRow]]);
  const directory = await createPagedReads(grouped).getOrderPage({ page: '9', view: 'customers', search: ' Customer ' }, admin);
  assert.deepEqual(directory.data, [groupedRow]); assert.equal(directory.summary.totalSpending, 5000);
  for (const query of grouped.queries) {
    assert.ok(query.text.indexOf('GROUP BY c.id') < query.text.indexOf('g.name ILIKE'));
    assert.ok(query.values.includes('%Customer%'));
  }
  assert.match(grouped.queries[1].text, /ORDER BY g.name ASC, g.id ASC/);
  const denied = fixtureClient([]);
  await assert.rejects(createPagedReads(denied).getOrderPage({ page: '1', view: 'customers' }, customer), { status: 403 });
  await assert.rejects(createPagedReads(denied).getOrderPage({ page: '1', view: 'customers', status: 'PENDING' }, admin), { status: 400 });
  await assert.rejects(createPagedReads(denied).getOrderPage({ view: 'customers' }, admin), { status: 400 });
  assert.equal(denied.transactions.length, 0);
});

test('supplier detail never selects global amount, customer secrets or other supplier lines', async () => {
  const detailQueries = [];
  const itemQueries = [];
  const detail = { id: 41, customerId: 7, status: 'PENDING', createdAt: new Date(), updatedAt: new Date(), customer: { id: 7, name: 'n'.repeat(300), email: 'customer@example.test' }, orderItems: [{ id: 1, orderId: 41, productId: 2, quantity: 3, price: 4, product: { id: 2, name: 'Own', sku: 'OWN', supplierId: 9 } }] };
  const db = fixtureClient([], {
    supplier: { findUnique: async () => ({ userId: 8 }) },
    order: { findUnique: async (args) => { detailQueries.push(args); return detailQueries.length === 1 ? { customerId: 7 } : detail; } },
    orderItem: {
      findFirst: async (args) => { itemQueries.push(args); return { id: 1 }; },
      count: async (args) => { itemQueries.push(args); return 10000; },
    },
  });
  const result = await createPagedReads(db).getOrderDetail(41, supplier);
  assert.equal(result.totalAmount, 12); assert.equal(result.hasOtherSuppliers, true);
  assert.equal(result.customer.name.length, 256); assert.deepEqual(result.customer.truncatedFields, ['name']);
  assert.equal(detailQueries[1].select.totalAmount, false);
  assert.deepEqual(detailQueries[1].select.customer.select, { id: true, name: true, email: true });
  assert.deepEqual(detailQueries[1].select.orderItems.where, { product: { supplierId: 9 } });
  assert.deepEqual(detailQueries[1].select.orderItems.select.product.select, { id: true, name: true, sku: true, supplierId: true });
  assert.deepEqual(itemQueries[1], { where: { orderId: 41, product: { supplierId: { not: 9 } } } });
});

test('unauthorized detail stops before any line/customer projection', async () => {
  for (const [identity, status] of [[null, 404], [{ customerId: 99 }, 403]]) {
    let count = 0;
    const db = fixtureClient([], { order: { findUnique: async () => { count++; return identity; } } });
    await assert.rejects(createPagedReads(db).getOrderDetail(41, customer), { status });
    assert.equal(count, 1);
  }
  const db = fixtureClient([], { supplier: { findUnique: async () => ({ userId: 8 }) }, order: { findUnique: async () => ({ customerId: 7 }) }, orderItem: { findFirst: async () => null } });
  await assert.rejects(createPagedReads(db).getOrderDetail(41, supplier), { status: 403 });
  assert.equal(db.queries.length, 0);
});

test('supplier directory uses full filtered count and one product-count aggregate over page IDs', async () => {
  const rows = [{ id: 2, userId: 8, companyName: 'Display', contactNumber: '000', address: '', user: { id: 8, name: 'Supplier', email: 'supplier@example.test', truncatedFields: [] }, truncatedFields: [] }, { id: 3, userId: 9, companyName: 'Other', contactNumber: '001', address: '', user: { id: 9, name: 'Other', email: 'other@example.test', truncatedFields: [] }, truncatedFields: [] }];
  const db = fixtureClient([[{ supplierCount: 44 }], rows, [{ supplierId: 2, productCount: 10000 }]]);
  const result = await createPagedReads(db).getSupplierPage({ page: '2', pageSize: '2', search: ' %_ ', includeProductCounts: 'true', sortBy: 'companyName' });
  assert.equal(result.pagination.total, 44); assert.equal(result.pagination.page, 2);
  assert.equal(result.data[0].productCount, 10000); assert.equal(result.data[1].productCount, 0);
  assert.deepEqual(result.summary, { supplierCount: 44 });
  assert.deepEqual(db.transactions, [{ isolationLevel: 'RepeatableRead' }]);
  assert.match(db.queries[0].text, /s\."companyName" ILIKE/); assert.ok(db.queries[0].values.includes('%\\%\\_%'));
  assert.match(db.queries[1].text, /LEFT\(s.address, 512\)/); assert.match(db.queries[1].text, /ORDER BY s\."companyName" ASC, s.id ASC/);
  assert.doesNotMatch(db.queries[1].text, /c.password|SELECT \*/);
  assert.match(db.queries[2].text, /COUNT\(\*\)::int AS "productCount"/); assert.deepEqual(db.queries[2].values, [2, 3]);
});

test('supplier directory validates options before reads and omits unrequested aggregates', async () => {
  const db = fixtureClient([]);
  for (const query of [{ page: '1', includeProductCounts: '' }, { page: '1', includeProductCounts: 'false' }, { page: '1', includeProductCounts: ['true', 'true'] }, { page: '1', sortBy: 'userId' }]) await assert.rejects(createPagedReads(db).getSupplierPage(query), { status: 400 });
  assert.equal(db.transactions.length, 0);
  const plain = fixtureClient([[{ supplierCount: 1 }], [{ id: 1 }]]);
  const result = await createPagedReads(plain).getSupplierPage({ page: '1' });
  assert.equal(result.data[0].productCount, undefined); assert.equal(plain.queries.length, 2);
  const empty = fixtureClient([[{ supplierCount: 0 }], []]);
  assert.deepEqual((await createPagedReads(empty).getSupplierPage({ page: '99', includeProductCounts: 'true' })).data, []);
  assert.equal(empty.queries.length, 2);
});
