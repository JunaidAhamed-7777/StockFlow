// Updater contract fixtures only: no Docker, n8n, network, model or recipient is contacted.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { updateLocal } from './update-local.mjs';
import { WORKFLOW_MODES } from './verify-local.mjs';
import { validateDiscordCredential } from './discord-config.mjs';

const sourceDirectory = fileURLToPath(new URL('./workflows/', import.meta.url));
const privateDetail = 'FIXTURE_PRIVATE_ERROR_DO_NOT_EXPOSE';
const credential = { id: 'FixtureDiscord01', name: 'Fixture Discord connection', type: 'discordWebhookApi', data: { webhookUri: `https://discord.com/api/webhooks/123456789012345678/${'a'.repeat(48)}` } };
const runtime = { isolatedDemo: true, containerName: 'stockflow-db', n8nContainerId: 'fixture-n8n-id', databaseUrl: 'postgresql://stockflow:fixture-password@localhost:55432/stock_management?schema=public', jwtSecret: 'x'.repeat(48), initialized: true };
const container = { Id: runtime.n8nContainerId, Config: { Image: 'docker.n8n.io/n8nio/n8n:fixture' }, HostConfig: { PortBindings: { '5678/tcp': [{ HostIp: '127.0.0.1', HostPort: '5678' }] } }, Mounts: [{ Destination: '/home/node/.n8n', Type: 'volume', Name: 'fixture_n8n_data' }] };
const settings = (workflow) => workflow.nodes.find((node) => node.name === 'Settings').parameters;
const login = (workflow) => workflow.nodes.find((node) => node.name === 'StockFlow login');
const transport = (workflow) => workflow.nodes.find((node) => node.name === 'Send Discord notification');
const reverseKeys = (value) => Array.isArray(value) ? value.map(reverseKeys) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).reverse().map((key) => [key, reverseKeys(value[key])])) : value;

function fixture(t, { discord = true } = {}) {
  const prefix = path.join(tmpdir(), 'stockflow-update-local-');
  const root = mkdtempSync(prefix);
  t.after(() => { assert.ok(root.startsWith(prefix)); rmSync(root, { recursive: true, force: true }); });
  const local = path.join(root, '.local');
  const sources = path.join(root, 'automations/workflows');
  mkdirSync(local, { recursive: true }); mkdirSync(sources, { recursive: true });
  writeFileSync(path.join(local, 'runtime.json'), JSON.stringify(runtime));
  const workflows = new Map();
  for (const [id, mode] of Object.entries(WORKFLOW_MODES)) {
    const filename = `stockflow-${mode}.json`;
    const raw = readFileSync(path.join(sourceDirectory, filename), 'utf8');
    writeFileSync(path.join(sources, filename), raw);
    const previous = JSON.parse(raw);
    previous.active = true;
    settings(previous).jsCode = settings(previous).jsCode.replace('notificationsEnabled: false', 'notificationsEnabled: true');
    previous.staticData = { global: { sent: { [`fixture:${id}`]: { at: 123456, quantity: 2 } }, orderBaseline: { initializedAt: 123000, statuses: { 5: 'PROCESSING' } } } };
    login(previous).credentials = { httpCustomAuth: { id: `FixtureLogin-${id}`, name: 'Existing encrypted API login' } };
    if (discord) transport(previous).credentials = { discordWebhookApi: { id: credential.id, name: credential.name } };
    workflows.set(id, previous);
  }
  const state = { workflows, files: new Map(), ledger: [], credentialReads: 0, healthCalls: 0, waits: 0, logs: [], credential: structuredClone(credential) };
  const dockerCapture = (command, input) => {
    state.ledger.push([...command]);
    if (state.dockerError) throw new Error(privateDetail);
    if (command[0] === 'inspect') return JSON.stringify([container]);
    if (command[0] === 'restart') { assert.deepEqual(command, ['restart', 'n8n']); return ''; }
    const script = command[command.indexOf('-e') + 1];
    if (command.includes('export:workflow')) {
      const filename = command.find((argument) => argument.startsWith('--output=')).slice('--output='.length);
      state.files.set(filename, state.rawExport ?? JSON.stringify([...state.workflows.values()])); return '';
    }
    if (command.includes('import:workflow')) {
      const filename = command.find((argument) => argument.startsWith('--input=')).slice('--input='.length);
      let workflow = JSON.parse(state.files.get(filename));
      if (state.transformStored) workflow = state.transformStored(workflow);
      state.workflows.set(workflow.id, workflow); return '';
    }
    if (command.includes('publish:workflow')) {
      const id = command.find((argument) => argument.startsWith('--id=')).slice('--id='.length);
      state.workflows.get(id).active = !state.publishInactive;
      return '';
    }
    if (typeof script === 'string' && script.includes('writeFileSync')) {
      const filename = /writeFileSync\('([^']+)'/.exec(script)?.[1];
      assert.ok(filename); state.files.set(filename, input); return '';
    }
    if (typeof script === 'string' && script.includes('process.stdout.write')) {
      const filename = /readFileSync\('([^']+)'/.exec(script)?.[1];
      assert.ok(state.files.has(filename)); return state.files.get(filename);
    }
    if (typeof script === 'string' && script.includes('rmSync')) {
      const filename = /rmSync\('([^']+)'/.exec(script)?.[1];
      assert.ok(filename); state.files.delete(filename); return '';
    }
    assert.fail(`Unexpected fixture Docker command: ${command.join(' ')}`);
  };
  const options = {
    root, args: ['--apply'], dockerCapture,
    exportCredential: (id) => { state.credentialReads++; assert.equal(id, credential.id); if (state.credentialError) throw new Error(privateDetail); return structuredClone(state.credential); },
    fetchImpl: async (url, options) => {
      state.healthCalls++; assert.equal(url, 'http://localhost:5678/healthz'); assert.equal(options.redirect, 'error');
      if (state.healthError) throw new Error(privateDetail);
      return { ok: true };
    },
    wait: async () => { state.waits++; }, log: (value) => state.logs.push(value),
  };
  const confirmationPath = path.join(local, 'discord-connection-test.json');
  const confirm = () => {
    const marker = { status: 'confirmed', credentialId: credential.id, webhookFingerprint: validateDiscordCredential(state.credential).webhookFingerprint, channelId: '223456789012345678', messageIds: ['323456789012345678'] };
    writeFileSync(confirmationPath, JSON.stringify(marker)); return marker;
  };
  return { root, local, sources, state, options, confirm, confirmationPath,
    statusPath: path.join(local, 'automation-status.json'),
    mutateSource: (mode, mutate) => { const filename = path.join(sources, `stockflow-${mode}.json`); const source = JSON.parse(readFileSync(filename, 'utf8')); mutate(source); writeFileSync(filename, JSON.stringify(source)); },
  };
}

