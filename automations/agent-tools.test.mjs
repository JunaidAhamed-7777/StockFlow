import test from 'node:test';
import assert from 'node:assert/strict';
import { projectRoleAgentContext } from './agent-tools.mjs';

const NOW = '2026-10-15T10:00:00.000Z';
const product = (overrides = {}) => ({ id: 11, name: 'Desk supplies', sku: 'DESK-11', price: 12.5, quantity: 5, lowStockThreshold: 10, supplierId: 1, categoryId: 2, ...overrides });
const order = (overrides = {}) => ({ id: 101, customerId: 20, status: 'PENDING', createdAt: NOW, totalAmount: 37.5, orderItems: [{ productId: 11, quantity: 3, price: 12.5 }], ...overrides });
const input = (role = 'ADMIN', overrides = {}) => ({
  role, identity: { id: role === 'SUPPLIER' ? 10 : role === 'CUSTOMER' ? 20 : 30, role, name: `${role} account`, email: `${role.toLowerCase()}@stockflow.local` },
  products: [product()], suppliers: [{ id: 1, userId: 10, companyName: 'Own supplier' }, { id: 3, userId: 31, companyName: 'Other supplier' }],
  categories: [{ id: 2, name: 'Stationery' }], orders: [order()], ...overrides,
});
const freeze = (value) => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};

test('role boundaries require authenticated exact role and a valid account identifier', () => {
  for (const role of ['ADMIN', 'SUPPLIER', 'CUSTOMER']) {
    assert.equal(projectRoleAgentContext(input(role)).role, role);
    assert.throws(() => projectRoleAgentContext(input(role, { identity: { ...input(role).identity, role: 'ATTACKER' } })), /configured agent role/);
    for (const id of [0, -1, 1.2, '10', null, Infinity, 2147483648]) assert.throws(() => projectRoleAgentContext(input(role, { identity: { ...input(role).identity, id } })), /configured agent role/);
  }
  for (const role of ['admin', '', 'OWNER', undefined]) assert.throws(() => projectRoleAgentContext({ ...input(), role }), /configured agent role/);
});

test('supplier profile lookup fails closed on missing, duplicate or ambiguous ownership', () => {
  assert.throws(() => projectRoleAgentContext(input('SUPPLIER', { suppliers: [] })), /exactly one/);
  assert.throws(() => projectRoleAgentContext(input('SUPPLIER', { suppliers: [{ id: 1, userId: 10 }, { id: 2, userId: 10 }] })), /exactly one/);
  assert.throws(() => projectRoleAgentContext(input('SUPPLIER', { suppliers: [{ id: 1, userId: 10 }, { id: 1, userId: 11 }] })), /ambiguous/);
  assert.throws(() => projectRoleAgentContext(input('SUPPLIER', { suppliers: [{ id: '1', userId: 10 }] })), /exactly one/);
});

test('supplier independently filters ownership even if upstream API ignores its filter', () => {
  const result = projectRoleAgentContext(input('SUPPLIER', {
    products: [product(), product({ id: 12, supplierId: 3, name: 'OTHER_OWNER_MARKER', categoryId: 4 })],
    categories: [{ id: 2, name: 'Stationery' }, { id: 4, name: 'OTHER_CATEGORY_MARKER' }],
    orders: [order({ totalAmount: 999999, orderItems: [{ productId: 11, quantity: 3, price: 12.5 }, { productId: 12, quantity: 1, price: 999, product: { name: 'OTHER_OWNER_MARKER', supplierId: 3 } }] }), order({ id: 102, orderItems: [{ productId: 12, quantity: 1, price: 999 }] })],
  }));
  assert.equal(result.account.supplierId, 1);
  assert.equal(result.catalog.totalCount, 1);
  assert.equal(result.inventory.totalUnits, 5);
  assert.equal(result.orders.totalCount, 1);
  assert.equal(result.orders.items[0].supplierSubtotal, 37.5);
  assert.equal(result.orders.items[0].totalAmount, undefined);
  assert.equal(result.orders.items[0].customerId, undefined);
  assert.equal(result.suppliers, undefined);
  assert.equal(result.categories.totalCount, 1);
  assert.doesNotMatch(JSON.stringify(result), /OTHER_OWNER_MARKER|OTHER_CATEGORY_MARKER|999999/);
});

