import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { validateRuntimeConfig, validateN8nContainer } from '../scripts/runtime-safety.mjs';
import './build-workflows.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const local = path.join(root, '.local');
const args = process.argv.slice(2);
const enableLowStock = args.includes('--enable-low-stock');
const apply = args.includes('--apply');
const idOption = args.find(value => value.startsWith('--gmail-credential-id='));
if (args.some(value => !['--apply', '--enable-low-stock'].includes(value) && !value.startsWith('--gmail-credential-id='))) throw new Error('Usage: node automations/update-local.mjs [--apply] [--enable-low-stock] [--gmail-credential-id=ID]');
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
const credentialId = idOption?.slice('--gmail-credential-id='.length) || byId.get('StockFlowCritical01')?.nodes.find(node => node.name === 'Send owner Gmail')?.credentials?.gmailOAuth2?.id;
let gmail;
if (enableLowStock) {
  if (!credentialId || !/^[a-zA-Z0-9_-]{1,64}$/.test(credentialId)) throw new Error('Choose the connected Gmail credential with --gmail-credential-id=ID before enabling delivery.');
  // The supported CLI can check encrypted credentials. Its decrypted stdout stays only in memory.
  const raw = docker(['exec', 'n8n', 'n8n', 'export:credentials', `--id=${credentialId}`, '--decrypted']);
  let credentials;
  for (let start = raw.indexOf('['); start >= 0 && !credentials; start = raw.indexOf('[', start + 1)) {
    try { const value = JSON.parse(raw.slice(start, raw.lastIndexOf(']') + 1)); if (Array.isArray(value)) credentials = value; } catch { /* CLI notices can precede the JSON array. */ }
  }
  const credential = credentials?.find(value => value.id === credentialId && value.type === 'gmailOAuth2');
  const data = credential?.data;
  const scopes = String(data?.enabledScopes || '').trim().split(/\s+/);
  if (data?.customScopes !== true || scopes.length !== 1 || scopes[0] !== 'https://www.googleapis.com/auth/gmail.send' || !data.oauthTokenData?.access_token || !data.oauthTokenData?.refresh_token) throw new Error('Gmail must be connected with only gmail.send and offline refresh access before delivery can be enabled.');
  gmail = { id: credential.id, name: credential.name };
}
const prepared = sources.map(source => {
  const previous = byId.get(source.id);
  source.staticData = previous?.staticData ?? null;
  const loginCredential = previous?.nodes.find(node => node.name === 'StockFlow login')?.credentials;
  if (loginCredential) source.nodes.find(node => node.name === 'StockFlow login').credentials = loginCredential;
  const existingGmail = previous?.nodes.find(node => node.name === 'Send owner Gmail')?.credentials?.gmailOAuth2;
  if (gmail || existingGmail) source.nodes.find(node => node.name === 'Send owner Gmail').credentials = { gmailOAuth2: gmail || existingGmail };
  if (enableLowStock && source.id === 'StockFlowCritical01') source.nodes.find(node => node.name === 'Settings').parameters.jsCode = source.nodes.find(node => node.name === 'Settings').parameters.jsCode.replace('mailEnabled: false', 'mailEnabled: true');
  return source;
});
const summary = { apply, destination: 'junuhammad2@gmail.com', workflows: prepared.map(workflow => ({ id: workflow.id, name: workflow.name, deliveryEnabled: enableLowStock && workflow.id === 'StockFlowCritical01', existingStatePreserved: byId.has(workflow.id) })) };
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
docker(['restart', 'n8n']);
writeFileSync(path.join(local, 'automation-status.json'), JSON.stringify({ installedAt: new Date().toISOString(), workflows: prepared.map(workflow => workflow.id), deliveryMode: 'redirect', redirectTo: summary.destination, enabledWorkflows: enableLowStock ? ['StockFlowCritical01'] : [], gmailCredentialId: gmail?.id || null, reason: enableLowStock ? 'Low-stock mail enabled with send-only Gmail OAuth. All other workflows remain in preview.' : 'All workflows installed with redirected routing; Gmail delivery awaits OAuth connection.', openAiCalls: 0 }, null, 2));
console.log('Local workflow update complete. Existing delivery markers and order baselines were preserved.');
