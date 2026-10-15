import test from 'node:test';
import assert from 'node:assert/strict';
import { assertNewDiscordTestAttempt, assertSafeDiscordTest, createDiscordTestWorkflow, DISCORD_CREDENTIAL_ID, DISCORD_TEST_ID, summarizeDiscordTest } from './configure-discord.mjs';
import { parseCliJson } from './local-n8n.mjs';

const nodeName = 'Send Discord connection test';
const credential = { id: DISCORD_CREDENTIAL_ID, name: 'StockFlow Discord test channel', webhookFingerprint: 'a'.repeat(64) };
const draft = () => createDiscordTestWorkflow(credential);
const execution = () => ({ finished: true, status: 'success', data: { resultData: {
  lastNodeExecuted: nodeName,
  runData: {
    'Manual connection test': [{ executionStatus: 'success', data: { main: [[{ json: {} }]] } }],
    [nodeName]: [{ executionStatus: 'success', data: { main: [[{ json: { id: '123456789012345678', channel_id: '223456789012345678', content: 'private test body', author: { token: 'synthetic-private-token' } } }]] } }],
  },
} } });

test('the Discord connection-test graph is an inactive manual trigger and one fixed native webhook post', () => {
  const workflow = draft();
  assert.equal(workflow.id, DISCORD_TEST_ID);
  assert.equal(workflow.active, false);
  assert.equal(workflow.nodes.length, 2);
  assert.equal(workflow.nodes[0].type, 'n8n-nodes-base.manualTrigger');
  const transport = workflow.nodes[1];
  assert.equal(transport.type, 'n8n-nodes-base.discord');
  assert.equal(transport.typeVersion, 2);
  assert.equal(transport.parameters.authentication, 'webhook');
  assert.equal(transport.parameters.operation, 'sendLegacy');
  assert.deepEqual(transport.parameters.options, { wait: true, flags: ['SUPPRESS_EMBEDS'], tts: false });
  assert.deepEqual(transport.credentials, { discordWebhookApi: { id: credential.id, name: credential.name } });
  assert.equal(transport.retryOnFail, false);
  assert.equal(transport.onError, 'stopWorkflow');
  assert.match(transport.parameters.content, /CONNECTION TEST/);
  assert.match(transport.parameters.content, /Intended stock owner: Supplier Test/);
  assert.match(transport.parameters.content, /supplier\\.test \[at\] stockflow\\.local/);
  assert.match(transport.parameters.content, /not a stock alert/);
  assert.equal(transport.parameters.content.includes('@'), false);
  assert.ok(transport.parameters.content.length <= 2000);
  assert.doesNotMatch(JSON.stringify(workflow), /scheduleTrigger|webhookUrl|webhookUri|httpRequest|allowed_mentions|retryOnFail":true/);
  assert.equal(workflow.settings.saveDataSuccessExecution, 'none');
  assert.equal(workflow.settings.saveDataErrorExecution, 'none');
  assert.equal(workflow.settings.saveManualExecutions, false);
  assert.equal(workflow.settings.saveExecutionProgress, false);
  assert.doesNotThrow(() => assertSafeDiscordTest(workflow, draft()));
});

test('graph verification rejects edited routing, credentials, triggers, execution settings, or remembered data', () => {
  const mutations = [
    value => { value.id = 'unrelated-draft'; },
    value => { value.name = 'Some user workflow'; },
    value => { value.active = true; },
    value => { value.activeVersionId = 'published-version'; },
    value => { value.activeVersion = { id: 'published-version' }; },
    value => { value.isArchived = true; },
    value => { value.nodes[0].type = 'n8n-nodes-base.scheduleTrigger'; },
    value => { value.nodes.push({ name: 'Extra', type: 'n8n-nodes-base.httpRequest' }); },
    value => { value.nodes[1].credentials.discordWebhookApi.id = 'different-credential'; },
    value => { value.nodes[1].credentials.discordWebhookApi.name = 'different credential'; },
    value => { value.nodes[1].parameters.content = 'different content @everyone'; },
    value => { value.nodes[1].parameters.options.wait = false; },
    value => { value.nodes[1].parameters.options.tts = true; },
    value => { value.nodes[1].parameters.options.flags = []; },
    value => { value.nodes[1].retryOnFail = true; },
    value => { value.nodes[1].disabled = true; },
    value => { value.connections = {}; },
    value => { value.settings.saveDataSuccessExecution = 'all'; },
    value => { value.settings.errorWorkflow = 'other-workflow'; },
    value => { value.pinData = { 'Manual connection test': [{ json: { injected: true } }] }; },
    value => { value.staticData = { previous: true }; },
  ];
  for (const mutate of mutations) {
    const actual = draft();
    mutate(actual);
    assert.throws(() => assertSafeDiscordTest(actual, draft()), /not replaced or executed/);
  }
  assert.throws(() => assertSafeDiscordTest(null, draft()));
  const reordered = draft();
  reordered.nodes[1].parameters = Object.fromEntries(Object.entries(reordered.nodes[1].parameters).reverse());
  assert.doesNotThrow(() => assertSafeDiscordTest(reordered, draft()), 'harmless JSON key ordering does not change the graph');
});

test('confirmed Discord results expose only the single message ID and channel ID', () => {
  const raw = `[CLI setup] synthetic-private-token\n${JSON.stringify(execution())}\nShutdown finished.`;
  const result = summarizeDiscordTest(raw);
  assert.deepEqual(result, { messageIds: ['123456789012345678'], channelId: '223456789012345678' });
  assert.doesNotMatch(JSON.stringify(result), /private|content|author|runData|credential|token/);
  const resultOnly = { resultData: execution().data.resultData };
  assert.deepEqual(summarizeDiscordTest(JSON.stringify(resultOnly)), result);
});

test('zero-exit CLI error envelopes and unconfirmed or malformed message results cannot count as delivery', () => {
  const mutations = [
    value => { value.status = 'error'; },
    value => { value.finished = false; },
    value => { value.data.resultData.error = { message: 'synthetic-private-error' }; },
    value => { value.data.resultData.lastNodeExecuted = 'Manual connection test'; },
    value => { value.data.resultData.runData['Unexpected node'] = []; },
    value => { value.data.resultData.runData[nodeName][0].error = { message: 'synthetic-private-error' }; },
    value => { value.data.resultData.runData[nodeName][0].executionStatus = 'error'; },
    value => { value.data.resultData.runData[nodeName][0].data.main[0][0].json.error = 'synthetic-private-error'; },
    value => { value.data.resultData.runData[nodeName][0].data.main[0][0].json.id = 'short'; },
    value => { value.data.resultData.runData[nodeName][0].data.main[0][0].json.channel_id = 223456789012345678; },
    value => { value.data.resultData.runData[nodeName][0].data.main[0][0].json.channel_id = '023456789012345678'; },
    value => { value.data.resultData.runData[nodeName][0].data.main[0].push({ json: { id: '323456789012345678', channel_id: '223456789012345678' } }); },
    value => { value.data.resultData.runData[nodeName].push(value.data.resultData.runData[nodeName][0]); },
    value => { value.data.resultData.runData[nodeName][0].data.main.push([]); },
    value => { value.data.resultData.runData[nodeName][0].data.main = [null]; },
    value => { value.data.resultData.runData[nodeName][0].data.main = {}; },
    value => { value.data.resultData.runData[nodeName][0].data.main = []; },
    value => { value.data.resultData.runData[nodeName] = [null]; },
    value => { delete value.data.resultData.runData[nodeName]; },
  ];
  for (const mutate of mutations) {
    const value = execution();
    mutate(value);
    assert.throws(() => summarizeDiscordTest(JSON.stringify(value)), /not confirmed/);
  }
});

test('same-webhook markers block confirmed, pending, and uncertain repeat attempts', () => {
  assert.doesNotThrow(() => assertNewDiscordTestAttempt(null, credential, false));
  for (const status of ['confirmed', 'pending', 'unknown']) {
    const marker = { webhookFingerprint: credential.webhookFingerprint, status };
    assert.throws(() => assertNewDiscordTestAttempt(marker, credential, false), /already attempted/);
    assert.doesNotThrow(() => assertNewDiscordTestAttempt(marker, credential, true));
    assert.doesNotThrow(() => assertNewDiscordTestAttempt(marker, { ...credential, webhookFingerprint: 'b'.repeat(64) }, false), 'a different webhook requires its own connection test');
  }
});

test('CLI JSON parsing handles log noise, escaped strings, and sensitive fields entirely in memory', () => {
  const values = [{ id: 'test-only', secret: 'synthetic-secret "quoted" \\ slash [brackets] {braces}' }];
  const raw = `[unstructured log]\n{"notTheCredentialArray":true}\n${JSON.stringify(values)}\ncleanup complete`;
  assert.deepEqual(parseCliJson(raw, Array.isArray), values);
  const run = execution();
  assert.deepEqual(parseCliJson(`[log]\n${JSON.stringify(run)}\n[shutdown]`, value => Boolean(value?.data?.resultData)), run);
});

test('unparseable or failed CLI results produce generic errors without revealing their raw content', () => {
  for (const raw of [null, undefined, '', 'synthetic-private-token', '[not JSON]', '{"token":"synthetic-private-token"}']) {
    assert.throws(() => summarizeDiscordTest(raw), error => /withheld/.test(error.message) && !/synthetic-private-token/.test(error.message));
  }
  const failed = execution();
  failed.data.resultData.error = { message: 'synthetic-private-error' };
  assert.throws(() => summarizeDiscordTest(JSON.stringify(failed)), error => /withheld/.test(error.message) && !/synthetic-private-error/.test(error.message));
});
