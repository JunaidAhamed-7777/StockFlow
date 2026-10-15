import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WORKFLOW_MODES, assertMatchingPreviewWorkflow, assertSafePreviewSource, summarizePreviewItem, createPreviewReport, verifyLocalPreviews } from './verify-local.mjs';

const source = (mode) => JSON.parse(readFileSync(new URL(`./workflows/stockflow-${mode}.json`, import.meta.url), 'utf8'));
const find = (workflow, name) => workflow.nodes.find((node) => node.name === name);

test('verifier covers all five known disabled workflow templates without running Docker on import', () => {
  assert.equal(Object.keys(WORKFLOW_MODES).length, 5);
  for (const [id, mode] of Object.entries(WORKFLOW_MODES)) {
    const expected = source(mode);
    assert.equal(expected.id, id);
    assert.doesNotThrow(() => assertSafePreviewSource(expected, mode));
    assert.doesNotThrow(() => assertMatchingPreviewWorkflow(expected, structuredClone(expected)));
  }
});

test('any enabled settings fail even if installed workflow and edited source both enable delivery', () => {
  const edited = source('low-stock');
  find(edited, 'Settings').parameters.jsCode = find(edited, 'Settings').parameters.jsCode.replace('notificationsEnabled: false', 'notificationsEnabled: true');
  assert.throws(() => assertMatchingPreviewWorkflow(edited, structuredClone(edited)), /disabled-delivery preview template/);
});

test('actual Discord transport changes are rejected while Settings still disables delivery', () => {
  const expected = source('low-stock');
  for (const change of [
    (discord) => { discord.parameters.operation = 'send'; },
    (discord) => { discord.parameters.authentication = 'botToken'; },
    (discord) => { discord.parameters.content = '={{ $json.message }}'; },
    (discord) => { discord.parameters.webhookUri = 'https://attacker.example'; },
    (discord) => { discord.parameters.options.wait = false; },
    (discord) => { discord.parameters.options.flags = []; },
    (discord) => { discord.parameters.options.tts = true; },
    (discord) => { discord.type = 'n8n-nodes-base.httpRequest'; },
    (discord) => { discord.retryOnFail = true; },
    (discord) => { discord.executeOnce = true; },
  ]) {
    const actual = structuredClone(expected);
    change(find(actual, 'Send Discord notification'));
    assert.throws(() => assertMatchingPreviewWorkflow(expected, actual), /notification transport, code, settings, pinned data, or routing differ/);
  }
});

test('source Discord node also must use the fixed native webhook transport', () => {
  const edited = source('low-stock');
  find(edited, 'Send Discord notification').parameters.operation = 'send';
  assert.throws(() => assertMatchingPreviewWorkflow(edited, structuredClone(edited)), /disabled-delivery preview template/);
});

test('source also rejects stray Gmail nodes or a graph that bypasses Discord preparation', () => {
  const stray = source('low-stock');
  stray.nodes.push({ id: 'extra-gmail', name: 'Extra Gmail', type: 'n8n-nodes-base.gmail', typeVersion: 2.2, parameters: {} });
  assert.throws(() => assertMatchingPreviewWorkflow(stray, structuredClone(stray)), /disabled-delivery preview template/);
  const bypass = source('low-stock');
  bypass.connections['Delivery enabled'].main[0][0].node = 'Send Discord notification';
  assert.throws(() => assertMatchingPreviewWorkflow(bypass, structuredClone(bypass)), /disabled-delivery preview template/);
});

test('every Code node, IF, API request, connections, and pinned data are fingerprinted', () => {
  const expected = source('order-updates');
  const changes = [
    ...expected.nodes.filter((node) => node.type === 'n8n-nodes-base.code').map((node) => (actual) => { find(actual, node.name).parameters.jsCode += '\n// edited'; }),
    (actual) => { find(actual, 'Delivery enabled').parameters.conditions.conditions[0].leftValue = '={{ true }}'; },
    (actual) => { find(actual, 'Read orders').parameters.url = 'http://another-host/api/orders'; },
    (actual) => { actual.connections['Plan notifications'].main[0][0].node = 'Send Discord notification'; },
    (actual) => { actual.pinData = { 'Plan notifications': [{ json: { deliveryEnabled: true } }] }; },
    (actual) => { actual.settings.errorWorkflow = 'ExternalNotificationWorkflow'; },
    (actual) => { actual.nodes.push({ id: 'extra-send', name: 'Extra Gmail', type: 'n8n-nodes-base.gmail', typeVersion: 2.2, parameters: {} }); },
  ];
  for (const change of changes) {
    const actual = structuredClone(expected);
    change(actual);
    assert.throws(() => assertMatchingPreviewWorkflow(expected, actual), /differ/);
  }
});

