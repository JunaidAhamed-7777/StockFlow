import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { ROLE_AGENT_WORKFLOWS, buildRoleAgentWorkflow } from './build-agent-workflows.mjs';
import { projectRoleAgentContext } from './agent-tools.mjs';

const workflows = ROLE_AGENT_WORKFLOWS.map((definition) => ({ definition, workflow: buildRoleAgentWorkflow(definition) }));
const node = (workflow, name) => {
  const match = workflow.nodes.find((candidate) => candidate.name === name);
  assert.ok(match, `Missing ${name} in ${workflow.name}`);
  return match;
};
const execute = (workflow, name, { source = {}, input = {} } = {}) => {
  const lookup = (key) => ({ first: () => ({ json: source[key] }) });
  return new Function('$', '$input', node(workflow, name).parameters.jsCode)(lookup, { first: () => ({ json: input }) });
};
const fixture = (role) => {
  const identity = { id: role === 'SUPPLIER' ? 10 : role === 'CUSTOMER' ? 20 : 30, role, name: `${role} bound account`, email: `${role.toLowerCase()}@stockflow.local`, password: 'HASH_MUST_NEVER_REACH_MODEL', token: 'JWT_MUST_NEVER_REACH_MODEL' };
  const products = [
    { id: 11, name: 'Own product', sku: 'OWN-11', quantity: 2, lowStockThreshold: 10, price: 10, supplierId: 1, categoryId: 2, description: 'DESCRIPTION_MUST_NOT_BE_EXPOSED', supplier: { user: { password: 'HASH_MUST_NEVER_REACH_MODEL' } } },
    { id: 12, name: 'Other public product', sku: 'OTHER-12', quantity: 20, lowStockThreshold: 10, price: 500, supplierId: 3, categoryId: 2 },
  ];
  const suppliers = [
    { id: 1, userId: 10, companyName: 'Own supplier', address: 'PRIVATE_ADDRESS', user: { name: 'PRIVATE_PERSON_NAME', email: 'PRIVATE_PERSON_EMAIL', password: 'HASH_MUST_NEVER_REACH_MODEL' } },
    { id: 3, userId: 31, companyName: 'Other supplier', contactNumber: 'PRIVATE_PHONE' },
  ];
  const orders = [
    { id: 101, customerId: 20, status: 'PENDING', createdAt: '2026-10-15T10:00:00.000Z', totalAmount: 520, customer: { name: 'PRIVATE_PERSON_NAME', email: 'PRIVATE_PERSON_EMAIL', password: 'HASH_MUST_NEVER_REACH_MODEL' }, orderItems: [{ productId: 11, quantity: 2, price: 10, product: products[0] }, { productId: 12, quantity: 1, price: 500, product: products[1] }] },
    { id: 202, customerId: 21, status: 'DELIVERED', createdAt: '2026-10-14T10:00:00.000Z', totalAmount: 500, orderItems: [{ productId: 12, quantity: 1, price: 500 }] },
  ];
  const categories = [{ id: 2, name: 'Office', description: 'CATEGORY_DESCRIPTION_MUST_NOT_BE_EXPOSED' }];
  return { identity, products, suppliers, orders, categories };
};

test('three role workflows bind separate encrypted login credentials and retain the existing administrator credential', () => {
  assert.deepEqual(ROLE_AGENT_WORKFLOWS.map((definition) => definition.role), ['ADMIN', 'SUPPLIER', 'CUSTOMER']);
  assert.equal(new Set(workflows.map(({ workflow }) => workflow.id)).size, 3);
  assert.equal(new Set(workflows.map(({ workflow }) => node(workflow, 'Account login').credentials.httpCustomAuth.id)).size, 3);
  for (const { definition, workflow } of workflows) {
    const login = node(workflow, 'Account login');
    assert.deepEqual(login.credentials.httpCustomAuth, { id: definition.credentialId, name: definition.credentialName });
    assert.equal(login.parameters.authentication, 'genericCredentialType');
    assert.equal(login.parameters.genericAuthType, 'httpCustomAuth');
    assert.equal(login.parameters.jsonBody, '{}');
    assert.equal(login.parameters.sendBody, true);
  }
  assert.equal(node(workflows[0].workflow, 'Account login').credentials.httpCustomAuth.id, 'StockFlowApiLogin01');
  assert.throws(() => buildRoleAgentWorkflow({ ...ROLE_AGENT_WORKFLOWS[0], role: 'CUSTOMER' }), /Unknown role tool/);
});

test('agent callers may supply search only; identity, role, credentials and network destinations are not workflow inputs', () => {
  for (const { workflow } of workflows) {
    const trigger = node(workflow, 'Agent tool input');
    assert.equal(trigger.type, 'n8n-nodes-base.executeWorkflowTrigger');
    assert.equal(trigger.parameters.inputSource, 'workflowInputs');
    assert.deepEqual(trigger.parameters.workflowInputs.values, [{ name: 'search', type: 'string' }]);
    assert.equal(workflow.nodes.some((candidate) => /webhook|scheduleTrigger|chatTrigger/.test(candidate.type)), false);
    assert.equal(workflow.settings.callerPolicy, 'workflowsFromSameOwner');
    assert.equal(workflow.active, false);
  }
});

