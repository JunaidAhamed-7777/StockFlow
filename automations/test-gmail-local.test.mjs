import test from 'node:test';
import assert from 'node:assert/strict';
import { assertCanSendConnectionTest, assertSafeConnectionTestWorkflow, createConnectionTestWorkflow, extractConnectionTestJson, parseConnectionTestArgs, summarizeConnectionTestResult, TEST_DESTINATION, TEST_WORKFLOW_ID } from './test-gmail-local.mjs';

const gmail = { id: 'gmail-test-01', name: 'Gmail send only' };
const workflow = () => createConnectionTestWorkflow(gmail);
const execution = () => ({ finished: true, status: 'success', data: { resultData: {
  lastNodeExecuted: 'Send connection test', runData: {
    'Manual connection test': [{ executionStatus: 'success', data: { main: [[{ json: {} }]] } }],
    'Send connection test': [{ executionStatus: 'success', data: { main: [[{ json: { id: '19a1b2c3d4', threadId: 'private-thread', secret: 'private-token' } }]] } }],
  },
} } });

test('connection tests default to a dry run and require explicit send plus a valid credential ID', () => {
  assert.deepEqual(parseConnectionTestArgs([]), { send: false, repeat: false, credentialId: undefined });
  assert.deepEqual(parseConnectionTestArgs(['--send', '--gmail-credential-id=gmail-test-01']), { send: true, repeat: false, credentialId: gmail.id });
  assert.equal(parseConnectionTestArgs(['--send', '--repeat', '--gmail-credential-id=gmail-test-01']).repeat, true);
  for (const args of [
    ['--send'], ['--repeat'], ['--yes'], ['--send', '--send'],
    ['--gmail-credential-id=one', '--gmail-credential-id=two'],
    ['--send', '--gmail-credential-id='], ['--send', '--gmail-credential-id=credential;other'],
    ['--send', '--gmail-credential-id=credential\nother'], ['--send', `--gmail-credential-id=${'x'.repeat(65)}`],
  ]) assert.throws(() => parseConnectionTestArgs(args));
});

