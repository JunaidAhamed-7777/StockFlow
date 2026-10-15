import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createOwnerNotification, recordSuccessfulDelivery, resolveDeliverySettings } from './notification-rules.mjs';
import { planMaintenanceNotifications, rememberInitialOrderBaseline } from './maintenance-rules.mjs';

const NOW = Date.parse('2026-10-15T10:00:00.000Z');
const supplier = (overrides = {}) => ({ id: 1, companyName: 'Owner One', user: { name: 'Owner One', email: 'one@stockflow.example.test' }, ...overrides });
const product = (overrides = {}) => ({ id: 11, supplierId: 1, categoryId: 5, sku: 'ONE-ITEM', name: 'Desk supplies', price: 0, quantity: 10, lowStockThreshold: 20, ...overrides });
const order = (overrides = {}) => ({ id: 101, status: 'PENDING', orderItems: [{ productId: 11, quantity: 3 }], ...overrides });
const input = (overrides = {}) => ({ products: [product()], suppliers: [supplier()], categories: [{ id: 5, name: 'Supplies' }], orders: [], mode: 'inventory-audit', now: NOW, deliveryMode: 'redirect', redirectTo: 'junuhammad2@gmail.com', mailEnabled: true, ...overrides });
const observe = (state, orders, overrides = {}) => planMaintenanceNotifications(input({ mode: 'order-updates', state, orders, ...overrides }));
const initialize = (orders = [order()]) => {
  const state = {};
  const report = observe(state, orders);
  rememberInitialOrderBaseline(state, report);
  return state;
};

test('healthy catalog audit stays quiet and allows zero price, stock, and reorder threshold', () => {
  const report = planMaintenanceNotifications(input({ products: [product({ price: 0, quantity: 0, lowStockThreshold: 0 })] }));
  assert.deepEqual(report.notifications, []);
  assert.deepEqual(report.issues, []);
  assert.equal(report.checkedProducts, 1);
});