test('customer sees only own orders even when upstream order response is unscoped', () => {
  const result = projectRoleAgentContext(input('CUSTOMER', { orders: [order(), order({ id: 202, customerId: 21, totalAmount: 7654321, customer: { email: 'other.customer@private.local' } })] }));
  assert.equal(result.orders.totalCount, 1);
  assert.equal(result.orders.items[0].customerId, 20);
  assert.equal(result.reorderDraft.totalCount, 1);
  assert.equal(result.inventory.replenishmentDraft, undefined);
  assert.doesNotMatch(JSON.stringify(result), /7654321|other.customer/);
});

test('only explicit safe fields reach model context; nested credentials and contact details are discarded', () => {
  const secret = 'NEVER_EXPOSE_THIS_SECRET';
  const fixture = input('ADMIN', {
    identity: { ...input().identity, password: secret, token: secret, Supplier: { key: secret } },
    products: [product({ description: secret, password: secret, supplier: { user: { email: secret, password: secret } } })],
    suppliers: [{ id: 1, userId: 10, companyName: 'Supplier', user: { name: secret, email: secret, password: secret }, contactNumber: secret, address: secret }],
    categories: [{ id: 2, name: 'Stationery', description: secret }],
    orders: [order({ password: secret, customer: { name: secret, email: secret, password: secret }, orderItems: [{ productId: 11, quantity: 3, price: 12.5, token: secret, product: product({ description: secret }) }] })],
    dashboard: { role: 'ADMIN', metrics: { totalProducts: 1, token: secret, password: secret } },
  });
  const result = projectRoleAgentContext(fixture);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(secret));
  assert.deepEqual(result.account, { id: 30, name: 'ADMIN account', email: 'admin@stockflow.local', role: 'ADMIN' });
  assert.deepEqual(result.suppliers.items[0], { id: 1, companyName: 'Supplier', productCount: 1, totalUnits: 5, lowStockCount: 1 });
});

test('source markup, links, control and bidirectional characters are removed from projected text', () => {
  const result = projectRoleAgentContext(input('ADMIN', {
    identity: { ...input().identity, name: '<b>Admin</b>\u202e\nName' },
    products: [product({ name: '<script>steal()</script><b>Desk</b>\nhttps://malicious.test/a', sku: 'DESK\u0000\u2066-11' })],
    suppliers: [{ id: 1, userId: 10, companyName: '<img src=x>Owner www.bad.test/evil' }],
    categories: [{ id: 2, name: '<em>Stationery</em>' }],
  }));
  assert.equal(result.account.name, 'Admin Name');
  assert.equal(result.catalog.items[0].name, 'Desk [link omitted]');
  assert.equal(result.catalog.items[0].sku, 'DESK -11');
  assert.doesNotMatch(JSON.stringify(result), /<|>|steal\(\)|https:\/\/malicious|www\.bad/);
});

test('search is literal bounded text, cannot select URLs, and cannot evaluate expressions', () => {
  assert.equal(projectRoleAgentContext(input('ADMIN', { search: '<b>desk</b>\n' })).catalog.matchedCount, 1);
  assert.equal(projectRoleAgentContext(input('ADMIN', { search: '.*' })).catalog.matchedCount, 0);
  assert.equal(projectRoleAgentContext(input('ADMIN', { search: "'); process.exit(); //" })).catalog.matchedCount, 0);
  for (const search of [1, {}, [], null, 'x'.repeat(121)]) assert.throws(() => projectRoleAgentContext(input('ADMIN', { search })), /search/);
  for (const search of ['https://private.test', 'www.site.test/path']) assert.throws(() => projectRoleAgentContext(input('ADMIN', { search })), /not a URL/);
  assert.equal(projectRoleAgentContext(input('ADMIN', { search: 'does not exist' })).catalog.totalCount, 1);
});

test('numbers are strict, finite, nonnegative and bounded, without implicit coercion', () => {
  for (const field of ['quantity', 'lowStockThreshold']) {
    for (const value of [-1, 0.5, '4', NaN, Infinity, 1000000001]) assert.throws(() => projectRoleAgentContext(input('ADMIN', { products: [product({ [field]: value })] })), /Invalid/);
  }
  for (const price of [-1, '3', NaN, Infinity, 1000000001]) assert.throws(() => projectRoleAgentContext(input('ADMIN', { products: [product({ price })] })), /Invalid product price/);
  for (const quantity of [0, -1, 0.1, '3', Infinity]) assert.throws(() => projectRoleAgentContext(input('ADMIN', { orders: [order({ orderItems: [{ productId: 11, quantity, price: 1 }] })] })), /Invalid order quantity/);
  assert.throws(() => projectRoleAgentContext(input('ADMIN', { orders: [order({ totalAmount: -1 })] })), /Invalid order total/);
  assert.throws(() => projectRoleAgentContext(input('ADMIN', { orders: [order({ orderItems: [{ productId: 11, quantity: 1000000000, price: 1000000000 }] })] })), /Invalid order line total/);
});