test('Scope code ignores forged actor, role, JWT and API base URL and enforces bounded search type', () => {
  for (const { definition, workflow } of workflows) {
    const malicious = { search: 'desk', role: 'ADMIN', actor: { id: 30, role: 'ADMIN' }, identity: { id: 30, role: 'ADMIN' }, token: 'FORGED_JWT', authorization: 'Bearer FORGED_JWT', apiBaseUrl: 'https://attacker.test/api', url: 'file:///private', supplierId: 3, customerId: 21 };
    assert.deepEqual(execute(workflow, 'Scope', { input: malicious }), [{ json: { role: definition.role, search: 'desk', apiBaseUrl: 'http://host.docker.internal:3001/api' } }]);
    assert.equal(execute(workflow, 'Scope', { input: {} })[0].json.search, '');
    assert.equal(execute(workflow, 'Scope', { input: { search: 'x'.repeat(120) } })[0].json.search.length, 120);
    for (const search of [1, true, [], {}, 'x'.repeat(121)]) assert.throws(() => execute(workflow, 'Scope', { input: { search } }), /Search must be a string/);
    const codeLikeSearch = "'); globalThis.stolen = true; //";
    assert.equal(execute(workflow, 'Scope', { input: { search: codeLikeSearch } })[0].json.search, codeLikeSearch);
    assert.equal(globalThis.stolen, undefined);
  }
});

test('HTTP tools can only log in or read the declared existing local StockFlow endpoints', () => {
  const allowedGet = new Set(['/auth/me', '/products', '/discovery/suppliers', '/discovery/categories', '/orders']);
  for (const { definition, workflow } of workflows) {
    const http = workflow.nodes.filter((candidate) => candidate.type === 'n8n-nodes-base.httpRequest');
    assert.equal(http.length, definition.role === 'CUSTOMER' ? 5 : 6);
    for (const request of http) {
      const method = request.parameters.method || 'GET';
      const endpoint = /\+ '(\/[^']*)'/.exec(request.parameters.url)?.[1];
      assert.ok(endpoint, 'HTTP URL must use a fixed literal API path');
      assert.match(request.parameters.url, /^=\{\{ \$\('Scope'\)\.first\(\)\.json\.apiBaseUrl \+ '\/[^']+' \}\}$/);
      if (request.name === 'Account login') {
        assert.equal(method, 'POST');
        assert.equal(endpoint, '/auth/login');
      } else {
        assert.equal(method, 'GET');
        assert.ok(allowedGet.has(endpoint), `Unexpected API tool ${endpoint}`);
        assert.deepEqual(request.parameters.headerParameters.parameters, [{ name: 'Authorization', value: "={{ 'Bearer ' + $('Account login').first().json.data.token }}" }]);
        assert.equal(request.parameters.sendBody, undefined);
      }
      assert.equal(request.parameters.options.timeout, 15000);
      assert.doesNotMatch(request.parameters.url, /\$json|\$fromAI|localhost:5678|\/orders\/|\/stock\/adjust|\/auth\/register/);
    }
    if (definition.role === 'CUSTOMER') assert.equal(http.some((request) => request.name === 'Resolve suppliers'), false);
  }
});

test('every path to private order reads crosses authenticated identity verification and role assertion first', () => {
  for (const { workflow } of workflows) {
    const walk = (name, path = []) => {
      assert.equal(path.includes(name), false, 'Role tools must have no execution cycle');
      const visited = [...path, name];
      if (name === 'Read scoped orders') {
        for (const prerequisite of ['Account login', 'Verify account', 'Assert account role']) assert.ok(visited.includes(prerequisite), `Missing prerequisite ${prerequisite}`);
        assert.ok(visited.indexOf('Account login') < visited.indexOf('Verify account'));
        assert.ok(visited.indexOf('Verify account') < visited.indexOf('Assert account role'));
        assert.ok(visited.indexOf('Assert account role') < visited.indexOf('Read scoped orders'));
      }
      for (const branch of workflow.connections[name]?.main || []) for (const next of branch) walk(next.node, visited);
    };
    walk('Agent tool input');
    walk('Manual verification');
    const incoming = Object.entries(workflow.connections).flatMap(([from, value]) => value.main.flatMap((branch) => branch.filter((next) => next.node === 'Read catalog').map(() => from)));
    assert.deepEqual(incoming, ['Assert account role']);
  }
});