test('only UI placement, display notes, and the native Discord credential attachment may differ', () => {
  const expected = source('inventory-audit');
  const actual = structuredClone(expected);
  find(actual, 'Send Discord notification').credentials = { discordWebhookApi: { id: 'ConnectedWebhook', name: 'Local Discord channel' } };
  find(actual, 'Setup and behavior').parameters.content += '\nLocal setup note.';
  find(actual, 'Plan notifications').position = [999, 999];
  actual.staticData = { global: { sent: { 'inventory-audit:admin': { week: '2026-10-12' } } } };
  assert.doesNotThrow(() => assertMatchingPreviewWorkflow(expected, actual));
  find(actual, 'StockFlow login').credentials.httpCustomAuth.id = 'DifferentApiIdentity';
  assert.throws(() => assertMatchingPreviewWorkflow(expected, actual), /differ/, 'API credential references must remain fingerprinted');
});

test('JSON object key order from n8n storage does not weaken or falsely fail the fingerprint', () => {
  const expected = source('daily-digest');
  const reorder = (value) => Array.isArray(value) ? value.map(reorder) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).reverse().map(([key, entry]) => [key, reorder(entry)])) : value;
  assert.doesNotThrow(() => assertMatchingPreviewWorkflow(expected, reorder(expected)));
});

test('preview summaries preserve intended recipient and actual destination while discarding JWT and source responses', () => {
  const summary = summarizePreviewItem({ json: {
    mode: 'low-stock', deliveryEnabled: false, deliveryMode: 'discord', to: 'discord-channel',
    intendedRecipient: { supplierId: 1, name: 'Owner', email: 'owner@stockflow.test', token: 'SHOULD-BE-DISCARDED' },
    supplierId: 1, eventCount: 2, skipped: [{ supplierId: 2, reason: 'Missing email', token: 'SHOULD-BE-DISCARDED' }],
    data: { token: 'SECRET-JWT' }, token: 'SECRET-JWT', authorization: 'Bearer SECRET-JWT', note: 'Preview only.',
  } });
  assert.equal(summary.to, 'discord-channel');
  assert.deepEqual(summary.intendedRecipient, { supplierId: 1, name: 'Owner', email: 'owner@stockflow.test' });
  assert.doesNotMatch(JSON.stringify(summary), /SECRET|DISCARDED|authorization|token/);
});

const execution = () => ({ finished: true, status: 'success', data: { resultData: {
  lastNodeExecuted: 'Preview only', runData: {
    'StockFlow login': [{ executionStatus: 'success', data: { main: [[{ json: { token: 'PRIVATE_FIXTURE_JWT' } }]] } }],
    'Preview only': [{ executionStatus: 'success', data: { main: [[{ json: { mode: 'low-stock', deliveryMode: 'discord', deliveryEnabled: false, to: 'discord-channel', eventCount: 1 } }]] } }],
  },
} } });
const result = (value) => ({ status: 0, stdout: `[fixture CLI setup]\n${JSON.stringify(value)}\nFixture shutdown complete.` });

test('safe preview reports parse noisy CLI envelopes and exclude raw login responses', () => {
  const report = createPreviewReport(source('low-stock'), result(execution()));
  assert.equal(report.success, true); assert.equal(report.lastNode, 'Preview only');
  assert.equal(report.notificationCalls, 0); assert.equal(report.gmailCalls, 0); assert.equal(report.openAiCalls, 0);
  assert.doesNotMatch(JSON.stringify(report), /PRIVATE|JWT|token|runData/);
});

test('zero-exit failures, unfinished runs, unexpected last nodes and malformed preview artifacts cannot count as success', () => {
  const mutate = [
    (run) => { run.status = 'error'; },
    (run) => { run.finished = false; },
    (run) => { run.error = { message: 'PRIVATE_FIXTURE_ERROR' }; },
    (run) => { run.data.resultData.error = { message: 'PRIVATE_FIXTURE_ERROR' }; },
    (run) => { run.data.resultData.lastNodeExecuted = 'Plan notifications'; },
    (run) => { run.data.resultData.runData['Preview only'][0].executionStatus = 'error'; },
    (run) => { run.data.resultData.runData['Preview only'][0].error = { message: 'PRIVATE_FIXTURE_ERROR' }; },
    (run) => { run.data.resultData.runData['Preview only'][0].data.main = {}; },
    (run) => { run.data.resultData.runData['Preview only'][0].data.main = [null]; },
    (run) => { run.data.resultData.runData['Preview only'][0].data.main[0][0].json.error = 'PRIVATE_FIXTURE_ERROR'; },
    ...[true, 'false', 'true', 0, null, undefined].map((value) => (run) => { run.data.resultData.runData['Preview only'][0].data.main[0][0].json.deliveryEnabled = value; }),
    (run) => { run.data.resultData.runData['Unknown side effect'] = []; },
    (run) => { run.data.resultData.runData['Plan notifications'] = []; },
  ];
  for (const change of mutate) {
    const run = execution(); change(run);
    const report = createPreviewReport(source('low-stock'), result(run));
    assert.equal(report.success, false);
    assert.doesNotMatch(JSON.stringify(report), /PRIVATE|JWT|token|runData/);
  }
});