test('inventory classification uses each product threshold and zero-stock is critical even at threshold zero', () => {
  const result = projectRoleAgentContext(input('ADMIN', { orders: [], products: [product({ quantity: 5, lowStockThreshold: 10 }), product({ id: 12, quantity: 8, lowStockThreshold: 10 }), product({ id: 13, quantity: 6, lowStockThreshold: 2 }), product({ id: 14, quantity: 0, lowStockThreshold: 0 })] }));
  assert.deepEqual(result.catalog.items.map((row) => row.stockStatus), ['CRITICAL', 'LOW', 'IN_STOCK', 'OUT_OF_STOCK']);
  assert.equal(result.inventory.lowStockCount, 3);
  assert.equal(result.inventory.criticalStockCount, 2);
  assert.equal(result.inventory.outOfStockCount, 1);
  assert.equal(result.inventory.replenishmentDraft.items[0].proposedUnits, 1);
  assert.match(result.inventory.replenishmentDraft.basis, /No purchase or stock change/);
});

test('bounded catalog and orders report complete totals and explicit truncation', () => {
  const products = Array.from({ length: 45 }, (_, index) => product({ id: index + 1 }));
  const orders = Array.from({ length: 30 }, (_, index) => order({ id: index + 1, orderItems: [{ productId: 1, quantity: 1, price: 1 }] }));
  const result = projectRoleAgentContext(input('ADMIN', { products, orders }));
  assert.equal(result.catalog.totalCount, 45);
  assert.equal(result.catalog.matchedCount, 45);
  assert.equal(result.catalog.returnedCount, 40);
  assert.equal(result.catalog.truncatedCount, 5);
  assert.equal(result.orders.totalCount, 30);
  assert.equal(result.orders.returnedCount, 25);
  assert.equal(result.orders.truncatedCount, 5);
  assert.equal(result.orders.statusCounts.PENDING, 30);
  assert.equal(result.inventory.productCount, 45);
});

test('large mult-line datasets remain within serialized output budget with truthful row counts', () => {
  const products = Array.from({ length: 100 }, (_, index) => product({ id: index + 1, name: 'N'.repeat(100), sku: 'S'.repeat(60) }));
  const orders = Array.from({ length: 100 }, (_, index) => order({ id: index + 1, orderItems: products.map((row) => ({ productId: row.id, quantity: 1, price: 1 })) }));
  const result = projectRoleAgentContext(input('ADMIN', { products, orders }));
  assert.ok(JSON.stringify(result).length <= 30000);
  for (const section of [result.catalog, result.orders, result.inventory.replenishmentDraft, result.categories, result.suppliers]) {
    assert.equal(section.returnedCount, section.items.length);
    assert.equal(section.returnedCount + section.truncatedCount, section.totalCount);
  }
  for (const row of result.orders.items) assert.equal(row.items.returnedCount + row.items.truncatedCount, 100);
});

test('supplier totals include all own lines even when line projection is truncated', () => {
  const products = Array.from({ length: 25 }, (_, index) => product({ id: index + 1 }));
  const result = projectRoleAgentContext(input('SUPPLIER', { products, orders: [order({ totalAmount: 999999, orderItems: products.map((row) => ({ productId: row.id, quantity: 1, price: 2 })) })] }));
  assert.equal(result.orders.items[0].supplierSubtotal, 50);
  assert.equal(result.orders.items[0].items.returnedCount, 20);
  assert.equal(result.orders.items[0].items.truncatedCount, 5);
  assert.doesNotMatch(JSON.stringify(result), /999999/);
});

test('reorder drafts use only most recent non-cancelled own orders and available stock', () => {
  const result = projectRoleAgentContext(input('CUSTOMER', {
    products: [product({ quantity: 2 }), product({ id: 12, quantity: 0 })],
    orders: [order({ id: 1, createdAt: '2026-10-13T00:00:00Z', orderItems: [{ productId: 11, quantity: 1, price: 10 }] }), order({ id: 2, createdAt: '2026-10-14T00:00:00Z', orderItems: [{ productId: 11, quantity: 5, price: 10 }, { productId: 12, quantity: 1, price: 10 }] }), order({ id: 3, status: 'CANCELLED', orderItems: [{ productId: 11, quantity: 9, price: 10 }] }), order({ id: 4, customerId: 99, orderItems: [{ productId: 11, quantity: 99, price: 10 }] })],
  }));
  assert.equal(result.reorderDraft.totalCount, 1);
  assert.deepEqual(result.reorderDraft.items[0], { productId: 11, name: 'Desk supplies', sku: 'DESK-11', previousOrderId: 2, lastOrderedQuantity: 5, suggestedQuantity: 2, availableQuantity: 2, unitPrice: 12.5, estimatedTotal: 25 });
  assert.match(result.reorderDraft.basis, /No order was placed/);
});