test('role assertion fails on a mismatched account before any private record is read', () => {
  for (const { definition, workflow } of workflows) {
    const identity = fixture(definition.role).identity;
    const result = execute(workflow, 'Assert account role', { input: { data: identity } });
    assert.deepEqual(result, [{ json: { identity: { id: identity.id, name: identity.name, email: identity.email, role: identity.role } } }]);
    assert.doesNotMatch(JSON.stringify(result), /HASH_MUST_NEVER|JWT_MUST_NEVER/);
    for (const data of [undefined, null, {}, { ...identity, role: 'ATTACKER' }, { ...identity, id: 0 }, { ...identity, id: '10' }]) assert.throws(() => execute(workflow, 'Assert account role', { input: { data } }), /configured account does not match/);
  }
});

test('every embedded Code node compiles and has no external imports, network access or model API calls', () => {
  for (const { workflow } of workflows) {
    for (const code of workflow.nodes.filter((candidate) => candidate.type === 'n8n-nodes-base.code')) {
      assert.doesNotThrow(() => new Function('$', '$input', code.parameters.jsCode), `${workflow.name}: ${code.name}`);
      assert.doesNotMatch(code.parameters.jsCode, /\b(?:fetch|require|axios|XMLHttpRequest)\s*\(|\bimport\s*(?:\(|\{)|OPENAI_API_KEY|api\.openai\.com/);
    }
  }
});

test('final workflow code executes the actual pure projector and strips raw hashes, tokens and unrelated private records', () => {
  for (const { definition, workflow } of workflows) {
    const raw = fixture(definition.role);
    const identity = execute(workflow, 'Assert account role', { input: { data: raw.identity } })[0].json.identity;
    const source = {
      'Assert account role': { identity },
      Scope: { role: 'FORGED_ROLE_IS_IGNORED', token: 'FORGED_TOKEN_IS_IGNORED', apiBaseUrl: 'https://attacker.test', search: '' },
      'Read catalog': { success: true, data: raw.products },
      'Resolve suppliers': { success: true, data: raw.suppliers },
      'Read categories': { success: true, data: raw.categories },
      'Read scoped orders': { success: true, data: raw.orders },
    };
    const [item] = execute(workflow, 'Project safe role context', { source });
    const expected = projectRoleAgentContext({ role: definition.role, identity, search: '', products: raw.products, suppliers: definition.role === 'CUSTOMER' ? [] : raw.suppliers, categories: raw.categories, orders: raw.orders });
    assert.deepEqual(item.json, expected);
    assert.doesNotMatch(JSON.stringify(item.json), /HASH_MUST_NEVER|JWT_MUST_NEVER|PRIVATE_PERSON|PRIVATE_ADDRESS|PRIVATE_PHONE|DESCRIPTION_MUST_NOT|FORGED_ROLE|FORGED_TOKEN|attacker\.test/);
    assert.ok(JSON.stringify(item.json).length <= 30000);
    if (definition.role === 'SUPPLIER') {
      assert.equal(item.json.catalog.items.length, 1);
      assert.equal(item.json.catalog.items[0].supplierId, 1);
      assert.equal(item.json.orders.items.length, 1);
      assert.equal(item.json.orders.items[0].supplierSubtotal, 20);
      assert.equal(item.json.orders.items[0].totalAmount, undefined);
      assert.doesNotMatch(JSON.stringify(item.json), /Other public product|OTHER-12/);
    }
    if (definition.role === 'CUSTOMER') {
      assert.deepEqual(item.json.orders.items.map((order) => order.id), [101]);
      assert.equal(item.json.account.id, 20);
    }
    // The native HTTP node may return a top-level JSON array; both shapes are handled.
    source['Read catalog'] = raw.products;
    source['Read categories'] = raw.categories;
    source['Read scoped orders'] = raw.orders;
    if (definition.role !== 'CUSTOMER') source['Resolve suppliers'] = raw.suppliers;
    assert.deepEqual(execute(workflow, 'Project safe role context', { source })[0].json, expected);
  }
});

test('workflow exports contain encrypted credential references only and disable persistence of JWT-bearing execution data', () => {
  for (const { definition, workflow } of workflows) {
    const serialized = JSON.stringify(workflow);
    assert.doesNotMatch(serialized, /sk-(?:proj-)?[A-Za-z0-9_-]{20,}|Bearer eyJ|"password"\s*:|"clientSecret"\s*:|"refresh_token"\s*:|https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/webhooks\//);
    assert.deepEqual(workflow.pinData, {});
    assert.equal(workflow.staticData, null);
    assert.equal(workflow.settings.saveDataSuccessExecution, 'none');
    assert.equal(workflow.settings.saveDataErrorExecution, 'none');
    assert.equal(workflow.settings.saveManualExecutions, false);
    assert.equal(workflow.settings.saveExecutionProgress, false);
    assert.equal(workflow.settings.executionTimeout, 90);
    const file = new URL(`./agent-workflows/stockflow-${definition.role.toLowerCase()}-tool.json`, import.meta.url);
    if (existsSync(file)) assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), workflow, 'Tracked workflow must match its builder');
  }
});
