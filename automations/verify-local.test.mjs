import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WORKFLOW_MODES, assertMatchingPreviewWorkflow, assertSafePreviewSource, summarizePreviewItem } from './verify-local.mjs';

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