test('dashboard is role checked, field allowlisted, and supplier/customer counts are recomputed from scope', () => {
  assert.throws(() => projectRoleAgentContext(input('CUSTOMER', { dashboard: { role: 'ADMIN', metrics: {} } })), /Dashboard account role/);
  const customer = projectRoleAgentContext(input('CUSTOMER', { dashboard: { role: 'CUSTOMER', metrics: { orderCount: 999, pendingOrders: 999, deliveredOrders: 999, totalSpending: 999, password: 'secret' } } }));
  assert.deepEqual(customer.dashboard, { orderCount: 1, pendingOrders: 1, deliveredOrders: 0, totalSpending: 37.5 });
  const supplier = projectRoleAgentContext(input('SUPPLIER', { dashboard: { role: 'SUPPLIER', metrics: { productCount: 999, stock: 999, lowStock: 999, totalCustomers: 999 } } }));
  assert.deepEqual(supplier.dashboard, { productCount: 1, stock: 5, lowStock: 1 });
  const admin = projectRoleAgentContext(input('ADMIN', { dashboard: { role: 'ADMIN', metrics: { lowStockProducts: 999, totalProducts: 1 } } }));
  assert.equal(admin.dashboard.lowStockProducts, 1);
});

test('duplicate and conflicting identifiers fail closed before producing context', () => {
  assert.throws(() => projectRoleAgentContext(input('ADMIN', { products: [product(), product()] })), /ambiguous product/);
  assert.throws(() => projectRoleAgentContext(input('ADMIN', { orders: [order(), order()] })), /ambiguous order/);
  assert.throws(() => projectRoleAgentContext(input('ADMIN', { categories: [{ id: 2 }, { id: 2 }] })), /ambiguous category/);
  assert.throws(() => projectRoleAgentContext(input('ADMIN', { orders: [order({ orderItems: [{ productId: 11, quantity: 1, price: 1, product: { id: 11, supplierId: 3 } }] })] })), /ownership does not match/);
  assert.throws(() => projectRoleAgentContext(input('ADMIN', { products: [product({ categoryId: 999 })] })), /Unknown product category/);
});

test('invalid response collections, dates and account email fail without exposing values', () => {
  assert.throws(() => projectRoleAgentContext(null), /Invalid agent context/);
  for (const key of ['products', 'suppliers', 'orders', 'categories']) {
    for (const value of [null, {}, 'not-an-array', Array(10001).fill(null)]) assert.throws(() => projectRoleAgentContext(input('ADMIN', { [key]: value })), /Invalid or excessive/);
  }
  assert.throws(() => projectRoleAgentContext(input('ADMIN', { orders: [order({ createdAt: 'javascript:alert(1)' })] })), /Invalid order date/);
  for (const email of ['secret', '<secret>@example.local', 'bad\u202e@example.local']) {
    assert.throws(() => projectRoleAgentContext(input('ADMIN', { identity: { ...input().identity, email } })), (error) => error.message === 'Invalid authenticated account email.');
  }
});

test('projection never mutates its input, including source ordering and deeply nested records', () => {
  const fixture = freeze(input('CUSTOMER', { products: [product({ id: 12 }), product()], orders: [order({ id: 2 }), order({ id: 1 })] }));
  const before = JSON.stringify(fixture);
  const result = projectRoleAgentContext(fixture);
  assert.equal(JSON.stringify(fixture), before);
  assert.notEqual(result.catalog.items[0], fixture.products[1]);
  assert.equal(result.access, 'read-only');
  assert.equal(Object.hasOwn(result, 'token'), false);
});

test('function is self-contained when serialized into an n8n Code node and performs no fetches', () => {
  const embedded = new Function('input', `return (${projectRoleAgentContext.toString()})(input);`);
  for (const role of ['ADMIN', 'SUPPLIER', 'CUSTOMER']) assert.deepEqual(embedded(input(role)), projectRoleAgentContext(input(role)));
  assert.doesNotMatch(projectRoleAgentContext.toString(), /\b(?:fetch|require|import|XMLHttpRequest|axios|process)\s*\(/);
});
