import test from 'node:test';
import assert from 'node:assert/strict';
import { clearRecoveredStock, planNotifications, recordSuccessfulDelivery } from './notification-rules.mjs';

const NOW = Date.parse('2026-10-15T10:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const supplier = (overrides = {}) => ({ id: 1, companyName: 'Test Owner One', user: { email: 'owner@inventory-supplier-one.com' }, ...overrides });
const product = (overrides = {}) => ({ id: 11, supplierId: 1, sku: 'ITEM-ONE', name: 'Desk supplies', quantity: 10, lowStockThreshold: 20, ...overrides });
const input = (overrides = {}) => ({ products: [product()], suppliers: [supplier()], now: NOW, ...overrides });
const notification = (overrides = {}) => planNotifications(input(overrides)).notifications[0];

test('planning defaults to preview and enables delivery only for boolean true', () => {
  for (const value of [undefined, false, 'true', 1, null]) {
    const result = planNotifications(input({ mailEnabled: value }));
    assert.equal(result.deliveryEnabled, false);
    assert.equal(result.notifications[0].deliveryEnabled, false);
    assert.equal(result.checkedProducts, 1);
    assert.equal(result.mode, 'low-stock');
  }
  const result = planNotifications(input({ mailEnabled: true }));
  assert.equal(result.deliveryEnabled, true);
  assert.equal(result.notifications[0].deliveryEnabled, true);
});

test('critical alerts use each product threshold rather than a fixed stock count', () => {
  const result = planNotifications(input({ products: [
    product({ id: 11, quantity: 10, lowStockThreshold: 20, sku: 'AT-CRITICAL' }),
    product({ id: 12, quantity: 11, lowStockThreshold: 20, sku: 'ABOVE-CRITICAL' }),
    product({ id: 13, quantity: 8, lowStockThreshold: 10, sku: 'LOW-NOT-CRITICAL' }),
    product({ id: 14, quantity: 1, lowStockThreshold: 3, sku: 'ODD-THRESHOLD' }),
    product({ id: 15, quantity: 2, lowStockThreshold: 3, sku: 'ABOVE-ODD' }),
  ] }));
  assert.equal(result.notifications.length, 1);
  const mail = result.notifications[0];
  assert.match(mail.message, /AT-CRITICAL/);
  assert.match(mail.message, /ODD-THRESHOLD/);
  assert.doesNotMatch(mail.message, /ABOVE-CRITICAL|LOW-NOT-CRITICAL|ABOVE-ODD/);
  assert.equal(mail.events.length, 2);
});

test('zero stock alerts even when the reorder threshold is zero', () => {
  const mail = notification({ products: [product({ quantity: 0, lowStockThreshold: 0 })] });
  assert.equal(mail.events[0].level, 'out');
  assert.match(mail.message, /0 remaining/);
  assert.equal(planNotifications(input({ products: [product({ quantity: 1, lowStockThreshold: 0 })] })).notifications.length, 0);
});

test('one message groups each owner’s critical products without leaking another owner’s inventory', () => {
  const result = planNotifications(input({
    suppliers: [supplier(), supplier({ id: 2, companyName: 'Test Owner Two', user: { email: 'owner@inventory-supplier-two.com' } })],
    products: [
      product({ id: 11, sku: 'ONE-A' }), product({ id: 12, sku: 'ONE-B' }),
      product({ id: 21, supplierId: 2, sku: 'TWO-SECRET', name: 'Other owner goods' }),
    ],
  }));
  assert.equal(result.notifications.length, 2);
  const [one, two] = result.notifications;
  assert.equal(one.to, 'owner@inventory-supplier-one.com');
  assert.equal(two.to, 'owner@inventory-supplier-two.com');
  assert.equal(one.events.length, 2);
  assert.equal(two.events.length, 1);
  assert.match(one.message, /ONE-A/);
  assert.match(one.message, /ONE-B/);
  assert.doesNotMatch(one.message, /TWO-SECRET|Other owner goods/);
  assert.doesNotMatch(two.message, /ONE-A|ONE-B/);
});

test('malformed response envelopes and unsupported modes fail closed', () => {
  for (const field of ['products', 'suppliers', 'orders']) {
    for (const malformed of [null, {}, 'not an array', 4]) {
      assert.throws(() => planNotifications(input({ [field]: malformed })), /Invalid inventory response/);
    }
  }
  assert.throws(() => planNotifications(input({ mode: 'prediction' })), /Unknown notification mode/);
});

test('malformed stock never turns into a false out-of-stock email', () => {
  const invalid = {
    quantity: [-1, 0.5, Infinity, NaN, undefined, null, '', true, false],
    lowStockThreshold: [-1, 0.5, Infinity, NaN, undefined, null, '', true, false],
    id: [0, -1, 0.5, Infinity, NaN, undefined, null, '', true, false, Number.MAX_SAFE_INTEGER + 1],
    supplierId: [0, -1, 0.5, Infinity, NaN, undefined, null, '', true, false, Number.MAX_SAFE_INTEGER + 1],
  };
  for (const [field, values] of Object.entries(invalid)) {
    for (const value of values) {
      assert.throws(
        () => planNotifications(input({ products: [product({ [field]: value })] })),
        /Invalid stock values/,
        `${field}=${String(value)} must not generate an alert`,
      );
    }
  }
});

test('reserved demonstration and local addresses are never recipients', () => {
  const addresses = [
    'owner@example.com', 'owner@sub.example.com', 'owner@example.org', 'owner@example.net',
    'owner@EXAMPLE.COM', 'owner@localhost', 'owner@service.localhost', 'owner@stockflow.local',
    'owner@stockflow.test', 'owner@stockflow.invalid', 'owner@stockflow.example',
    'maya.northstar@stockflow.example.test',
  ];
  for (const email of addresses) {
    const result = planNotifications(input({ suppliers: [supplier({ user: { email } })] }));
    assert.equal(result.notifications.length, 0, email);
    assert.equal(result.skipped.length, 1, email);
  }
});

test('invalid, injected, and multiple recipient strings fail closed', () => {
  for (const email of [
    undefined, null, '', 'missing-at-sign', 'owner@host', 'Owner <owner@inventory-supplier-one.com>',
    'one@inventory-supplier-one.com,two@inventory-supplier-two.com',
    'owner,other@inventory-supplier-one.com', 'owner;other@inventory-supplier-one.com',
    'owner@inventory-supplier-one.com\r\nBcc: hidden@inventory-supplier-two.com',
  ]) {
    const result = planNotifications(input({ suppliers: [supplier({ user: { email } })] }));
    assert.equal(result.notifications.length, 0, String(email));
    assert.equal(result.skipped.length, 1, String(email));
  }
});

test('a single valid plus-address is preserved and surrounding whitespace is trimmed', () => {
  const mail = notification({ suppliers: [supplier({ user: { email: '  owner+stock@inventory-supplier-one.com  ' } })] });
  assert.equal(mail.to, 'owner+stock@inventory-supplier-one.com');
});

test('unchanged critical stock is suppressed until the exact reminder boundary', () => {
  const state = {};
  const first = notification({ state });
  recordSuccessfulDelivery(state, first);
  assert.equal(planNotifications(input({ state, now: NOW + 24 * HOUR - 1 })).notifications.length, 0);
  assert.equal(planNotifications(input({ state, now: NOW + 24 * HOUR })).notifications.length, 1);
});

test('running out of stock bypasses the critical reminder cooldown once', () => {
  const state = {};
  recordSuccessfulDelivery(state, notification({ state }));
  const out = notification({ state, now: NOW + HOUR, products: [product({ quantity: 0 })] });
  assert.ok(out, 'out-of-stock escalation must be sent immediately');
  assert.equal(out.events[0].level, 'out');
  recordSuccessfulDelivery(state, out);
  assert.equal(planNotifications(input({ state, now: NOW + 2 * HOUR, products: [product({ quantity: 0 })] })).notifications.length, 0);
});

test('planning an alert does not mark it delivered or consume its cooldown', () => {
  const state = { sent: { unrelated: { at: NOW - HOUR } } };
  const before = structuredClone(state);
  const first = planNotifications(input({ state }));
  const retry = planNotifications(input({ state }));
  assert.deepEqual(state, before);
  assert.deepEqual(retry.notifications, first.notifications);
});

test('recovery rearms a new critical incident inside the previous reminder cooldown', () => {
  const state = { sent: { 'digest:1': { day: '2026-10-15' }, 'order:1:101': { at: NOW } } };
  recordSuccessfulDelivery(state, notification({ state }));
  assert.ok(state.sent['stock:1:11']);
  assert.equal(clearRecoveredStock(state, [product({ quantity: 11 })]), state);
  assert.equal(state.sent['stock:1:11'], undefined);
  assert.deepEqual(state.sent['digest:1'], { day: '2026-10-15' });
  assert.deepEqual(state.sent['order:1:101'], { at: NOW });
  const newIncident = notification({ state, now: NOW + HOUR, products: [product({ quantity: 10 })] });
  assert.ok(newIncident, 'a fresh critical incident after recovery should send immediately');
});

test('partial replenishment that remains critical does not reset the sent marker', () => {
  const state = {};
  recordSuccessfulDelivery(state, notification({ state, products: [product({ quantity: 0 })] }));
  clearRecoveredStock(state, [product({ quantity: 10 })]);
  assert.equal(state.sent['stock:1:11'].level, 'out');
  assert.equal(planNotifications(input({ state, now: NOW + HOUR })).notifications.length, 0);
});

test('recording successful delivery copies only its events and retains unrelated state', () => {
  const state = { sent: { unrelated: { at: 5 } }, metadata: 'retain' };
  const mail = notification();
  const original = structuredClone(mail);
  assert.equal(recordSuccessfulDelivery(state, mail), state);
  assert.deepEqual(state.sent.unrelated, { at: 5 });
  assert.equal(state.metadata, 'retain');
  assert.deepEqual(state.sent[mail.events[0].key], mail.events[0]);
  assert.notEqual(state.sent[mail.events[0].key], mail.events[0]);
  assert.deepEqual(mail, original);
  assert.throws(() => recordSuccessfulDelivery({}, { events: [] }), /empty notification/);
  assert.throws(() => recordSuccessfulDelivery({}, null), /empty notification/);
});

test('daily digest sends once per UTC date and resets at midnight UTC', () => {
  const state = {};
  const beforeMidnight = Date.parse('2026-10-15T23:59:00.000Z');
  const first = notification({ mode: 'daily-digest', now: beforeMidnight, state });
  recordSuccessfulDelivery(state, first);
  assert.equal(first.events[0].day, '2026-10-15');
  assert.equal(planNotifications(input({ mode: 'daily-digest', state, now: beforeMidnight + 30000 })).notifications.length, 0);
  const afterMidnight = notification({ mode: 'daily-digest', state, now: Date.parse('2026-10-16T00:00:00.000Z') });
  assert.ok(afterMidnight);
  assert.equal(afterMidnight.events[0].day, '2026-10-16');
});

test('digest includes low stock above the critical cutoff and correct owner-only totals', () => {
  const result = planNotifications(input({ mode: 'daily-digest', products: [
    product({ quantity: 19, lowStockThreshold: 20, sku: 'LOW' }),
    product({ id: 12, quantity: 21, lowStockThreshold: 20, sku: 'HEALTHY' }),
    product({ id: 21, supplierId: 2, quantity: 999, sku: 'OTHER-OWNER' }),
  ] }));
  const mail = result.notifications[0];
  assert.match(mail.message, /2 products; 40 units in stock/);
  assert.match(mail.message, /1 products at or below/);
  assert.match(mail.message, /LOW/);
  assert.doesNotMatch(mail.message, /HEALTHY|OTHER-OWNER|999/);
});

const order = (overrides = {}) => ({
  id: 101, status: 'PENDING', createdAt: new Date(NOW - 48 * HOUR).toISOString(),
  orderItems: [{ productId: 11, quantity: 3, product: { id: 11, sku: 'MY-LINE' } }], ...overrides,
});

test('stale order follow-up starts at exactly 48 hours and only for pending or processing orders', () => {
  const result = planNotifications(input({ mode: 'stale-orders', orders: [
    order(), order({ id: 102, status: 'PROCESSING' }),
    order({ id: 103, createdAt: new Date(NOW - 48 * HOUR + 1).toISOString() }),
    order({ id: 104, status: 'DELIVERED' }), order({ id: 105, status: 'CANCELLED' }),
    order({ id: 106, status: 'SHIPPED' }), order({ id: 107, createdAt: 'not a date' }),
    order({ id: 108, createdAt: new Date(NOW + HOUR).toISOString() }),
  ] }));
  const mail = result.notifications[0];
  assert.equal(mail.events.length, 2);
  assert.match(mail.message, /Order #101/);
  assert.match(mail.message, /Order #102/);
  assert.doesNotMatch(mail.message, /Order #10[3-8]/);
});

test('stale order messages reveal only the receiving supplier’s order lines', () => {
  const result = planNotifications(input({
    mode: 'stale-orders',
    suppliers: [supplier(), supplier({ id: 2, user: { email: 'owner@inventory-supplier-two.com' } })],
    products: [product(), product({ id: 21, supplierId: 2 })],
    orders: [order({
      customer: { name: 'Private Customer', email: 'private@customer-domain.com' },
      orderItems: [
        { productId: 11, quantity: 3, product: { sku: 'MY-LINE' } },
        { productId: 21, quantity: 8, product: { sku: 'OTHER-LINE' } },
      ],
    })],
  }));
  assert.equal(result.notifications.length, 2);
  const [one, two] = result.notifications;
  assert.match(one.message, /MY-LINE × 3/);
  assert.doesNotMatch(one.message, /OTHER-LINE|Private Customer|private@customer-domain.com/);
  assert.match(two.message, /OTHER-LINE × 8/);
  assert.doesNotMatch(two.message, /MY-LINE|Private Customer|private@customer-domain.com/);
});

test('stale order follow-up supports nested product identifiers and the items alias', () => {
  const withNestedItem = order({ orderItems: undefined, items: [{ product: { id: 11, sku: 'NESTED' }, quantity: 2 }] });
  const mail = notification({ mode: 'stale-orders', orders: [withNestedItem] });
  assert.match(mail.message, /NESTED × 2/);
});

test('stale order reminders observe cooldown without suppressing a newly stale order', () => {
  const state = {};
  recordSuccessfulDelivery(state, notification({ mode: 'stale-orders', orders: [order()], state }));
  const result = planNotifications(input({ mode: 'stale-orders', state, now: NOW + HOUR, orders: [order(), order({ id: 102 })] }));
  assert.match(result.notifications[0].message, /Order #102/);
  assert.doesNotMatch(result.notifications[0].message, /Order #101/);
  assert.equal(planNotifications(input({ mode: 'stale-orders', state, now: NOW + 24 * HOUR, orders: [order()] })).notifications.length, 1);
});

test('untrusted catalog text cannot inject extra email lines', () => {
  const mail = notification({
    products: [product({ name: 'Desk supplies\r\nBcc: another-owner@inventory-supplier-two.com', sku: 'ITEM\tONE' })],
    suppliers: [supplier({ companyName: 'Owner\nInjected greeting' })],
  });
  assert.doesNotMatch(mail.message, /\nBcc:|\nInjected greeting|\r|\t/);
  assert.match(mail.message, /Desk supplies Bcc:/);
  assert.match(mail.message, /contains no AI predictions/);
});
