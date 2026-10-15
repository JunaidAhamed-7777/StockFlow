import test from 'node:test';
import assert from 'node:assert/strict';
import { planNotifications } from './notification-rules.mjs';
import { planMaintenanceNotifications } from './maintenance-rules.mjs';

const now = Date.parse('2026-10-15T10:00:00Z');
const owner = { id: 1, user: { name: 'One', email: 'one@stockflow.test' } };
const product = { id: 11, supplierId: 1, sku: 'CATALOG-OWN', name: 'Own product', quantity: 0, lowStockThreshold: 10 };
const order = { id: 101, status: 'PENDING', createdAt: '2026-10-13T10:00:00Z', orderItems: [{ productId: 11, quantity: 2 }] };
const input = (overrides = {}) => ({ products: [product], suppliers: [owner], orders: [order], now, deliveryMode: 'discord', notificationsEnabled: false, ...overrides });

test('ambiguous or coercible owner/product identities fail before planning or changing state', () => {
  for (const mode of ['low-stock', 'daily-digest', 'stale-orders']) {
    for (const overrides of [
      { suppliers: [owner, { ...owner, user: { email: 'second@stockflow.test' } }] },
      { suppliers: [{ ...owner, id: '1' }] },
      { suppliers: [null] },
      { products: [product, { ...product, quantity: 1 }] },
      { products: [{ ...product, supplierId: 2 }] },
    ]) {
      const state = { sent: { unrelated: { at: 1 } } };
      const before = structuredClone(state);
      assert.throws(() => planNotifications(input({ mode, state, ...overrides })), /Invalid|ambiguous/);
      assert.deepEqual(state, before);
    }
  }
});

test('stale orders reject malformed identities, dates and quantities without acknowledging any event', () => {
  const invalidOrders = [
    { ...order, id: undefined }, { ...order, id: '101' }, { ...order, status: '' },
    { ...order, status: 'PENDING\nINJECTED' }, { ...order, createdAt: 'not a date' },
    { ...order, orderItems: {} }, { ...order, orderItems: [null] },
    ...[-1, 0, 0.5, '2', NaN].map(quantity => ({ ...order, orderItems: [{ productId: 11, quantity }] })),
    { ...order, orderItems: [{ productId: 999, quantity: 1 }] },
  ];
  for (const orders of [...invalidOrders.map(value => [value]), [order, { ...order }]]) {
    const state = {};
    assert.throws(() => planNotifications(input({ mode: 'stale-orders', orders, state })), /Invalid|ambiguous/);
    assert.deepEqual(state, {});
  }
  for (const invalidNow of [NaN, Infinity, '2026-10-15', null]) {
    assert.throws(() => planNotifications(input({ now: invalidNow })), /Invalid notification time/);
  }
});

test('stale order text uses catalog labels and excludes forged nested labels and customer data', () => {
  const secondOwner = { id: 2, user: { name: 'Two', email: 'two@stockflow.test' } };
  const result = planNotifications(input({ mode: 'stale-orders', suppliers: [owner, secondOwner],
    products: [product, { ...product, id: 21, supplierId: 2, sku: 'CATALOG-TWO' }],
    orders: [{ ...order, customer: { email: 'customer-private@stockflow.test' }, orderItems: [
      { productId: 11, quantity: 2, product: { id: 21, sku: 'FORGED-PRIVATE-LABEL' } },
      { productId: 21, quantity: 3, product: { sku: 'FORGED-TWO' } },
    ] }],
  }));
  assert.equal(result.notifications.length, 2);
  assert.match(result.notifications[0].message, /CATALOG-OWN × 2/);
  assert.match(result.notifications[1].message, /CATALOG-TWO × 3/);
  assert.doesNotMatch(result.notifications[0].message, /CATALOG-TWO|FORGED|customer-private/);
  assert.doesNotMatch(result.notifications[1].message, /CATALOG-OWN|FORGED|customer-private/);
  const alias = planNotifications(input({ mode: 'stale-orders', orders: [{ ...order, orderItems: undefined, items: [{ product: { id: 11, sku: 'FORGED' }, quantity: 2 }] }] }));
  assert.match(alias.notifications[0].message, /CATALOG-OWN × 2/);
});

test('order updates reject unresolved catalog owners before establishing any baseline', () => {
  const state = {};
  assert.throws(() => planMaintenanceNotifications(input({ mode: 'order-updates', state,
    products: [{ ...product, supplierId: 2 }],
  })), /Invalid inventory ownership/);
  assert.deepEqual(state, {});
});
