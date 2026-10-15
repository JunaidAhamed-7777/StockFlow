import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const REDIRECT_TO = 'junuhammad2@gmail.com';
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
    Settings: { ...settings, mailEnabled: enabled },
    'Read inventory': { data: [product] },
    'Read owners': [{ id: 1, companyName: 'Demo stock owner', user: { name: 'Demo Owner', email: 'owner@stockflow.test' } }],
    'Read categories': { data: [{ id: 1, name: 'Office' }] },
    'Read orders': { data: [{ id: 21, status: 'PENDING', createdAt: new Date(Date.now() - 72 * 3600000).toISOString(), orderItems: [{ productId: 11, quantity: 1 }] }] },
  };
  return source;
};

test('all five workflow templates default to preview and have fixed recipient Gmail transports', () => {
  assert.equal(new Set(workflows.map(({ workflow }) => workflow.id)).size, 5);
  for (const { workflow } of workflows) {
    const settings = executeCode(workflow, 'Settings')[0].json;
    assert.equal(settings.deliveryMode, 'redirect');
    assert.equal(settings.redirectTo, REDIRECT_TO);
    assert.equal(settings.mailEnabled, false);
    assert.equal(workflow.active, false);
    const mailNodes = workflow.nodes.filter((node) => node.type === 'n8n-nodes-base.gmail');
    assert.equal(mailNodes.length, 1);
    assert.equal(mailNodes[0].parameters.sendTo, REDIRECT_TO);
    assert.equal(mailNodes[0].parameters.operation, 'send');
    assert.equal(mailNodes[0].parameters.options.appendAttribution, false);
    assert.ok(!Object.keys(mailNodes[0].parameters.options).some((key) => /cc|bcc|senderName/i.test(key)));
    assert.ok(!Object.hasOwn(mailNodes[0].parameters, 'cc'));
    assert.ok(!Object.hasOwn(mailNodes[0].parameters, 'bcc'));
    assert.equal(workflow.settings.timezone, 'Asia/Kolkata');
    assert.equal(workflow.settings.saveDataSuccessExecution, 'none');
    assert.equal(workflow.settings.saveDataErrorExecution, 'none');
    assert.equal(workflow.settings.saveManualExecutions, false);
    assert.equal(workflow.settings.saveExecutionProgress, false);
  }
});

test('delivery guards reject owner routing, changed destinations, and missing recipient attribution', () => {
  const valid = { kind: 'notification', deliveryEnabled: true, deliveryMode: 'redirect', to: REDIRECT_TO, intendedRecipient: { name: 'Owner', email: 'owner@stockflow.test', supplierId: 1 } };
  for (const { workflow } of workflows) {
    const condition = getNode(workflow, 'Delivery enabled').parameters.conditions.conditions[0];
    const evaluate = new Function('$json', `return ${condition.leftValue.slice(3, -2).trim()}`);
    assert.equal(evaluate(valid), true);
    for (const patch of [
      { kind: 'summary' }, { deliveryEnabled: false }, { deliveryEnabled: 'true' },
      { deliveryMode: 'owner' }, { deliveryMode: 'preview' }, { to: 'owner@actual-owner.com' },
      { to: `${REDIRECT_TO},owner@actual-owner.com` }, { intendedRecipient: undefined },
      { intendedRecipient: {} }, { intendedRecipient: { name: 'Owner', email: '', supplierId: 1 } },
      { intendedRecipient: { name: 'Owner', email: 'owner@stockflow.test', supplierId: '1' } },
    ]) assert.equal(evaluate({ ...valid, ...patch }), false, JSON.stringify(patch));
    const incoming = Object.entries(workflow.connections).flatMap(([from, value]) => value.main.flatMap((branch, index) => branch.filter(({ node }) => node === 'Send owner Gmail').map(() => ({ from, branch: index }))));
    assert.deepEqual(incoming, [{ from: 'Delivery enabled', branch: 0 }]);
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

test('generated planners execute offline and attribute redirected messages including the administrator audit', () => {
  for (const { mode, workflow } of workflows) {
    if (mode === 'order-updates') continue;
    for (const enabled of [false, true]) {
      const result = executeCode(workflow, 'Plan notifications', { source: fixture(workflow, mode, enabled) });
      assert.equal(result.length, 1);
      const mail = result[0].json;
      assert.equal(mail.kind, 'notification');
      assert.equal(mail.to, REDIRECT_TO);
      assert.equal(mail.deliveryEnabled, enabled);
      assert.equal(mail.deliveryMode, 'redirect');
      assert.equal(mail.intendedRecipient.email, mode === 'inventory-audit' ? 'admin.test@stockflow.local' : 'owner@stockflow.test');
      assert.match(mail.subject, /^\[REDIRECTED\]/);
      assert.ok(mail.message.includes(`Intended owner email: ${mail.intendedRecipient.email}`));
      assert.ok(mail.message.includes(`Actual testing destination: ${REDIRECT_TO}`));
    }
  }
});

test('generated order-update workflow establishes history then retries changes until Gmail confirms success', () => {
  const { workflow } = workflows.find(({ mode }) => mode === 'order-updates');
  const source = fixture(workflow, 'order-updates', true);
  const state = {};
  const first = executeCode(workflow, 'Plan notifications', { source, state });
  assert.equal(first[0].json.kind, 'summary');
  assert.match(first[0].json.note, /baseline/);
  assert.equal(state.orderBaseline.statuses[21], 'PENDING');
  source['Read orders'].data[0].status = 'PROCESSING';
  const changed = executeCode(workflow, 'Plan notifications', { source, state })[0].json;
  assert.equal(changed.to, REDIRECT_TO);
  assert.match(changed.message, /PENDING → PROCESSING/);
  source['Delivery enabled'] = changed;
  const failed = executeCode(workflow, 'Remember successful delivery', { source, state, json: { error: 'Synthetic failure' } });
  assert.equal(failed.json.delivered, false);
  assert.equal(state.sent, undefined);
  assert.equal(executeCode(workflow, 'Plan notifications', { source, state })[0].json.kind, 'notification');
  const confirmed = executeCode(workflow, 'Remember successful delivery', { source, state, json: { id: 'synthetic-message-id' } });
  assert.equal(confirmed.json.delivered, true);
  assert.equal(state.sent['order-update:1:21'].status, 'PROCESSING');
  assert.equal(executeCode(workflow, 'Plan notifications', { source, state })[0].json.kind, 'summary');
});

test('additional workflows read only existing order and category endpoints', () => {
  const audit = workflows.find(({ mode }) => mode === 'inventory-audit').workflow;
  const updates = workflows.find(({ mode }) => mode === 'order-updates').workflow;
  assert.match(getNode(audit, 'Read categories').parameters.url, /\/discovery\/categories/);
  assert.equal(getNode(audit, 'Schedule').parameters.rule.interval[0].expression, '0 30 9 * * 1');
  assert.match(getNode(updates, 'Read orders').parameters.url, /\/orders/);
  assert.equal(getNode(updates, 'Schedule').parameters.rule.interval[0].minutesInterval, 15);
  for (const { workflow } of workflows) {
    for (const node of workflow.nodes.filter(({ type }) => type === 'n8n-nodes-base.httpRequest')) {
      assert.equal(node.parameters.method || 'GET', node.name === 'StockFlow login' ? 'POST' : 'GET');
    }
  }
});
