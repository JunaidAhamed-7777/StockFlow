const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const readQuery = require('./readQuery');

// Load only the controller with in-memory service boundaries: no Prisma client or API.
function controller(name, services) {
  const module = { exports: {} };
  const source = readFileSync(path.join(__dirname, '../controllers', `${name}.controller.js`), 'utf8');
  const injectedRequire = (id) => {
    if (id === '../services/readQuery') return readQuery;
    if (id.endsWith('Service')) return services;
    if (id === '../middleware/authorize') return {};
    throw new Error(`Unexpected dependency ${id}`);
  };
  new Function('require', 'module', 'exports', source)(injectedRequire, module, module.exports);
  return module.exports;
}

async function invoke(handler, query, user) {
  const result = { status: 200 };
  const res = { status: (code) => { result.status = code; return res; }, json: (body) => { result.body = body; } };
  await handler({ query, user }, res, (error) => { result.error = error; });
  return result;
}

test('public product controller opts in explicitly and leaves legacy filters/array envelope intact', async () => {
  const legacy = [{ id: 1, description: 'Full legacy field' }];
  const paged = { success: true, data: [{ id: 2 }], pagination: { total: 44 }, summary: { productCount: 44 } };
  const calls = [];
  const api = controller('product', {
    getAll: async (query) => { calls.push(['legacy', query]); return legacy; },
    getProductPage: async (query) => { calls.push(['page', query]); return paged; },
  });
  const result = await invoke(api.listProducts, { search: 'unchanged', category: '2', supplier: '3', lowStock: 'true', lowStockThreshold: '4' });
  assert.deepEqual(result.body, { success: true, data: legacy });
  assert.deepEqual(calls[0], ['legacy', { search: 'unchanged', categoryId: 2, supplierId: 3, lowStock: true, lowStockThreshold: 4 }]);
  const query = { page: '1', pageSize: '12' };
  assert.equal((await invoke(api.listProducts, query)).body, paged); assert.equal(calls[1][1], query);
  assert.equal((await invoke(api.listProducts, { 'page[]': '1' })).error.status, 400); assert.equal(calls.length, 2);
});

test('order controllers preserve unpaged role routing and reject unpaged grouped views', async () => {
  const legacy = [{ id: 1, orderItems: [{ id: 2 }], totalAmount: 40 }];
  const calls = [];
  const service = (name) => async (id) => { calls.push([name, id]); return legacy; };
  const paged = { success: true, data: [], pagination: { total: 0 }, summary: { orderCount: 0 } };
  const api = controller('order', {
    getOrdersByUser: service('customer'), getOrdersForSupplier: service('supplier'), getAllOrders: service('admin'),
    getOrderPage: async (query, user) => { calls.push(['page', query, user]); return paged; },
  });
  for (const [user, handler] of [[{ role: 'CUSTOMER', id: 7 }, api.listOrders], [{ role: 'SUPPLIER', id: 8, supplierId: 9 }, api.listOrders], [{ role: 'ADMIN', id: 3 }, api.listAllOrders]]) {
    assert.deepEqual((await invoke(handler, {}, user)).body, { success: true, data: legacy });
    const query = { page: '1' };
    assert.equal((await invoke(handler, query, user)).body, paged);
    assert.deepEqual(calls.at(-1), ['page', query, user]);
    assert.equal((await invoke(handler, { view: 'customers' }, user)).error.status, 400);
    assert.equal((await invoke(handler, { 'pageSize[]': '20' }, user)).error.status, 400);
  }
  assert.deepEqual(calls.filter(([name]) => name !== 'page'), [['customer', 7], ['supplier', 9], ['admin', undefined]]);
  const missing = await invoke(api.listOrders, {}, { role: 'SUPPLIER', id: 8 });
  assert.equal(missing.status, 404); assert.equal(missing.body.success, false);
});

test('public supplier controller retains legacy discovery and requires page for aggregate opt-in', async () => {
  let legacyCalls = 0, pageCalls = 0;
  const legacy = [{ id: 1, address: 'Unchanged legacy address', user: { role: 'SUPPLIER' } }];
  const paged = { success: true, data: [], pagination: { total: 0 }, summary: { supplierCount: 0 } };
  const api = controller('discovery', { getSuppliers: async () => { legacyCalls++; return legacy; }, getSupplierPage: async () => { pageCalls++; return paged; } });
  assert.deepEqual((await invoke(api.suppliersController, {})).body, { success: true, data: legacy });
  assert.equal((await invoke(api.suppliersController, { page: '1', includeProductCounts: 'true' })).body, paged);
  assert.equal((await invoke(api.suppliersController, { includeProductCounts: 'true' })).error.status, 400);
  assert.equal((await invoke(api.suppliersController, { 'page[x]': '1' })).error.status, 400);
  assert.equal(legacyCalls, 1); assert.equal(pageCalls, 1);
});
