import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const DESTINATION = 'discord-channel';
const workflows = ['low-stock', 'daily-digest', 'stale-orders', 'inventory-audit', 'order-updates'].map((mode) => ({
  mode,
  workflow: JSON.parse(readFileSync(new URL(`./workflows/stockflow-${mode}.json`, import.meta.url), 'utf8')),
}));
const getNode = (workflow, name) => {
  const result = workflow.nodes.find((node) => node.name === name);
  assert.ok(result, `Missing ${name} in ${workflow.name}`);
  return result;
};
const executeCode = (workflow, name, { source = {}, state = {}, json = {}, items = [] } = {}) => {
  const lookup = (nodeName) => ({ first: () => ({ json: source[nodeName] }), item: { json: source[nodeName] } });
  return new Function('$', '$input', '$json', '$getWorkflowStaticData', getNode(workflow, name).parameters.jsCode)(lookup, { all: () => items }, json, () => state);
};
const fixture = (workflow, mode, enabled = false) => {
  const settings = executeCode(workflow, 'Settings')[0].json;
  const product = { id: 11, supplierId: 1, categoryId: 1, name: mode === 'inventory-audit' ? '' : 'Desk supplies', sku: 'DESK-ONE', price: 10, quantity: 0, lowStockThreshold: 10 };
  const source = {
    Settings: { ...settings, notificationsEnabled: enabled },
    'Read inventory': { data: [product] },
    'Read owners': [{ id: 1, companyName: 'Demo stock owner', user: { name: 'Demo Owner', email: 'owner@stockflow.test' } }],
    'Read categories': { data: [{ id: 1, name: 'Office' }] },
    'Read orders': { data: [{ id: 21, status: 'PENDING', createdAt: new Date(Date.now() - 72 * 3600000).toISOString(), orderItems: [{ productId: 11, quantity: 1 }] }] },
  };
  return source;
};

