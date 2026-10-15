import { randomUUID, createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { validateRuntimeConfig, validateN8nContainer } from '../scripts/runtime-safety.mjs';
import { validateDiscordCredential, assertConfirmedDiscordTest } from './discord-config.mjs';
import { exportLocalCredential } from './local-n8n.mjs';
import './build-workflows.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const local = path.join(root, '.local');
const args = process.argv.slice(2);
const enableLowStock = args.includes('--enable-low-stock');
const apply = args.includes('--apply');
const deferRestart = args.includes('--defer-restart');
const idOption = args.find(value => value.startsWith('--discord-credential-id='));
if (args.some(value => !['--apply', '--enable-low-stock', '--defer-restart'].includes(value) && !value.startsWith('--discord-credential-id='))) throw new Error('Usage: node automations/update-local.mjs [--apply] [--enable-low-stock] [--discord-credential-id=ID] [--defer-restart]');
if (enableLowStock && deferRestart) throw new Error('Live activation must include a restart and verification.');
const runtime = JSON.parse(readFileSync(path.join(local, 'runtime.json'), 'utf8'));
validateRuntimeConfig(runtime);
function docker(command, input) {
  const result = spawnSync('docker', command, { input, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, timeout: 120000, windowsHide: true });
  if (result.status !== 0) throw new Error(`Local n8n operation failed (${command[0]}). Raw output withheld because it may contain credentials.`);
  return result.stdout;
}
validateN8nContainer(JSON.parse(docker(['inspect', 'n8n']))[0], runtime.n8nContainerId);
const batch = randomUUID();
const exportPath = `/tmp/stockflow-update-${batch}.json`;
let current;
try {
  docker(['exec', 'n8n', 'n8n', 'export:workflow', '--all', `--output=${exportPath}`]);
  current = JSON.parse(docker(['exec', 'n8n', 'node', '-e', `process.stdout.write(require('fs').readFileSync('${exportPath}','utf8'))`]));
} finally { docker(['exec', 'n8n', 'node', '-e', `require('fs').rmSync('${exportPath}',{force:true})`]); }
const byId = new Map(current.map(workflow => [workflow.id, workflow]));
const sources = readdirSync(path.join(root, 'automations/workflows')).filter(file => /^stockflow-[a-z-]+\.json$/.test(file)).map(file => JSON.parse(readFileSync(path.join(root, 'automations/workflows', file), 'utf8')));
const credentialId = idOption?.slice('--discord-credential-id='.length) || byId.get('StockFlowCritical01')?.nodes.find(node => node.name === 'Send Discord notification')?.credentials?.discordWebhookApi?.id;
let discord;
let confirmation;
if (credentialId) discord = validateDiscordCredential(exportLocalCredential(credentialId), credentialId);
if (enableLowStock) {
  if (!discord) throw new Error('Configure and test the Discord webhook before enabling delivery.');
  confirmation = assertConfirmedDiscordTest(JSON.parse(readFileSync(path.join(local, 'discord-connection-test.json'), 'utf8')), discord);
}
const prepared = sources.map(source => {
  const previous = byId.get(source.id);
  source.staticData = previous?.staticData ?? null;
  const loginCredential = previous?.nodes.find(node => node.name === 'StockFlow login')?.credentials;
  if (loginCredential) source.nodes.find(node => node.name === 'StockFlow login').credentials = loginCredential;
  if (discord) source.nodes.find(node => node.name === 'Send Discord notification').credentials = { discordWebhookApi: { id: discord.id, name: discord.name } };
  const settings = source.nodes.find(node => node.name === 'Settings').parameters;
  if (!settings.jsCode.includes("deliveryMode: 'discord'") || !settings.jsCode.includes('notificationsEnabled: false')) throw new Error('Source settings do not match the disabled Discord template.');
  if (enableLowStock && source.id === 'StockFlowCritical01') settings.jsCode = settings.jsCode.replace('notificationsEnabled: false', 'notificationsEnabled: true');
  return source;
});
const summary = { apply, provider: 'Discord', destination: 'one configured channel', workflows: prepared.map(workflow => ({ id: workflow.id, name: workflow.name, deliveryEnabled: enableLowStock && workflow.id === 'StockFlowCritical01', existingStatePreserved: byId.has(workflow.id) })) };
console.log(JSON.stringify(summary, null, 2));
if (!apply) process.exit(0);
const backup = path.join(local, 'n8n-backups', batch);
mkdirSync(backup, { recursive: true });
writeFileSync(path.join(backup, 'previous-workflows.json'), JSON.stringify(current, null, 2), { mode: 0o600 });
for (const workflow of prepared) {
  const importPath = `/tmp/stockflow-import-${batch}.json`;
  try {
    docker(['exec', '-i', 'n8n', 'node', '-e', `require('fs').writeFileSync('${importPath}',require('fs').readFileSync(0),{mode:384})`], JSON.stringify(workflow));
    docker(['exec', 'n8n', 'n8n', 'import:workflow', `--input=${importPath}`]);
    docker(['exec', 'n8n', 'n8n', 'publish:workflow', `--id=${workflow.id}`]);
  } finally { docker(['exec', 'n8n', 'node', '-e', `require('fs').rmSync('${importPath}',{force:true})`]); }
}
// Check the stored source before claiming that any setting was applied.
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const verifyPath = `/tmp/stockflow-verify-update-${batch}.json`;
try {
  docker(['exec', 'n8n', 'n8n', 'export:workflow', '--all', `--output=${verifyPath}`]);
  const stored = JSON.parse(docker(['exec', 'n8n', 'node', '-e', `process.stdout.write(require('fs').readFileSync('${verifyPath}','utf8'))`]));
  for (const expected of prepared) {
    const actual = stored.find(value => value.id === expected.id);
    if (!actual || hash(actual.nodes) !== hash(expected.nodes) || hash(actual.connections) !== hash(expected.connections)) throw new Error('Stored workflow verification failed. Delivery status was not marked enabled.');
  }
} finally { docker(['exec', 'n8n', 'node', '-e', `require('fs').rmSync('${verifyPath}',{force:true})`]); }
if (!deferRestart) {
  docker(['restart', 'n8n']);
  let healthy = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    try { healthy = (await fetch('http://localhost:5678/healthz', { signal: AbortSignal.timeout(1500) })).ok; } catch { /* Wait for the restarted instance. */ }
    if (healthy) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (!healthy) throw new Error('n8n did not become healthy after publishing. Check local Docker logs.');
}
writeFileSync(path.join(local, 'automation-status.json'), JSON.stringify({ installedAt: new Date().toISOString(), workflows: prepared.map(workflow => workflow.id), deliveryMode: 'discord', destination: summary.destination, enabledWorkflows: enableLowStock ? ['StockFlowCritical01'] : [], restartPending: deferRestart, discordCredentialId: discord?.id || null, channelId: confirmation?.channelId || null, gmailCanceled: true, reason: enableLowStock ? 'Critical-stock alerts enabled for the confirmed Discord channel. All other workflows remain previews.' : 'Discord workflows installed with delivery disabled.', openAiCalls: 0 }, null, 2));
console.log('Local workflow update complete. Existing delivery markers and order baselines were preserved.');
