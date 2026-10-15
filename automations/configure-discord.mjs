import { existsSync, readFileSync, writeFileSync, unlinkSync, openSync, closeSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseDiscordWebhookUrl, validateDiscordCredential, assertConfirmedDiscordTest } from './discord-config.mjs';
import { createOwnerNotification } from './notification-rules.mjs';
import { createDiscordPayload } from './discord-message.mjs';
import { assertLocalN8n, dockerCapture, exportLocalCredential, exportLocalWorkflows, importLocalObject, localDirectory, parseCliJson, projectRoot } from './local-n8n.mjs';

export const DISCORD_CREDENTIAL_ID = 'StockFlowDiscord01';
export const DISCORD_TEST_ID = 'StockFlowDiscordTest01';
const testNode = 'Send Discord connection test';
const markerPath = path.join(localDirectory, 'discord-connection-test.json');

export function createDiscordTestWorkflow(credential = { id: DISCORD_CREDENTIAL_ID, name: 'StockFlow Discord test channel' }) {
  const notification = createOwnerNotification({ supplier: { id: 1, user: { name: 'Supplier Test', email: 'supplier.test@stockflow.local' } }, mode: 'connection-test', deliveryMode: 'discord', notificationsEnabled: false, subject: 'StockFlow CONNECTION TEST', lines: ['CONNECTION TEST ONLY. This confirms local n8n can post to your chosen Discord channel.', 'This is fictional owner attribution, not a stock alert. No stock or orders were changed.'] });
  return {
    id: DISCORD_TEST_ID, name: 'StockFlow · Discord CONNECTION TEST (manual only)', active: false,
    nodes: [
      { id: 'manual-test', name: 'Manual connection test', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} },
      { id: 'discord-test', name: testNode, type: 'n8n-nodes-base.discord', typeVersion: 2, position: [250, 0], parameters: { authentication: 'webhook', operation: 'sendLegacy', content: createDiscordPayload(notification).content, options: { wait: true, flags: ['SUPPRESS_EMBEDS'], tts: false } }, credentials: { discordWebhookApi: { id: credential.id, name: credential.name } }, retryOnFail: false, onError: 'stopWorkflow' },
    ],
    connections: { 'Manual connection test': { main: [[{ node: testNode, type: 'main', index: 0 }]] } },
    settings: { executionOrder: 'v1', timezone: 'Asia/Kolkata', saveDataSuccessExecution: 'none', saveDataErrorExecution: 'none', saveManualExecutions: false, saveExecutionProgress: false, executionTimeout: 60 }, staticData: null, pinData: {},
  };
}

export function assertSafeDiscordTest(actual, expected) {
  const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
  if (!actual || actual.active !== false || actual.activeVersionId || actual.activeVersion || actual.isArchived || Object.keys(actual.pinData || {}).length || Object.keys(actual.staticData || {}).length
    || ['id', 'name', 'nodes', 'connections', 'settings'].some(key => JSON.stringify(canonical(actual[key])) !== JSON.stringify(canonical(expected[key])))) throw new Error('The Discord test draft was changed or published. It was not replaced or executed.');
}

export function summarizeDiscordTest(raw) {
  const run = parseCliJson(raw, value => Boolean(value?.data?.resultData?.runData || value?.resultData?.runData));
  const result = run.data?.resultData || run.resultData;
  const runs = result.runData;
  const entries = runs[testNode];
  const main = entries?.[0]?.data?.main;
  const item = main?.[0]?.[0]?.json;
  const snowflake = value => typeof value === 'string' && /^[1-9]\d{16,19}$/.test(value);
  if (result.error || run.status === 'error' || run.finished === false || result.lastNodeExecuted !== testNode || !Array.isArray(entries) || entries.length !== 1
    || Object.keys(runs).some(name => !['Manual connection test', testNode].includes(name))
    || Object.values(runs).some(values => !Array.isArray(values) || values.some(value => !value || value.error || (value.executionStatus && value.executionStatus !== 'success')))
    || !Array.isArray(main) || main.length !== 1 || !Array.isArray(main[0]) || main[0].length !== 1 || item?.error || !snowflake(item?.id) || !snowflake(item?.channel_id)) throw new Error('Discord delivery was not confirmed. Inspect the channel before repeating; sensitive output was withheld.');
  return { messageIds: [item.id], channelId: item.channel_id };
}