test('all five workflow templates default to preview and use one encrypted Discord webhook transport', () => {
  assert.equal(new Set(workflows.map(({ workflow }) => workflow.id)).size, 5);
  for (const { workflow } of workflows) {
    const settings = executeCode(workflow, 'Settings')[0].json;
    assert.equal(settings.deliveryMode, 'discord');
    assert.equal(settings.notificationsEnabled, false);
    assert.equal(Object.hasOwn(settings, 'redirectTo'), false);
    assert.equal(Object.hasOwn(settings, 'mailEnabled'), false);
    assert.equal(workflow.active, false);
    const mailNodes = workflow.nodes.filter((node) => node.type === 'n8n-nodes-base.gmail');
    assert.equal(mailNodes.length, 0);
    const discordNodes = workflow.nodes.filter((node) => node.type === 'n8n-nodes-base.discord');
    assert.equal(discordNodes.length, 1);
    assert.equal(discordNodes[0].typeVersion, 2);
    assert.deepEqual(discordNodes[0].parameters, { authentication: 'webhook', operation: 'sendLegacy', content: '={{ $json.discordContent }}', options: { wait: true, flags: ['SUPPRESS_EMBEDS'], tts: false } });
    assert.equal(discordNodes[0].retryOnFail, false);
    assert.equal(discordNodes[0].onError, 'continueRegularOutput');
    assert.doesNotMatch(JSON.stringify(workflow), /https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/webhooks\//);
    assert.equal(workflow.settings.timezone, 'Asia/Kolkata');
    assert.equal(workflow.settings.saveDataSuccessExecution, 'none');
    assert.equal(workflow.settings.saveDataErrorExecution, 'none');
    assert.equal(workflow.settings.saveManualExecutions, false);
    assert.equal(workflow.settings.saveExecutionProgress, false);
  }
});

test('all five schedules retain their exact interval and Asia/Kolkata timezone', () => {
  const schedules = {
    'low-stock': [{ field: 'minutes', minutesInterval: 15 }],
    'daily-digest': [{ field: 'cronExpression', expression: '0 0 9 * * *' }],
    'stale-orders': [{ field: 'cronExpression', expression: '0 0 10 * * *' }],
    'inventory-audit': [{ field: 'cronExpression', expression: '0 30 9 * * 1' }],
    'order-updates': [{ field: 'minutes', minutesInterval: 15 }],
  };
  for (const { mode, workflow } of workflows) {
    assert.equal(workflow.settings.timezone, 'Asia/Kolkata', mode);
    assert.deepEqual(getNode(workflow, 'Schedule').parameters.rule.interval, schedules[mode], mode);
  }
});

test('delivery guards reject owner routing, changed destinations, and missing recipient attribution', () => {
  const valid = { kind: 'notification', deliveryEnabled: true, deliveryMode: 'discord', to: DESTINATION, intendedRecipient: { name: 'Owner', email: 'owner@stockflow.test', supplierId: 1 } };
  for (const { workflow } of workflows) {
    const condition = getNode(workflow, 'Delivery enabled').parameters.conditions.conditions[0];
    const evaluate = new Function('$json', `return ${condition.leftValue.slice(3, -2).trim()}`);
    assert.equal(evaluate(valid), true);
    for (const patch of [
      { kind: 'summary' }, { deliveryEnabled: false }, { deliveryEnabled: 'true' },
      { deliveryMode: 'owner' }, { deliveryMode: 'preview' }, { deliveryMode: 'redirect' }, { to: 'owner@actual-owner.com' },
      { to: `${DESTINATION},other-channel` }, { intendedRecipient: undefined },
      { intendedRecipient: {} }, { intendedRecipient: { name: 'Owner', email: '', supplierId: 1 } },
      { intendedRecipient: { name: 'Owner', email: 'owner@stockflow.test', supplierId: '1' } },
    ]) assert.equal(evaluate({ ...valid, ...patch }), false, JSON.stringify(patch));
    const incoming = Object.entries(workflow.connections).flatMap(([from, value]) => value.main.flatMap((branch, index) => branch.filter(({ node }) => node === 'Send Discord notification').map(() => ({ from, branch: index }))));
    assert.deepEqual(incoming, [{ from: 'Prepare Discord message', branch: 0 }]);
    assert.equal(workflow.connections['Delivery enabled'].main[0][0].node, 'Prepare Discord message');
    assert.equal(workflow.connections['Delivery enabled'].main[1][0].node, 'Preview only');
  }
});

test('all embedded Code nodes compile without external imports or network capabilities', () => {
  for (const { workflow } of workflows) {
    for (const node of workflow.nodes.filter(({ type }) => type === 'n8n-nodes-base.code')) {
      assert.doesNotThrow(() => new Function('$', '$input', '$json', '$getWorkflowStaticData', node.parameters.jsCode), `${workflow.name}: ${node.name}`);
      assert.doesNotMatch(node.parameters.jsCode, /\b(?:require|fetch)\s*\(|\bimport\s*\(|OPENAI_API_KEY|clientSecret|refresh_token/);
    }
  }
});

test('generated planners execute offline and attribute channel messages including the administrator audit', () => {
  for (const { mode, workflow } of workflows) {
    if (mode === 'order-updates') continue;
    for (const enabled of [false, true]) {
      const result = executeCode(workflow, 'Plan notifications', { source: fixture(workflow, mode, enabled) });
      assert.equal(result.length, 1);
      const notification = result[0].json;
      assert.equal(notification.kind, 'notification');
      assert.equal(notification.to, DESTINATION);
      assert.equal(notification.deliveryEnabled, enabled);
      assert.equal(notification.deliveryMode, 'discord');
      assert.equal(notification.intendedRecipient.email, mode === 'inventory-audit' ? 'admin.test@stockflow.local' : 'owner@stockflow.test');
      assert.match(notification.subject, /^\[TEST ROUTE\]/);
      assert.ok(notification.message.includes(`Intended owner email: ${notification.intendedRecipient.email}`));
      assert.ok(notification.message.includes('Actual testing destination: configured Discord channel.'));
    }
  }
});

test('embedded stock planners reject ambiguous identifiers before clearing remembered incidents', () => {
  for (const { mode, workflow } of workflows.filter(({ mode }) => ['low-stock', 'daily-digest', 'stale-orders'].includes(mode))) {
    for (const duplicate of ['product', 'supplier']) {
      const source = fixture(workflow, mode);
      source['Read inventory'].data[0].quantity = 6;
      if (duplicate === 'product') {
        source['Read inventory'].data.push({ ...source['Read inventory'].data[0], sku: 'DUPLICATE-RECORD' });
      } else {
        source['Read owners'].push({ id: 1, user: { name: 'Different owner', email: 'different@stockflow.test' } });
      }
      const state = { sent: { 'stock:1:11': { level: 'out', at: 1 }, unrelated: { at: 2 } } };
      const before = structuredClone(state);
      assert.throws(() => executeCode(workflow, 'Plan notifications', { source, state }), /Invalid|ambiguous/i, `${mode}: duplicate ${duplicate}`);
      assert.deepEqual(state, before, `${mode}: duplicate ${duplicate} must preserve every delivery marker`);
    }
  }
});

test('embedded stale-order planner uses catalog labels and excludes forged labels and customer data', () => {
  const { workflow } = workflows.find(({ mode }) => mode === 'stale-orders');
  const source = fixture(workflow, 'stale-orders');
  source['Read inventory'].data.push({ ...source['Read inventory'].data[0], id: 21, supplierId: 2, sku: 'OTHER-CATALOG-LABEL' });
  source['Read owners'].push({ id: 2, user: { name: 'Other owner', email: 'other@stockflow.test' } });
  Object.assign(source['Read orders'].data[0], {
    customer: { name: 'PRIVATE-CUSTOMER', email: 'private-customer@example.test' },
    totalAmount: 9234567.45,
    orderItems: [
      { productId: 11, quantity: 1, product: { id: 21, supplierId: 2, sku: 'FORGED-OTHER-OWNER-LABEL' } },
      { productId: 21, quantity: 2, product: { id: 11, supplierId: 1, sku: 'FORGED-FIRST-OWNER-LABEL' } },
    ],
  });
  const notifications = executeCode(workflow, 'Plan notifications', { source }).map(({ json }) => json);
  assert.equal(notifications.length, 2);
  const first = notifications.find(({ supplierId }) => supplierId === 1);
  const second = notifications.find(({ supplierId }) => supplierId === 2);
  assert.match(first.message, /DESK-ONE × 1/);
  assert.doesNotMatch(first.message, /OTHER-CATALOG-LABEL/);
  assert.match(second.message, /OTHER-CATALOG-LABEL × 2/);
  assert.doesNotMatch(second.message, /DESK-ONE/);
  for (const notification of notifications) {
    assert.doesNotMatch(notification.message, /FORGED-|PRIVATE-CUSTOMER|private-customer@example\.test|9234567/);
    assert.equal(notification.deliveryEnabled, false);
  }
});

test('Discord preparation preserves per-item linkage and sanitizes every post before the native node', () => {
  const { workflow } = workflows.find(({ mode }) => mode === 'low-stock');
  const source = fixture(workflow, 'low-stock', true);
  const first = executeCode(workflow, 'Plan notifications', { source })[0].json;
  const second = { ...first, supplierId: 2, intendedRecipient: { supplierId: 2, name: 'Owner @everyone <@123456789012345678>', email: 'second@stockflow.test' }, message: `${first.message}\n@here **catalog text** ${'Long details '.repeat(400)}` };
  const prepared = executeCode(workflow, 'Prepare Discord message', { items: [{ json: first }, { json: second }] });
  assert.equal(prepared.length, 2);
  for (const [index, item] of prepared.entries()) {
    assert.deepEqual(item.pairedItem, { item: index });
    assert.equal(item.json.intendedRecipient.supplierId, index + 1);
    assert.ok(item.json.discordContent.length <= 2000);
    assert.doesNotMatch(item.json.discordContent, /@|<@|\*\*catalog/);
    assert.match(item.json.discordContent, /\[at\]/);
  }
  assert.match(prepared[1].json.discordContent, /DETAILS TRUNCATED/);
  assert.equal(first.message.includes('@here'), false, 'preparation must not mutate the notification');
});

test('generated order-update workflow establishes history then retries changes until Discord confirms success', () => {
  const { workflow } = workflows.find(({ mode }) => mode === 'order-updates');
  const source = fixture(workflow, 'order-updates', true);
  const state = {};
  const first = executeCode(workflow, 'Plan notifications', { source, state });
  assert.equal(first[0].json.kind, 'summary');
  assert.match(first[0].json.note, /baseline/);
  assert.equal(state.orderBaseline.statuses[21], 'PENDING');
  source['Read orders'].data[0].status = 'PROCESSING';
  const changed = executeCode(workflow, 'Plan notifications', { source, state })[0].json;
  assert.equal(changed.to, DESTINATION);
  assert.match(changed.message, /PENDING → PROCESSING/);
  source['Delivery enabled'] = changed;
  const failed = executeCode(workflow, 'Remember successful delivery', { source, state, json: { error: 'Synthetic failure' } });
  assert.equal(failed.json.delivered, false);
  assert.equal(state.sent, undefined);
  assert.equal(executeCode(workflow, 'Plan notifications', { source, state })[0].json.kind, 'notification');
  for (const id of ['synthetic-message-id', '123', '123456789012345678901', 123456789012345678]) {
    const unconfirmed = executeCode(workflow, 'Remember successful delivery', { source, state, json: { id } });
    assert.equal(unconfirmed.json.delivered, false);
    assert.equal(state.sent, undefined);
  }
  const confirmed = executeCode(workflow, 'Remember successful delivery', { source, state, json: { id: '123456789012345678' } });
  assert.equal(confirmed.json.delivered, true);
  assert.equal(state.sent['order-update:1:21'].status, 'PROCESSING');
  assert.equal(executeCode(workflow, 'Plan notifications', { source, state })[0].json.kind, 'summary');
});

test('additional workflows read only existing order and category endpoints', () => {
  const audit = workflows.find(({ mode }) => mode === 'inventory-audit').workflow;
  const updates = workflows.find(({ mode }) => mode === 'order-updates').workflow;
  assert.match(getNode(audit, 'Read categories').parameters.url, /\/discovery\/categories/);
  assert.match(getNode(updates, 'Read orders').parameters.url, /\/orders/);
  for (const { workflow } of workflows) {
    for (const node of workflow.nodes.filter(({ type }) => type === 'n8n-nodes-base.httpRequest')) {
      assert.equal(node.parameters.method || 'GET', node.name === 'StockFlow login' ? 'POST' : 'GET');
    }
  }
});