const imports = (state) => state.ledger.filter((command) => command.includes('import:workflow'));
const enabled = (workflow) => settings(workflow).jsCode.includes('notificationsEnabled: true');

test('ordinary apply disables all previously enabled workflows and preserves cooldowns, baselines and API login bindings', async (t) => {
  const f = fixture(t);
  const before = structuredClone([...f.state.workflows.values()]);
  // Benign n8n defaults, matching published metadata and object-key ordering are allowed.
  f.state.transformStored = (workflow) => {
    workflow.settings.availableInMCP = false;
    workflow.versionId = 'fixture-published-version'; workflow.activeVersionId = workflow.versionId;
    workflow.activeVersion = { versionId: workflow.versionId, nodes: structuredClone(workflow.nodes), connections: structuredClone(workflow.connections) };
    return reverseKeys(workflow);
  };
  const result = await updateLocal(f.options);
  assert.equal(result.workflows.length, 5); assert.ok(result.workflows.every((workflow) => workflow.deliveryEnabled === false));
  assert.equal(imports(f.state).length, 5);
  assert.equal(f.state.ledger.filter((command) => command.includes('publish:workflow')).length, 5);
  for (const previous of before) {
    const installed = f.state.workflows.get(previous.id);
    assert.equal(enabled(installed), false);
    assert.deepEqual(installed.staticData, previous.staticData);
    assert.deepEqual(login(installed).credentials, login(previous).credentials);
    assert.deepEqual(transport(installed).credentials, { discordWebhookApi: { id: credential.id, name: credential.name } });
  }
  const status = JSON.parse(readFileSync(f.statusPath, 'utf8'));
  assert.deepEqual(status.enabledWorkflows, []); assert.equal(status.restartPending, false); assert.equal(status.openAiCalls, 0);
  assert.equal(f.state.healthCalls, 1); assert.equal(f.state.files.size, 0);
  if (process.platform !== 'win32') assert.equal(statSync(f.statusPath).mode & 0o777, 0o600);
  const backups = readdirSync(path.join(f.local, 'n8n-backups'));
  assert.equal(backups.length, 1);
  assert.deepEqual(JSON.parse(readFileSync(path.join(f.local, 'n8n-backups', backups[0], 'previous-workflows.json'), 'utf8')), before);
});