test('audit describes actual invalid data, intended administrator, affected owner, and redirect', () => {
  const report = planMaintenanceNotifications(input({ products: [product({ name: '', price: -1, quantity: 1.5, lowStockThreshold: -1, categoryId: 999 })] }));
  assert.deepEqual(report.issues.map(({ type }) => type), ['missing-name', 'invalid-price', 'invalid-quantity', 'invalid-threshold', 'unknown-category']);
  const mail = report.notifications[0];
  assert.equal(mail.to, 'junuhammad2@gmail.com');
  assert.deepEqual(mail.intendedRecipient, { supplierId: 0, name: 'StockFlow administrator', email: 'admin.test@stockflow.local' });
  assert.match(mail.subject, /^\[REDIRECTED\] StockFlow: 5 inventory/);
  assert.match(mail.message, /administrator \(not an individual supplier\)/);
  assert.match(mail.message, /Owner One \(supplier #1, one@stockflow.example.test\)/);
  assert.match(mail.message, /No records were modified/);
  assert.match(mail.message, /Actual testing destination: junuhammad2@gmail.com/);
});

test('audit detects unresolved owners, categories, missing email, and normalized SKU collisions without guessing duplicates', () => {
  const report = planMaintenanceNotifications(input({
    products: [product(), product({ id: 12, sku: ' one-item ', supplierId: 99 }), product({ id: 13, sku: 'MISSING-EMAIL' })],
    suppliers: [supplier({ user: {} })],
  }));
  assert.equal(report.issues.filter(({ type }) => type === 'duplicate-sku').length, 1);
  assert.equal(report.issues.filter(({ type }) => type === 'unknown-owner').length, 1);
  assert.equal(report.issues.filter(({ type }) => type === 'missing-owner-email').length, 2);
  assert.match(report.notifications[0].message, /review flag, not proof/);
});

test('audit inspects malformed rows and numbers rather than producing false valid-stock claims', () => {
  const report = planMaintenanceNotifications(input({ products: [null, product({ id: 11, price: NaN }), product({ id: 11, price: '12' })] }));
  assert.ok(report.issues.some(({ type, productId }) => type === 'invalid-product-id' && productId === null));
  assert.equal(report.issues.filter(({ type }) => type === 'invalid-price').length, 3);
  assert.equal(report.issues.filter(({ type }) => type === 'duplicate-product-id').length, 1);
  assert.equal(report.checkedProducts, 3);
});

test('weekly audit cooldown starts only after successful delivery and uses Monday in Asia/Kolkata', () => {
  const state = {};
  const sundayNightUtc = Date.parse('2026-10-18T18:29:59.999Z');
  const settings = { products: [product({ price: -1 })], state, now: sundayNightUtc };
  const first = planMaintenanceNotifications(input(settings));
  assert.deepEqual(state, {});
  assert.equal(first.notifications[0].events[0].week, '2026-10-12');
  assert.equal(planMaintenanceNotifications(input(settings)).notifications.length, 1, 'failed delivery remains retryable');
  recordSuccessfulDelivery(state, first.notifications[0]);
  assert.equal(planMaintenanceNotifications(input(settings)).notifications.length, 0);
  const nextWeek = planMaintenanceNotifications(input({ ...settings, now: sundayNightUtc + 1 }));
  assert.equal(nextWeek.notifications[0].events[0].week, '2026-10-19');
});

test('audit limits email detail without lying about the full issue count', () => {
  const report = planMaintenanceNotifications(input({ products: Array.from({ length: 120 }, (_, index) => product({ id: index + 1, sku: `ITEM-${index}`, price: -1 })) }));
  assert.equal(report.issues.length, 120);
  assert.match(report.notifications[0].message, /120 recorded data issues across 120 products/);
  assert.match(report.notifications[0].message, /20 additional issues omitted/);
});

test('first valid order observation creates a pure baseline and sends no historical messages', () => {
  const state = {};
  const report = observe(state, [order(), order({ id: 102, status: 'SHIPPED' })]);
  assert.deepEqual(state, {});
  assert.deepEqual(report.notifications, []);
  assert.deepEqual(report.orderBaseline, { initializedAt: NOW, statuses: { 101: 'PENDING', 102: 'SHIPPED' } });
  assert.equal(rememberInitialOrderBaseline(state, report), state);
  assert.notEqual(state.orderBaseline.statuses, report.orderBaseline.statuses);
  assert.equal(observe(state, [order(), order({ id: 102, status: 'SHIPPED' })]).notifications.length, 0);
  rememberInitialOrderBaseline(state, { mode: 'order-updates', orderBaseline: { statuses: { 101: 'CANCELLED' } } });
  assert.equal(state.orderBaseline.statuses[101], 'PENDING', 'initial history must never overwrite a valid baseline');
});

test('an initially empty order list still establishes history so the next new order is notified', () => {
  const state = initialize([]);
  assert.deepEqual(state.orderBaseline.statuses, {});
  const report = observe(state, [order()]);
  assert.equal(report.notifications.length, 1);
  assert.match(report.notifications[0].message, /Order #101: New order recorded as PENDING/);
});

test('changed orders are retried until successful delivery and successive/reverted statuses each notify', () => {
  const state = initialize();
  const before = structuredClone(state);
  const first = observe(state, [order({ status: 'SHIPPED' })]);
  assert.deepEqual(state, before);
  assert.equal(observe(state, [order({ status: 'SHIPPED' })]).notifications.length, 1);
  assert.match(first.notifications[0].message, /PENDING → SHIPPED/);
  recordSuccessfulDelivery(state, first.notifications[0]);
  assert.equal(observe(state, [order({ status: 'SHIPPED' })]).notifications.length, 0);
  const reverted = observe(state, [order()]);
  assert.match(reverted.notifications[0].message, /SHIPPED → PENDING/);
  recordSuccessfulDelivery(state, reverted.notifications[0]);
  assert.equal(observe(state, [order()]).notifications.length, 0);
});

test('order mails use catalog ownership and contain only each owner’s order lines', () => {
  const products = [product(), product({ id: 21, supplierId: 2, sku: 'TWO-SECRET' })];
  const suppliers = [supplier(), supplier({ id: 2, user: { name: 'Owner Two', email: 'two@stockflow.example.test' } })];
  const state = initialize([]);
  const report = observe(state, [order({
    customer: { name: 'PRIVATE-CUSTOMER', email: 'private@customer.com' }, totalAmount: 999999,
    orderItems: [
      { productId: 11, quantity: 3, product: { supplierId: 2, sku: 'UNTRUSTED-NESTED-LABEL' } },
      { productId: 21, quantity: 8 },
    ],
  })], { products, suppliers });
  assert.equal(report.notifications.length, 2);
  const [one, two] = report.notifications;
  assert.equal(one.to, 'junuhammad2@gmail.com');
  assert.equal(two.to, 'junuhammad2@gmail.com');
  assert.equal(one.intendedRecipient.email, 'one@stockflow.example.test');
  assert.equal(two.intendedRecipient.email, 'two@stockflow.example.test');
  assert.match(one.message, /ONE-ITEM × 3/);
  assert.doesNotMatch(one.message, /TWO-SECRET|UNTRUSTED|PRIVATE-CUSTOMER|private@customer.com|999999/);
  assert.match(two.message, /TWO-SECRET × 8/);
  assert.doesNotMatch(two.message, /ONE-ITEM|PRIVATE-CUSTOMER|private@customer.com/);
  recordSuccessfulDelivery(state, one);
  const retry = observe(state, [order({ orderItems: [{ productId: 11, quantity: 3 }, { productId: 21, quantity: 8 }] })], { products, suppliers });
  assert.equal(retry.notifications.length, 1);
  assert.equal(retry.notifications[0].supplierId, 2, 'one successful owner delivery must not suppress the other owner');
});

test('order notifications support existing items alias with nested product identifier', () => {
  const state = initialize([]);
  const report = observe(state, [order({ orderItems: undefined, items: [{ product: { id: 11 }, quantity: 1 }] })]);
  assert.match(report.notifications[0].message, /ONE-ITEM × 1/);
});

test('order updates cap one mail at fifty orders without acknowledging deferred changes', () => {
  const state = initialize([]);
  const orders = Array.from({ length: 55 }, (_, index) => order({ id: index + 1 }));
  const first = observe(state, orders);
  assert.equal(first.notifications[0].events.length, 50);
  assert.match(first.notifications[0].message, /5 further order updates/);
  recordSuccessfulDelivery(state, first.notifications[0]);
  const second = observe(state, orders);
  assert.equal(second.notifications[0].events.length, 5);
  assert.equal(second.notifications[0].events[0].orderId, 51);
});

test('malformed sources fail before a baseline or notification can be remembered', () => {
  for (const field of ['products', 'suppliers', 'categories', 'orders']) {
    assert.throws(() => planMaintenanceNotifications(input({ [field]: {} })), /Invalid maintenance response/);
  }
  assert.throws(() => planMaintenanceNotifications(input({ mode: 'guess' })), /Unknown maintenance/);
  assert.throws(() => planMaintenanceNotifications(input({ now: Infinity })), /Invalid notification time/);
  const badOrders = [null, order({ id: 0 }), order({ status: '' }), order({ status: 'PENDING\nBcc:' }), order({ orderItems: null }), order({ orderItems: [{ productId: 999, quantity: 3 }] }), order({ orderItems: [{ productId: 11, quantity: -1 }] })];
  for (const value of badOrders) {
    const state = {};
    assert.throws(() => observe(state, [value]), /Invalid order/);
    assert.deepEqual(state, {});
  }
  assert.throws(() => observe({}, [order(), order()]), /Invalid order/);
  assert.throws(() => observe({}, [], { products: [product(), product()] }), /ambiguous inventory ownership/);
  assert.throws(() => observe({}, [], { suppliers: [supplier(), supplier()] }), /ambiguous owner directory/);
  assert.throws(() => observe({ orderBaseline: { statuses: [] } }, [order()]), /Invalid remembered/);
});

test('delivery defaults to preview and cannot send to reserved owners without redirect', () => {
  const report = planMaintenanceNotifications(input({ products: [product({ price: -1 })], deliveryMode: undefined, mailEnabled: true }));
  assert.equal(report.deliveryEnabled, false);
  assert.equal(report.notifications.length, 0);
  assert.equal(report.skipped.length, 1);
  assert.throws(() => planMaintenanceNotifications(input({ redirectTo: 'not-an-email' })), /valid, deliverable/);
  const ownerDelivery = observe(initialize([]), [order()], { suppliers: [supplier({ user: { name: 'Owner', email: 'owner@inventory-supplier.com' } })], deliveryMode: 'owner' });
  assert.equal(ownerDelivery.notifications[0].to, 'owner@inventory-supplier.com');
  assert.equal(ownerDelivery.notifications[0].deliveryEnabled, true);
});

test('data-derived text cannot inject extra email lines and no source input is mutated', () => {
  const data = input({ products: [product({ price: -1, sku: 'SKU\nBcc: another@example.com' })], suppliers: [supplier({ companyName: 'Owner\r\nInjected' })] });
  const before = structuredClone(data);
  const report = planMaintenanceNotifications(data);
  assert.deepEqual(data, before);
  assert.doesNotMatch(report.notifications[0].message, /\nBcc:|\nInjected|\r|\t/);
});

test('planners serialize into a dependency-free n8n Code-node context', () => {
  const source = [resolveDeliverySettings, createOwnerNotification, planMaintenanceNotifications, rememberInitialOrderBaseline].map((fn) => fn.toString()).join('\n');
  const sandbox = { input: input({ mode: 'order-updates', orders: [order()], state: {} }) };
  vm.createContext(sandbox);
  const result = vm.runInContext(`${source}\nconst report = planMaintenanceNotifications(input); rememberInitialOrderBaseline(input.state, report); ({report, state: input.state});`, sandbox);
  assert.equal(result.report.notifications.length, 0);
  assert.equal(result.state.orderBaseline.statuses[101], 'PENDING');
});
