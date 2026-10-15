import test from 'node:test';
import assert from 'node:assert/strict';
import { clearRecoveredStock, createOwnerNotification, planNotifications, recordSuccessfulDelivery, resolveDeliverySettings } from './notification-rules.mjs';
import { planMaintenanceNotifications } from './maintenance-rules.mjs';

const NOW = Date.parse('2026-10-15T10:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const REDIRECT_TO = 'junuhammad2@gmail.com';
const supplier = (overrides = {}) => ({ id: 1, companyName: 'Test Owner One', user: { email: 'owner@inventory-supplier-one.com' }, ...overrides });
const product = (overrides = {}) => ({ id: 11, supplierId: 1, sku: 'ITEM-ONE', name: 'Desk supplies', quantity: 10, lowStockThreshold: 20, ...overrides });
const input = (overrides = {}) => ({ products: [product()], suppliers: [supplier()], now: NOW, ...overrides });
const notification = (overrides = {}) => planNotifications(input(overrides)).notifications[0];

test('planning defaults to preview even when mailEnabled is true', () => {
  for (const value of [undefined, false, true, 'true', 1, null]) {
    const result = planNotifications(input({ mailEnabled: value }));
    assert.equal(result.deliveryEnabled, false);
    assert.equal(result.notifications[0].deliveryEnabled, false);
    assert.equal(result.checkedProducts, 1);
    assert.equal(result.mode, 'low-stock');
    assert.equal(result.deliveryMode, 'preview');
  }
});

test('delivery requires an explicit mode and boolean true', () => {
  for (const deliveryMode of ['preview', 'owner', 'redirect']) {
    for (const mailEnabled of [undefined, false, true, 'true', 1, null]) {
      const result = planNotifications(input({ deliveryMode, redirectTo: REDIRECT_TO, mailEnabled }));
      const expected = deliveryMode !== 'preview' && mailEnabled === true;
      assert.equal(result.deliveryEnabled, expected);
      assert.equal(result.notifications[0].deliveryEnabled, expected);
      assert.equal(result.notifications[0].deliveryMode, deliveryMode);
    }
  }
});

test('redirect mode sends only to the configured mailbox and labels the intended owner prominently', () => {
  const mail = notification({
    deliveryMode: 'redirect', redirectTo: `  ${REDIRECT_TO}  `, mailEnabled: true,
    suppliers: [supplier({ companyName: 'Example Company', user: { name: 'Maya Northstar', email: 'maya@stockflow.example.test' } })],
  });
  assert.equal(mail.to, REDIRECT_TO);
  assert.equal(mail.cc, undefined);
  assert.equal(mail.bcc, undefined);
  assert.equal(mail.deliveryEnabled, true);
  assert.deepEqual(mail.intendedRecipient, { supplierId: 1, name: 'Maya Northstar', email: 'maya@stockflow.example.test' });
  assert.match(mail.subject, /^\[REDIRECTED\] StockFlow:/);
  assert.match(mail.message, /^REDIRECTED STOCKFLOW EMAIL/);
  assert.match(mail.message, /Intended stock owner: Maya Northstar\nIntended owner email: maya@stockflow.example.test\nSupplier ID: 1\nActual testing destination: junuhammad2@gmail.com/);
  assert.match(mail.message, /intended owner was not emailed/);
});

test('all owner messages are redirected independently without adding owner or supplied CC/BCC recipients', () => {
  const result = planNotifications(input({
    deliveryMode: 'redirect', redirectTo: REDIRECT_TO, mailEnabled: true,
    suppliers: [
      supplier({ cc: 'hidden@inventory-supplier-one.com', bcc: 'hidden@inventory-supplier-two.com' }),
      supplier({ id: 2, companyName: 'Other owner', user: { email: 'other@stockflow.example.test' } }),
    ],
    products: [product({ sku: 'FIRST-ONLY' }), product({ id: 21, supplierId: 2, sku: 'SECOND-ONLY' })],
  }));
  assert.equal(result.notifications.length, 2);
  assert.deepEqual(result.notifications.map(({ to }) => to), [REDIRECT_TO, REDIRECT_TO]);
  for (const mail of result.notifications) {
    assert.equal(mail.cc, undefined);
    assert.equal(mail.bcc, undefined);
    assert.equal(mail.deliveryEnabled, true);
  }
  assert.doesNotMatch(result.notifications[0].message, /SECOND-ONLY/);
  assert.doesNotMatch(result.notifications[1].message, /FIRST-ONLY/);
});

test('invalid redirect settings fail closed before planning even when delivery is disabled', () => {
  for (const redirectTo of [
    undefined, null, '', [], { email: REDIRECT_TO }, 'owner@host', 'owner@example.com',
    'owner@localhost', 'owner@stockflow.local', 'owner@stockflow.example.test',
    'Owner <junuhammad2@gmail.com>', 'junuhammad2@gmail.com,owner@inventory-supplier-one.com',
    'junuhammad2@gmail.com;owner@inventory-supplier-one.com',
    'junuhammad2@gmail.com\r\nBcc: owner@inventory-supplier-one.com',
  ]) {
    for (const mailEnabled of [false, true]) {
      assert.throws(() => planNotifications(input({ deliveryMode: 'redirect', redirectTo, mailEnabled })), /valid, deliverable redirectTo/);
    }
  }
  for (const deliveryMode of [null, '', 'REDIRECT', 'send', false, 1]) {
    assert.throws(() => planNotifications(input({ deliveryMode, redirectTo: REDIRECT_TO, mailEnabled: true })), /Unknown delivery mode/);
  }
});

test('shared owner notification formatter enforces routing for additional workflows', () => {
  const mail = createOwnerNotification({
    supplier: supplier({ user: { name: 'Owner\r\nInjected name', email: 'owner@stockflow.example.test' } }),
    mode: 'inventory-audit', subject: 'StockFlow: audit\r\nBcc: sneaky', lines: ['Check these records.'],
    events: [{ key: 'audit:1', at: NOW }], deliveryMode: 'redirect', redirectTo: REDIRECT_TO, mailEnabled: true,
  });
  assert.equal(mail.to, REDIRECT_TO);
  assert.match(mail.subject, /^\[REDIRECTED\] StockFlow: audit Bcc: sneaky$/);
  assert.doesNotMatch(mail.message, /\r|\nInjected name/);
  assert.match(mail.message, /Check these records/);
  assert.deepEqual(mail.events, [{ key: 'audit:1', at: NOW }]);
  assert.equal(createOwnerNotification({ supplier: supplier({ user: { email: 'owner@stockflow.example.test' } }), mode: 'audit', subject: 'Audit', mailEnabled: true }), null);
  assert.throws(() => createOwnerNotification({ supplier: supplier(), mode: 'audit', subject: 'Audit', deliveryMode: 'redirect', mailEnabled: true }), /redirectTo/);
  assert.deepEqual(resolveDeliverySettings(), { deliveryMode: 'preview', redirectTo: undefined, mailEnabled: false, notificationsEnabled: false, deliveryEnabled: false });
});

test('Discord delivery needs explicit discord mode and strict notificationsEnabled, independently of mailEnabled', () => {
  for (const notificationsEnabled of [undefined, false, true, 'true', 1, null]) {
    for (const mailEnabled of [false, true]) {
      const result = planNotifications(input({ deliveryMode: 'discord', notificationsEnabled, mailEnabled, redirectTo: 'not-an-email' }));
      assert.equal(result.deliveryEnabled, notificationsEnabled === true);
      assert.equal(result.notificationsEnabled, notificationsEnabled === true);
      assert.equal(result.notifications[0].deliveryEnabled, notificationsEnabled === true);
      assert.equal(result.notifications[0].to, 'discord-channel');
    }
  }
  assert.equal(planNotifications(input({ notificationsEnabled: true, mailEnabled: true })).deliveryEnabled, false);
  assert.equal(resolveDeliverySettings({ deliveryMode: 'owner', notificationsEnabled: true }).deliveryEnabled, false);
  const delivery = resolveDeliverySettings({ deliveryMode: 'discord', notificationsEnabled: true });
  const item = createOwnerNotification({ supplier: supplier(), mode: 'test', subject: 'Test', lines: ['Test detail.'], ...delivery });
  assert.equal(item.deliveryEnabled, true, 'spreading resolved delivery settings must retain the explicit flag');
});

test('Discord routes demo-owner attribution to one symbolic channel without any Gmail destination', () => {
  const item = notification({
    deliveryMode: 'discord', notificationsEnabled: true, redirectTo: REDIRECT_TO, mailEnabled: true,
    suppliers: [supplier({ user: { name: 'Supplier Test', email: 'supplier.test@stockflow.local' } })],
  });
  assert.equal(item.to, 'discord-channel');
  assert.equal(item.deliveryMode, 'discord');
  assert.equal(item.notificationsEnabled, true);
  assert.match(item.subject, /^\[TEST ROUTE\] StockFlow:/);
  assert.match(item.message, /^SINGLE DISCORD TEST CHANNEL/);
  assert.match(item.message, /Intended stock owner: Supplier Test\nIntended owner email: supplier.test@stockflow.local\nSupplier ID: 1/);
  assert.match(item.message, /Actual testing destination: configured Discord channel/);
  assert.match(item.message, /intended owner was not contacted/);
  assert.doesNotMatch(item.message, /junuhammad2@gmail.com|REDIRECTED STOCKFLOW EMAIL/);
  assert.deepEqual(item.intendedRecipient, { supplierId: 1, name: 'Supplier Test', email: 'supplier.test@stockflow.local' });
  assert.equal(item.cc, undefined);
  assert.equal(item.bcc, undefined);
});

test('maintenance planners retain the Discord flag for administrator audits and owner order updates', () => {
  const base = input({
    deliveryMode: 'discord', notificationsEnabled: true,
    suppliers: [supplier({ user: { email: 'supplier.test@stockflow.local' } })],
  });
  const audit = planMaintenanceNotifications({ ...base, mode: 'inventory-audit', categories: [] });
  assert.equal(audit.notifications.length, 1);
  assert.equal(audit.notifications[0].deliveryEnabled, true);
  assert.equal(audit.notifications[0].to, 'discord-channel');
  assert.equal(audit.notifications[0].intendedRecipient.supplierId, 0);
  const updates = planMaintenanceNotifications({ ...base, mode: 'order-updates', state: { orderBaseline: { statuses: {} } }, orders: [{ id: 101, status: 'PENDING', orderItems: [{ productId: 11, quantity: 1 }] }] });
  assert.equal(updates.notifications.length, 1);
  assert.equal(updates.notifications[0].deliveryEnabled, true);
  assert.equal(updates.notifications[0].to, 'discord-channel');
  assert.equal(updates.notifications[0].intendedRecipient.email, 'supplier.test@stockflow.local');
});

test('Discord stock groups preserve successful-delivery cooldowns and out-of-stock escalation', () => {
  const state = {};
  const config = { deliveryMode: 'discord', notificationsEnabled: true, state };
  const first = notification(config);
  recordSuccessfulDelivery(state, first);
  assert.equal(planNotifications(input({ ...config, now: NOW + HOUR })).notifications.length, 0);
  assert.ok(notification({ ...config, now: NOW + HOUR, products: [product({ quantity: 0 })] }));
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

test('reserved demonstration and local addresses are rejected outside redirected delivery', () => {
  const addresses = [
    'owner@example.com', 'owner@sub.example.com', 'owner@example.org', 'owner@example.net',
    'owner@EXAMPLE.COM', 'owner@localhost', 'owner@service.localhost', 'owner@stockflow.local',
    'owner@stockflow.test', 'owner@stockflow.invalid', 'owner@stockflow.example',
    'maya.northstar@stockflow.example.test',
  ];
  for (const email of addresses) {
    for (const deliveryMode of ['preview', 'owner']) {
      const result = planNotifications(input({ deliveryMode, mailEnabled: true, suppliers: [supplier({ user: { email } })] }));
      assert.equal(result.notifications.length, 0, email);
      assert.equal(result.skipped.length, 1, email);
    }
    const redirected = notification({ deliveryMode: 'redirect', redirectTo: REDIRECT_TO, suppliers: [supplier({ user: { email } })] });
    if (email.includes('@localhost')) {
      assert.equal(redirected, undefined, 'single-label hosts remain syntactically invalid');
    } else {
      assert.equal(redirected.to, REDIRECT_TO, email);
      assert.equal(redirected.intendedRecipient.email, email, email);
    }
  }
});

test('invalid, injected, and multiple recipient strings fail closed', () => {
  for (const email of [
    undefined, null, '', 'missing-at-sign', 'owner@host', 'Owner <owner@inventory-supplier-one.com>',
    'one@inventory-supplier-one.com,two@inventory-supplier-two.com',
    'owner,other@inventory-supplier-one.com', 'owner;other@inventory-supplier-one.com',
    'owner@inventory-supplier-one.com\r\nBcc: hidden@inventory-supplier-two.com',
  ]) {
    for (const deliveryMode of ['preview', 'owner', 'redirect']) {
      const result = planNotifications(input({ deliveryMode, redirectTo: REDIRECT_TO, mailEnabled: true, suppliers: [supplier({ user: { email } })] }));
      assert.equal(result.notifications.length, 0, String(email));
      assert.equal(result.skipped.length, 1, String(email));
    }
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
  const result = planNotifications(input({ mode: 'daily-digest', suppliers: [supplier(), supplier({ id: 2 })], products: [
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
    order({ id: 106, status: 'SHIPPED' }),
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
    products: [product({ sku: 'MY-LINE' }), product({ id: 21, supplierId: 2, sku: 'OTHER-LINE' })],
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
  assert.match(mail.message, /ITEM-ONE × 2/);
  assert.doesNotMatch(mail.message, /NESTED/);
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