test('Discord credentials are optional for preview installation', async (t) => {
  const f = fixture(t, { discord: false });
  await updateLocal({ ...f.options, exportCredential: () => assert.fail('Preview installation exported a missing credential') });
  assert.equal(imports(f.state).length, 5);
  assert.ok([...f.state.workflows.values()].every((workflow) => !enabled(workflow) && !transport(workflow).credentials));
  assert.equal(JSON.parse(readFileSync(f.statusPath, 'utf8')).discordCredentialId, null);
});

test('dry run exports and validates proposals without importing, publishing, restarting, backing up or checking health', async (t) => {
  const f = fixture(t); const before = structuredClone([...f.state.workflows]);
  const summary = await updateLocal({ ...f.options, args: [] });
  assert.equal(summary.apply, false); assert.deepEqual([...f.state.workflows], before);
  assert.equal(imports(f.state).length, 0);
  assert.ok(f.state.ledger.every((command) => !command.includes('publish:workflow') && command[0] !== 'restart'));
  assert.equal(f.state.healthCalls, 0); assert.equal(f.state.waits, 0); assert.equal(f.state.files.size, 0);
  assert.equal(existsSync(path.join(f.local, 'n8n-backups')), false); assert.equal(existsSync(f.statusPath), false);
});

test('confirmed activation enables only critical stock delivery for the exact current webhook', async (t) => {
  const f = fixture(t); const marker = f.confirm();
  await updateLocal({ ...f.options, args: ['--apply', '--enable-low-stock', `--discord-credential-id=${credential.id}`] });
  assert.deepEqual([...f.state.workflows.values()].filter(enabled).map((workflow) => workflow.id), ['StockFlowCritical01']);
  const status = JSON.parse(readFileSync(f.statusPath, 'utf8'));
  assert.deepEqual(status.enabledWorkflows, ['StockFlowCritical01']); assert.equal(status.channelId, marker.channelId);
  assert.equal(f.state.healthCalls, 1);
});

test('activation refuses missing or mismatched confirmation, changed destinations and missing credentials before import', async (t) => {
  for (const mode of ['missing', 'mismatch', 'changed-destination', 'invalid-message-id', 'no-credential']) {
    const f = fixture(t, { discord: mode !== 'no-credential' });
    if (mode !== 'missing' && mode !== 'no-credential') {
      const marker = f.confirm();
      if (mode === 'mismatch') marker.credentialId = 'AnotherCredential';
      if (mode === 'invalid-message-id') marker.messageIds = ['invalid'];
      writeFileSync(f.confirmationPath, JSON.stringify(marker));
      if (mode === 'changed-destination') f.state.credential.data.webhookUri = f.state.credential.data.webhookUri.replace(/a{48}$/, 'b'.repeat(48));
    }
    await assert.rejects(updateLocal({ ...f.options, args: ['--apply', '--enable-low-stock'] }), /confirmed Discord test|Configure and test/);
    assert.equal(imports(f.state).length, 0); assert.equal(existsSync(f.statusPath), false);
  }
});

test('unknown, malformed, duplicate, missing and extra source IDs refuse before any workflow import', async (t) => {
  for (const mode of ['unknown', 'malformed', 'duplicate', 'missing', 'extra']) {
    const f = fixture(t);
    if (mode === 'unknown') f.mutateSource('low-stock', (source) => { source.id = 'UnrecognizedWorkflow'; });
    if (mode === 'malformed') f.mutateSource('low-stock', (source) => { source.id = ['StockFlowCritical01']; });
    if (mode === 'duplicate') f.mutateSource('low-stock', (source) => { source.id = 'StockFlowDigest01'; });
    if (mode === 'missing') rmSync(path.join(f.sources, 'stockflow-low-stock.json'));
    if (mode === 'extra') writeFileSync(path.join(f.sources, 'stockflow-extra.json'), JSON.stringify({ id: 'ExtraWorkflow' }));
    await assert.rejects(updateLocal(f.options), /five unique, known/);
    assert.deepEqual(f.state.ledger, []); assert.equal(imports(f.state).length, 0);
  }
});

test('invalid credential IDs and ambiguous CLI options are refused before Docker access', async (t) => {
  for (const args of [['--apply', '--discord-credential-id='], ['--apply', '--discord-credential-id=../private'], ['--discord-credential-id=one', '--discord-credential-id=two'], ['--unknown'], ['--apply', '--enable-low-stock', '--defer-restart']]) {
    const f = fixture(t);
    await assert.rejects(updateLocal({ ...f.options, args }));
    assert.deepEqual(f.state.ledger, []);
  }
  const f = fixture(t); transport(f.state.workflows.get('StockFlowCritical01')).credentials.discordWebhookApi.id = '../private';
  await assert.rejects(updateLocal(f.options), /valid local Discord credential ID/);
  assert.equal(imports(f.state).length, 0);
});