test('the reviewable graph contains exactly one manual trigger and one literal Gmail send', () => {
  const draft = workflow();
  assert.equal(draft.id, TEST_WORKFLOW_ID);
  assert.equal(draft.active, false);
  assert.equal(draft.nodes.length, 2);
  assert.equal(draft.nodes[0].type, 'n8n-nodes-base.manualTrigger');
  const mail = draft.nodes[1];
  assert.equal(mail.parameters.sendTo, TEST_DESTINATION);
  assert.match(mail.parameters.subject, /CONNECTION TEST/);
  assert.match(mail.parameters.message, /Intended stock owner: Supplier Test\nIntended owner email: supplier.test@stockflow.local\nSupplier ID: 1/);
  assert.match(mail.parameters.message, /makes no claim about current stock/);
  assert.deepEqual(mail.parameters.options, { appendAttribution: false });
  assert.equal(mail.retryOnFail, false);
  assert.equal(mail.onError, 'stopWorkflow');
  assert.equal(draft.settings.saveDataSuccessExecution, 'none');
  assert.equal(draft.settings.saveDataErrorExecution, 'none');
  assert.equal(draft.settings.saveManualExecutions, false);
  assert.doesNotMatch(JSON.stringify(draft), /scheduleTrigger|webhook|senderName|ccList|bccList|attachments|retryOnFail":true/);
  assert.doesNotThrow(() => assertSafeConnectionTestWorkflow(draft, workflow()));
});

test('existing or imported drafts with any executable or routing change are refused', () => {
  const mutations = [
    value => { value.active = true; },
    value => { value.activeVersionId = 'published-version'; },
    value => { value.id = 'unrelated-workflow'; },
    value => { value.name = 'Unrelated user draft'; },
    value => { value.nodes[1].parameters.sendTo = 'someone@other-domain.com'; },
    value => { value.nodes[1].parameters.options.ccList = 'someone@other-domain.com'; },
    value => { value.nodes[1].parameters.options.bccList = 'someone@other-domain.com'; },
    value => { value.nodes[1].parameters.options.senderName = 'Custom sender'; },
    value => { value.nodes[1].parameters.message = 'Stock is low'; },
    value => { value.nodes[1].credentials.gmailOAuth2.id = 'different-credential'; },
    value => { value.nodes[1].retryOnFail = true; },
    value => { value.nodes[1].disabled = true; },
    value => { value.nodes.push({ type: 'n8n-nodes-base.webhook' }); },
    value => { value.connections = {}; },
    value => { value.settings.errorWorkflow = 'external-workflow'; },
    value => { value.settings.saveDataErrorExecution = 'all'; },
    value => { value.pinData = { 'Manual connection test': [{ json: { inject: true } }] }; },
    value => { value.staticData = { sendTo: 'someone@other-domain.com' }; },
  ];
  for (const mutate of mutations) {
    const actual = workflow();
    mutate(actual);
    assert.throws(() => assertSafeConnectionTestWorkflow(actual, workflow()), /No workflow executed or replaced/);
  }
  assert.throws(() => assertSafeConnectionTestWorkflow(undefined, workflow()));
});

test('only a confirmed single Gmail message produces a redacted success result', () => {
  const raw = `[setup log] private-token\n${JSON.stringify(execution())}\nShutdown complete.`;
  assert.deepEqual(summarizeConnectionTestResult(raw, 0), { success: true, messageId: '19a1b2c3d4' });
  assert.doesNotMatch(JSON.stringify(summarizeConnectionTestResult(raw, 0)), /private-|threadId|runData|credential/);
});

test('CLI zero exit does not turn errors, incomplete runs, or multiple messages into success', () => {
  const mutations = [
    value => { value.status = 'error'; },
    value => { value.finished = false; },
    value => { value.data.resultData.error = { message: 'private-error' }; },
    value => { value.data.resultData.lastNodeExecuted = 'Manual connection test'; },
    value => { value.data.resultData.runData['Unexpected node'] = []; },
    value => { value.data.resultData.runData['Send connection test'][0].error = { message: 'private-error' }; },
    value => { value.data.resultData.runData['Send connection test'][0].executionStatus = 'error'; },
    value => { value.data.resultData.runData['Send connection test'][0].data.main[0][0].json.id = ''; },
    value => { value.data.resultData.runData['Send connection test'][0].data.main[0][0].json.id = 'private\ninvalid'; },
    value => { value.data.resultData.runData['Send connection test'][0].data.main[0][0].json.error = 'private-error'; },
    value => { value.data.resultData.runData['Send connection test'][0].data.main[0].push({ json: { id: 'second' } }); },
    value => { value.data.resultData.runData['Send connection test'].push(value.data.resultData.runData['Send connection test'][0]); },
    value => { delete value.data.resultData.runData['Send connection test']; },
  ];
  for (const mutate of mutations) {
    const value = execution();
    mutate(value);
    assert.throws(() => summarizeConnectionTestResult(JSON.stringify(value), 0), /not confirmed/);
  }
  assert.throws(() => summarizeConnectionTestResult(JSON.stringify(execution()), 1), /not confirmed/);
  assert.throws(() => summarizeConnectionTestResult('private-error without JSON', 0), /Raw output withheld/);
});

test('JSON extraction handles escaped content and bracket-like log lines without printing it', () => {
  const value = [{ id: gmail.id, text: 'quote " slash \\ brackets [ ] { }', secret: 'private' }];
  assert.deepEqual(extractConnectionTestJson(`[unstructured log]\n${JSON.stringify(value)}\nfinished`, Array.isArray), value);
  assert.throws(() => extractConnectionTestJson('private-token', Array.isArray), /Raw output withheld/);
});

test('per-credential markers block repeat or ambiguous sends unless explicitly requested', () => {
  const options = { credentialId: gmail.id, repeat: false };
  assert.doesNotThrow(() => assertCanSendConnectionTest(null, options));
  for (const status of ['confirmed', 'pending', 'unknown']) {
    const marker = { credentialId: gmail.id, destination: TEST_DESTINATION, status };
    assert.throws(() => assertCanSendConnectionTest(marker, options), /already attempted/);
    assert.doesNotThrow(() => assertCanSendConnectionTest(marker, { ...options, repeat: true }));
  }
  for (const marker of [
    {}, { credentialId: 'other', destination: TEST_DESTINATION, status: 'confirmed' },
    { credentialId: gmail.id, destination: 'other@domain.com', status: 'confirmed' },
    { credentialId: gmail.id, destination: TEST_DESTINATION, status: 'unexpected' },
  ]) assert.throws(() => assertCanSendConnectionTest(marker, { ...options, repeat: true }), /marker is invalid/);
});
