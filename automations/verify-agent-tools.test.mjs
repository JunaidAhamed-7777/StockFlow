import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLE_AGENT_WORKFLOWS, buildRoleAgentWorkflow } from './build-agent-workflows.mjs';
import { assertMatchingRoleTool, summarizeRoleToolContext, summarizeRoleToolRun, verifyRoleAgentTools } from './verify-agent-tools.mjs';

const definition = ROLE_AGENT_WORKFLOWS[0];
const context = (role = 'ADMIN') => ({ schemaVersion: 1, access: 'read-only', role, account: { id: 1, supplierId: 2, role, email: 'private@example.test', password: 'DO-NOT-LOG' }, scope: { supplierId: 2, customerId: 1 }, catalog: { totalCount: 44, matchedCount: 44, returnedCount: 40, items: [{ token: 'DO-NOT-LOG' }] }, inventory: { productCount: 44, lowStockCount: 2, criticalStockCount: 0, outOfStockCount: 0 }, orders: { totalCount: 1, returnedCount: 1 }, categories: { totalCount: 2 }, suppliers: { totalCount: 5 }, token: 'DO-NOT-LOG' });
const run = (item = context()) => ({ data: { resultData: { lastNodeExecuted: 'Project safe role context', runData: Object.fromEntries(['Manual verification', 'Scope', 'Account login', 'Verify account', 'Assert account role', 'Read catalog', 'Read categories', 'Read scoped orders', 'Project safe role context'].map((name) => [name, [{ data: { main: [[{ json: name === 'Project safe role context' ? item : { token: 'DO-NOT-LOG' } }]] } }]])) } } });

test('all three installed tools must match their builder before execution is possible', () => {
  for (const item of ROLE_AGENT_WORKFLOWS) assert.doesNotThrow(() => assertMatchingRoleTool(item, buildRoleAgentWorkflow(item)));
  const changes = [
    (workflow) => { workflow.nodes.find((node) => node.name === 'Account login').credentials.httpCustomAuth.id = 'DifferentAccount'; },
    (workflow) => { workflow.nodes.find((node) => node.name === 'Read catalog').parameters.method = 'DELETE'; },
    (workflow) => { workflow.nodes.find((node) => node.name === 'Read catalog').parameters.url = 'https://other.example'; },
    (workflow) => { workflow.nodes.find((node) => node.name === 'Scope').parameters.jsCode += '\nthrow new Error("edited");'; },
    (workflow) => { workflow.nodes.push({ name: 'Send mail', type: 'n8n-nodes-base.gmail' }); },
    (workflow) => { workflow.connections.Scope.main[0][0].node = 'Read catalog'; },
    (workflow) => { workflow.settings.errorWorkflow = 'UnexpectedMailer'; },
    (workflow) => { workflow.settings.saveDataSuccessExecution = 'all'; },
    (workflow) => { workflow.settings.availableInMCP = true; },
    (workflow) => { workflow.pinData = { 'Assert account role': [{ json: { role: 'ADMIN' } }] }; },
  ];
  for (const change of changes) {
    const modified = buildRoleAgentWorkflow(definition);
    change(modified);
    assert.throws(() => assertMatchingRoleTool(definition, modified), /differs from its read-only builder/);
  }
});

test('UI positions, notes and disabled MCP discovery defaults do not change execution fingerprints', () => {
  const workflow = buildRoleAgentWorkflow(definition);
  workflow.nodes[0].position = [999, 999];
  workflow.nodes[0].notes = 'Operator note';
  workflow.nodes[0].notesInFlow = true;
  workflow.settings.availableInMCP = false;
  assert.doesNotThrow(() => assertMatchingRoleTool(definition, workflow));
});

test('redacted context reports contain only validated enums, booleans and counts', () => {
  for (const item of ROLE_AGENT_WORKFLOWS) {
    const summary = summarizeRoleToolContext(context(item.role), item.role);
    assert.equal(summary.role, item.role);
    assert.equal(summary.accountScopeVerified, true);
    assert.equal(summary.inventoryProducts, 44);
    assert.doesNotMatch(JSON.stringify(summary), /DO-NOT-LOG|private|password|token|email|items/);
  }
  for (const change of [value => { value.role = 'SUPPLIER'; }, value => { value.access = 'write'; }, value => { value.catalog.totalCount = 'DO-NOT-LOG'; }, value => { value.orders.returnedCount = -1; }, value => { value.account.id = 0; }]) {
    const value = context(); change(value);
    assert.throws(() => summarizeRoleToolContext(value, 'ADMIN'), (error) => !error.message.includes('DO-NOT-LOG'));
  }
  assert.throws(() => summarizeRoleToolContext({ ...context('CUSTOMER'), scope: { customerId: 9 } }, 'CUSTOMER'), /ownership scope/);
});

test('CLI success requires the final projection and completed account checks', () => {
  const result = summarizeRoleToolRun(definition, run(), 0);
  assert.equal(result.success, true);
  assert.equal(result.openAiCalls, 0);
  assert.doesNotMatch(JSON.stringify(result), /DO-NOT-LOG|token|email/);
  const wrongNode = run(); wrongNode.data.resultData.lastNodeExecuted = 'Read catalog';
  assert.throws(() => summarizeRoleToolRun(definition, wrongNode, 0), /final projection/);
  const failed = run(); failed.data.resultData.runData['Verify account'][0].error = { message: 'DO-NOT-LOG' };
  assert.throws(() => summarizeRoleToolRun(definition, failed, 0), (error) => !error.message.includes('DO-NOT-LOG'));
  const stray = run(); stray.data.resultData.runData['Unexpected sender'] = [{}];
  assert.throws(() => summarizeRoleToolRun(definition, stray, 0), /Unexpected node/);
});

test('all-tool preflight and immediate recheck prevent any execution after a fingerprint mismatch', () => {
  let calls = 0;
  assert.throws(() => verifyRoleAgentTools({ verifyLocal() {}, persist: false, log() {}, inspect(item) { const value = buildRoleAgentWorkflow(item); if (item.role === 'CUSTOMER') value.settings.errorWorkflow = 'SendMail'; return value; }, execute() { calls++; } }), /differs/);
  assert.equal(calls, 0);
  let inspections = 0;
  assert.throws(() => verifyRoleAgentTools({ verifyLocal() {}, persist: false, log() {}, inspect(item) { const value = buildRoleAgentWorkflow(item); if (++inspections === 4) value.nodes[0].disabled = true; return value; }, execute() { calls++; } }), /differs/);
  assert.equal(calls, 0);
});

test('failed executions stop subsequent tool runs and redact thrown subprocess messages', () => {
  let executions = 0;
  const reports = verifyRoleAgentTools({ verifyLocal() {}, persist: false, log() {}, inspect: buildRoleAgentWorkflow, execute() { executions++; throw new Error('Bearer DO-NOT-LOG'); } });
  assert.equal(executions, 1);
  assert.equal(reports[0].success, false);
  assert.doesNotMatch(JSON.stringify(reports), /DO-NOT-LOG|Bearer/);
});