test('deferred preview restart stores disabled templates without a restart or health request', async (t) => {
  const f = fixture(t);
  await updateLocal({ ...f.options, args: ['--apply', '--defer-restart'], fetchImpl: () => assert.fail('Deferred update checked health') });
  assert.equal(imports(f.state).length, 5); assert.ok([...f.state.workflows.values()].every((workflow) => !enabled(workflow)));
  assert.ok(f.state.ledger.every((command) => command[0] !== 'restart'));
  assert.equal(JSON.parse(readFileSync(f.statusPath, 'utf8')).restartPending, true);
  assert.equal(f.state.waits, 0);
});

test('lost stored static data refuses to report enabled delivery', async (t) => {
  const f = fixture(t); f.confirm();
  f.state.transformStored = (workflow) => { delete workflow.staticData; return workflow; };
  await assert.rejects(updateLocal({ ...f.options, args: ['--apply', '--enable-low-stock'] }), /Stored workflow verification failed/);
  assert.equal(existsSync(f.statusPath), false); assert.equal(f.state.healthCalls, 0);
  assert.ok(f.state.ledger.every((command) => command[0] !== 'restart'));
  assert.equal(f.state.files.size, 0);
});

test('stored pinned data or changed execution settings cannot pass successful update verification', async (t) => {
  for (const tamper of [
    (workflow) => { workflow.pinData = { Settings: [{ json: { deliveryEnabled: true } }] }; return workflow; },
    (workflow) => { workflow.settings.errorWorkflow = 'UnexpectedErrorWorkflow'; return workflow; },
    (workflow) => { workflow.settings.timezone = 'UTC'; return workflow; },
    (workflow) => { workflow.settings.saveManualExecutions = true; return workflow; },
  ]) {
    const f = fixture(t); f.state.transformStored = tamper;
    await assert.rejects(updateLocal(f.options), /Stored workflow verification failed/);
    assert.equal(existsSync(f.statusPath), false); assert.equal(f.state.healthCalls, 0);
  }
});

test('inactive publication and inconsistent exported active versions cannot produce a successful status', async (t) => {
  for (const tamper of [
    (workflow) => { workflow.activeVersionId = 'published-version'; workflow.versionId = 'different-version'; return workflow; },
    (workflow) => { workflow.activeVersion = { nodes: [] }; return workflow; },
    (workflow) => { workflow.activeVersion = {}; return workflow; },
  ]) {
    const f = fixture(t); f.state.transformStored = tamper;
    await assert.rejects(updateLocal(f.options), /Stored workflow verification failed/);
    assert.equal(existsSync(f.statusPath), false);
  }
  const f = fixture(t); f.state.publishInactive = true;
  await assert.rejects(updateLocal(f.options), /Stored workflow verification failed/);
  assert.equal(existsSync(f.statusPath), false);
});

test('enabled settings, altered transport, pinned data and disabled source nodes are rejected before import', async (t) => {
  for (const mutate of [
    (source) => { settings(source).jsCode = settings(source).jsCode.replace('notificationsEnabled: false', 'notificationsEnabled: true'); },
    (source) => { transport(source).parameters.options.wait = false; },
    (source) => { source.pinData = { Settings: [{ json: { deliveryEnabled: true } }] }; },
    (source) => { transport(source).disabled = true; },
  ]) {
    const f = fixture(t); f.mutateSource('low-stock', mutate);
    await assert.rejects(updateLocal(f.options), /safe disabled-delivery preview/);
    assert.deepEqual(f.state.ledger, []);
  }
});

test('boundary and malformed-export errors with private details are withheld from errors and logs', async (t) => {
  for (const mode of ['dockerError', 'credentialError', 'rawExport', 'healthError']) {
    const f = fixture(t); f.state[mode] = mode === 'rawExport' ? privateDetail : true;
    await assert.rejects(updateLocal(f.options), (error) => !error.message.includes(privateDetail) && /withheld|did not become healthy/.test(error.message));
    assert.equal(f.state.logs.join('\n').includes(privateDetail), false);
    assert.equal(existsSync(f.statusPath), false);
    if (mode === 'healthError') { assert.equal(f.state.healthCalls, 40); assert.equal(f.state.waits, 40); }
  }
});