export function assertNewDiscordTestAttempt(marker, credential, repeat) {
  if (marker && marker.webhookFingerprint === credential.webhookFingerprint && !repeat) throw new Error('A Discord test was already attempted for this webhook. Inspect the channel first; use --test --repeat only to intentionally send another.');
}

export function configureDiscord(args = process.argv.slice(2)) {
  const actions = args.filter(value => ['--apply', '--test', '--enable-low-stock'].includes(value));
  if (actions.length > 1 || args.some(value => !['--apply', '--test', '--enable-low-stock', '--repeat'].includes(value)) || new Set(args).size !== args.length || (args.includes('--repeat') && !args.includes('--test'))) throw new Error('Usage: configure-discord.mjs [--apply | --test [--repeat] | --enable-low-stock]');
  if (!actions.length) {
    console.log(JSON.stringify({ dryRun: true, provider: 'Discord incoming webhook', destination: 'one chosen channel', credentialId: DISCORD_CREDENTIAL_ID, secretFile: '.local/discord-webhook.url', requiredSteps: ['--apply imports the URL into encrypted n8n storage and removes the temporary file', '--test sends one labeled fictional connection test', '--enable-low-stock enables critical alerts after confirmed test; other four stay preview'], connectionTestContent: createDiscordTestWorkflow().nodes[1].parameters.content }, null, 2));
    return;
  }
  assertLocalN8n();
  const lockPath = path.join(localDirectory, 'discord-config.lock');
  let lock;
  try { lock = openSync(lockPath, 'wx', 0o600); } catch { throw new Error('Another Discord configuration run or interrupted lock exists. Inspect it before continuing.'); }
  try {
    if (actions[0] === '--apply') {
      const inputPath = path.join(localDirectory, 'discord-webhook.url');
      if (!existsSync(inputPath)) throw new Error('Save the chosen Discord webhook URL in .local/discord-webhook.url first. No credential changed.');
      const raw = readFileSync(inputPath, 'utf8');
      const webhookUri = parseDiscordWebhookUrl(raw.trim());
      // Refuse to overwrite an unrelated credential occupying our stable ID.
      const credentialFile = `/tmp/stockflow-credential-list-${Date.now()}.json`;
      let previous;
      try {
        dockerCapture(['exec', 'n8n', 'n8n', 'export:credentials', '--all', `--output=${credentialFile}`]);
        previous = JSON.parse(dockerCapture(['exec', 'n8n', 'node', '-e', `process.stdout.write(require('fs').readFileSync('${credentialFile}','utf8'))`])).find(value => value.id === DISCORD_CREDENTIAL_ID);
      } finally { dockerCapture(['exec', 'n8n', 'node', '-e', `require('fs').rmSync('${credentialFile}',{force:true})`]); }
      if (previous && (previous.type !== 'discordWebhookApi' || previous.name !== 'StockFlow Discord test channel')) throw new Error('The reserved Discord credential ID is occupied by another credential. Nothing was overwritten.');
      const credential = { id: DISCORD_CREDENTIAL_ID, name: 'StockFlow Discord test channel', type: 'discordWebhookApi', data: { webhookUri } };
      const expected = validateDiscordCredential(credential, DISCORD_CREDENTIAL_ID);
      if (previous) {
        const existing = validateDiscordCredential(exportLocalCredential(DISCORD_CREDENTIAL_ID), DISCORD_CREDENTIAL_ID);
        if (existing.webhookFingerprint !== expected.webhookFingerprint) {
          const users = exportLocalWorkflows().filter(workflow => workflow.nodes?.some(node => node.credentials?.discordWebhookApi?.id === DISCORD_CREDENTIAL_ID));
          if (users.some(workflow => workflow.active === true || workflow.activeVersionId || workflow.activeVersion)) throw new Error('The old webhook is used by published workflows. Unpublish those workflows before changing channels. No credential changed.');
          // Flush any old in-memory schedules before changing this credential's destination.
          dockerCapture(['restart', 'n8n']);
        }
      }
      importLocalObject('credentials', [credential]);
      const stored = validateDiscordCredential(exportLocalCredential(DISCORD_CREDENTIAL_ID), DISCORD_CREDENTIAL_ID);
      if (expected.webhookFingerprint !== stored.webhookFingerprint) throw new Error('Encrypted Discord credential verification failed. The input file was retained.');
      if (readFileSync(inputPath, 'utf8') !== raw) throw new Error('The input file changed during import and was retained. Review the selected channel before testing.');
      unlinkSync(inputPath);
      writeFileSync(path.join(localDirectory, 'discord-status.json'), JSON.stringify({ credentialId: stored.id, webhookFingerprint: stored.webhookFingerprint, connected: false, importedAt: new Date().toISOString(), gmailCanceled: true }, null, 2), { mode: 0o600 });
      console.log('Discord webhook stored encrypted in n8n and verified. Temporary URL file removed. No message sent.');
      return;
    }
    const credential = validateDiscordCredential(exportLocalCredential(DISCORD_CREDENTIAL_ID), DISCORD_CREDENTIAL_ID);
    const marker = existsSync(markerPath) ? JSON.parse(readFileSync(markerPath, 'utf8')) : null;
    if (actions[0] === '--enable-low-stock') {
      assertConfirmedDiscordTest(marker, credential);
      const result = spawnSync(process.execPath, [path.join(projectRoot, 'automations/update-local.mjs'), '--apply', '--enable-low-stock', `--discord-credential-id=${credential.id}`], { cwd: projectRoot, encoding: 'utf8', timeout: 240000, windowsHide: true });
      if (result.status !== 0) throw new Error('Discord critical-alert activation failed. Review local workflow settings; sensitive output was withheld.');
      console.log('Critical stock alerts enabled for the confirmed Discord channel. Other four workflows remain previews.');
      return;
    }
    assertNewDiscordTestAttempt(marker, credential, args.includes('--repeat'));
    const expected = createDiscordTestWorkflow(credential);
    const previous = exportLocalWorkflows().find(value => value.id === DISCORD_TEST_ID);
    if (previous) assertSafeDiscordTest(previous, expected);
    importLocalObject('workflow', expected);
    assertSafeDiscordTest(exportLocalWorkflows().find(value => value.id === DISCORD_TEST_ID), expected);
    const saveMarker = fields => writeFileSync(markerPath, JSON.stringify({ credentialId: credential.id, webhookFingerprint: credential.webhookFingerprint, ...fields }, null, 2), { mode: 0o600 });
    saveMarker({ status: 'pending', attemptedAt: new Date().toISOString() });
    try {
      const raw = dockerCapture(['exec', '-e', 'N8N_RUNNERS_BROKER_PORT=5681', 'n8n', 'n8n', 'execute', `--id=${DISCORD_TEST_ID}`, '--rawOutput']);
      const result = summarizeDiscordTest(raw);
      saveMarker({ status: 'confirmed', confirmedAt: new Date().toISOString(), ...result });
      writeFileSync(path.join(localDirectory, 'discord-status.json'), JSON.stringify({ credentialId: credential.id, webhookFingerprint: credential.webhookFingerprint, connected: true, ...result, verifiedAt: new Date().toISOString(), gmailCanceled: true }, null, 2), { mode: 0o600 });
      console.log(JSON.stringify({ success: true, ...result }));
      return result;
    } catch (error) {
      saveMarker({ status: 'unknown', attemptedAt: new Date().toISOString() });
      throw error;
    }
  } finally { closeSync(lock); unlinkSync(lockPath); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { configureDiscord(); } catch (error) {
    console.error(error instanceof SyntaxError ? 'Invalid local configuration. Sensitive data was withheld.' : error.message);
    process.exitCode = 1;
  }
}
