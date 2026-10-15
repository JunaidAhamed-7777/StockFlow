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