test('observed notification, Gmail and model nodes fail closed and are counted even with preview output', () => {
  for (const [name, field] of [['Send Discord notification', 'notificationCalls'], ['Gmail send', 'gmailCalls'], ['OpenAI language model', 'openAiCalls']]) {
    const run = execution(); run.data.resultData.runData[name] = [{ data: { main: [[{ json: { token: 'PRIVATE_FIXTURE_JWT' } }]] } }];
    const report = createPreviewReport(source('low-stock'), result(run));
    assert.equal(report.success, false); assert.equal(report[field], 1);
    assert.doesNotMatch(JSON.stringify(report), /PRIVATE|JWT|token/);
  }
});

test('every delivery-path artifact fails closed, including empty arrays that report no confirmed send', () => {
  for (const name of ['Prepare Discord message', 'Send Discord notification', 'Remember successful delivery']) {
    for (const rows of [[], [{ executionStatus: 'success' }]]) {
      const run = execution(); run.data.resultData.runData[name] = rows;
      assert.equal(createPreviewReport(source('low-stock'), result(run)).success, false);
    }
  }
});

function offlineVerifier() {
  const installed = new Map(Object.entries(WORKFLOW_MODES).map(([id, mode]) => [id, source(mode)]));
  const checks = [], executions = [], saved = [], logs = [];
  const options = {
    readWorkflow: source, assertLocal: () => {},
    inspectWorkflow: (expected) => { checks.push(expected.id); assertMatchingPreviewWorkflow(expected, installed.get(expected.id)); },
    executeWorkflow: (id) => { executions.push(id); return result(execution()); },
    writeReport: (value) => saved.push(value), log: (value) => logs.push(value),
  };
  return { installed, checks, executions, saved, logs, options };
}

test('all five installed graphs are checked before execution and each is rechecked immediately before its preview', () => {
  const f = offlineVerifier();
  const reports = verifyLocalPreviews(f.options);
  assert.equal(reports.length, 5); assert.ok(reports.every((entry) => entry.success));
  assert.deepEqual(f.checks.slice(0, 5), [...f.installed.keys()]);
  assert.deepEqual(f.checks.slice(5), f.executions);
  assert.equal(f.saved.length, 1);
  assert.doesNotMatch(JSON.stringify([f.saved, f.logs]), /PRIVATE|JWT|token|runData/);
});

test('one enabled or pinned workflow blocks the entire preflight before any execution', () => {
  for (const mutate of [
    (workflow) => { find(workflow, 'Settings').parameters.jsCode = find(workflow, 'Settings').parameters.jsCode.replace('notificationsEnabled: false', 'notificationsEnabled: true'); },
    (workflow) => { workflow.pinData = { 'Delivery enabled': [{ json: { deliveryEnabled: true } }] }; },
  ]) {
    const f = offlineVerifier(); mutate(f.installed.get('StockFlowUpdates01'));
    assert.throws(() => verifyLocalPreviews(f.options), /differ/);
    assert.deepEqual(f.executions, []); assert.deepEqual(f.saved, []);
  }
});

test('an edit after preflight is caught by the immediate recheck; an unsafe execution stops further previews', () => {
  const f = offlineVerifier();
  f.options.executeWorkflow = (id) => {
    f.executions.push(id); f.installed.get('StockFlowDigest01').pinData = { Settings: [{ json: {} }] }; return result(execution());
  };
  assert.throws(() => verifyLocalPreviews(f.options), /differ/);
  assert.deepEqual(f.executions, ['StockFlowCritical01']);
  const failed = offlineVerifier();
  failed.options.executeWorkflow = (id) => { failed.executions.push(id); const run = execution(); run.finished = false; return result(run); };
  const reports = verifyLocalPreviews(failed.options);
  assert.equal(reports.length, 1); assert.equal(reports[0].success, false);
  assert.deepEqual(failed.executions, ['StockFlowCritical01']);
});

test('thrown subprocess errors produce one generic failed report without exposing credential-bearing text', () => {
  const f = offlineVerifier();
  f.options.executeWorkflow = (id) => { f.executions.push(id); throw new Error('PRIVATE_FIXTURE_JWT Bearer raw-token'); };
  const reports = verifyLocalPreviews(f.options);
  assert.equal(reports.length, 1); assert.equal(reports[0].success, false);
  assert.deepEqual(f.executions, ['StockFlowCritical01']);
  assert.doesNotMatch(JSON.stringify([reports, f.logs, f.saved]), /PRIVATE|JWT|Bearer|raw-token/);
});
