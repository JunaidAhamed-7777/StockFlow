import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import jwt from 'jsonwebtoken';
import './build-workflows.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const local = path.join(root, '.local');
mkdirSync(local, { recursive: true });
const runtime = JSON.parse(readFileSync(path.join(local, 'runtime.json'), 'utf8'));
if (runtime.isolatedDemo !== true || new URL(runtime.databaseUrl).port !== '55432') throw new Error('Only the isolated local demo may be provisioned automatically.');
function docker(args, input) {
  const result = spawnSync('docker', args, { input, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`n8n setup command failed (${args.slice(0, 4).join(' ')}). Check Docker/n8n locally.`);
  return result.stdout;
}
const accountPath = path.join(local, 'automation-account.json');
let account = existsSync(accountPath) ? JSON.parse(readFileSync(accountPath, 'utf8')) : null;
// Prove that this API is using this isolated checkout's JWT configuration before any account writes.
const identityResponse = await fetch('http://localhost:3001/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: account?.email || process.env.DEMO_ADMIN_EMAIL || 'admin.test@stockflow.local', password: account?.password || process.env.DEMO_ADMIN_PASSWORD || 'AdminTest2026!' }), signal: AbortSignal.timeout(15000) });
if (!identityResponse.ok) throw new Error('Cannot verify the isolated local API identity. No account changes made.');
const identity = (await identityResponse.json()).data;
if (identity?.user?.role !== 'ADMIN' || jwt.verify(identity.token, runtime.jwtSecret, { algorithms: ['HS256'] }).userId !== identity.user.id) throw new Error('API does not match this local runtime. No account changes made.');
if (!account) {
  account = { name: 'StockFlow Local Automation', email: 'automation@stockflow.test', password: randomBytes(30).toString('base64url'), role: 'ADMIN' };
  const response = await fetch('http://localhost:3001/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(account), signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error('Automation account could not be created. Refusing to overwrite an existing account.');
  writeFileSync(accountPath, JSON.stringify(account, null, 2), { mode: 0o600 });
}
const login = await fetch('http://localhost:3001/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: account.email, password: account.password }), signal: AbortSignal.timeout(15000) });
if (!login.ok || (await login.json()).data?.user?.role !== 'ADMIN') throw new Error('Automation account cannot read the required local inventory.');
const listing = docker(['exec', 'n8n', 'n8n', 'list:workflow']);
const workflowIds = ['StockFlowCritical01', 'StockFlowDigest01', 'StockFlowOrders01', 'StockFlowAudit01', 'StockFlowUpdates01'];
const missing = workflowIds.filter((id) => !listing.includes(id));
const activeIds = docker(['exec', 'n8n', 'n8n', 'list:workflow', '--active=true', '--onlyId']);
if (missing.length) {
  const temporaryCredential = path.join(local, 'n8n-credential-import.json');
  writeFileSync(temporaryCredential, JSON.stringify([{ id: 'StockFlowApiLogin01', name: 'StockFlow API login (local demo)', type: 'httpCustomAuth', data: { json: JSON.stringify({ body: { email: account.email, password: account.password } }) } }]), { mode: 0o600 });
  try {
    docker(['cp', temporaryCredential, 'n8n:/tmp/stockflow-api-login.json']);
    docker(['exec', 'n8n', 'n8n', 'import:credentials', '--input=/tmp/stockflow-api-login.json']);
  } finally {
    unlinkSync(temporaryCredential);
    docker(['exec', '--user', 'root', 'n8n', 'node', '-e', "require('fs').rmSync('/tmp/stockflow-api-login.json',{force:true})"]);
  }
}
for (const file of ['stockflow-low-stock.json', 'stockflow-daily-digest.json', 'stockflow-stale-orders.json', 'stockflow-inventory-audit.json', 'stockflow-order-updates.json']) {
  const workflow = JSON.parse(readFileSync(path.join(root, 'automations/workflows', file), 'utf8'));
  if (!missing.includes(workflow.id)) {
    if (!activeIds.includes(workflow.id)) { docker(['exec', 'n8n', 'n8n', 'publish:workflow', `--id=${workflow.id}`]); console.log(`Published existing preview without resetting its state: ${workflow.name}`); }
    else console.log(`Kept existing workflow and delivery state: ${workflow.name}`);
    continue;
  }
  docker(['cp', path.join(root, 'automations/workflows', file), `n8n:/tmp/${file}`]);
  try {
    docker(['exec', 'n8n', 'n8n', 'import:workflow', `--input=/tmp/${file}`]);
    docker(['exec', 'n8n', 'n8n', 'publish:workflow', `--id=${workflow.id}`]);
    console.log(`Installed scheduled preview: ${workflow.name}`);
  } finally { docker(['exec', '--user', 'root', 'n8n', 'node', '-e', `require('fs').rmSync('/tmp/${file}',{force:true})`]); }
}
if (missing.length || workflowIds.some(id => !activeIds.includes(id))) docker(['restart', 'n8n']);
const previousStatus = existsSync(path.join(local, 'automation-status.json')) ? JSON.parse(readFileSync(path.join(local, 'automation-status.json'), 'utf8')) : {};
writeFileSync(path.join(local, 'automation-status.json'), JSON.stringify({ ...previousStatus, installedAt: new Date().toISOString(), workflows: workflowIds, note: 'New templates start in preview; existing workflow delivery settings were preserved. Use update-local.mjs to apply source changes.', openAiCalls: 0 }, null, 2));
console.log('n8n workflows installed locally. New workflows start in preview; existing delivery settings were preserved. No test mail or OpenAI calls made.');
