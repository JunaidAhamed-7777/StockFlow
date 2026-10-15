import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reports = [];
for (const id of ['StockFlowCritical01', 'StockFlowDigest01', 'StockFlowOrders01']) {
  // Refuse to execute a workflow that has been switched to live delivery or rewired.
  const filenames = { StockFlowCritical01: 'low-stock', StockFlowDigest01: 'daily-digest', StockFlowOrders01: 'stale-orders' };
  const expected = JSON.parse(readFileSync(path.join(root, `automations/workflows/stockflow-${filenames[id]}.json`), 'utf8'));
  const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const temp = `/tmp/stockflow-verify-${id}.json`;
  const exported = spawnSync('docker', ['exec', 'n8n', 'n8n', 'export:workflow', `--id=${id}`, `--output=${temp}`], { encoding: 'utf8' });
  const inspect = spawnSync('docker', ['exec', 'n8n', 'node', '-e', `const f=require('fs'),c=require('crypto'),w=JSON.parse(f.readFileSync('${temp}','utf8'))[0];const h=v=>c.createHash('sha256').update(JSON.stringify(v)).digest('hex');console.log(JSON.stringify({settings:h(w.nodes.find(n=>n.name==='Settings').parameters),guard:h(w.nodes.find(n=>n.name==='Delivery enabled').parameters),connections:h(w.connections)}));f.rmSync('${temp}');`], { encoding: 'utf8' });
  const actual = inspect.status === 0 ? JSON.parse(inspect.stdout) : {};
  if (exported.status !== 0 || actual.settings !== hash(expected.nodes.find(node => node.name === 'Settings').parameters) || actual.guard !== hash(expected.nodes.find(node => node.name === 'Delivery enabled').parameters) || actual.connections !== hash(expected.connections)) {
    throw new Error(`Refusing to test ${id}: live settings or routing differ from the disabled-delivery source. No workflow executed.`);
  }
  // A separate broker port lets the supported CLI run beside the n8n daemon.
  // Keep the CLI's raw run data in memory: it contains the short-lived API JWT.
  const result = spawnSync('docker', ['exec', '-e', 'N8N_RUNNERS_BROKER_PORT=5680', 'n8n', 'n8n', 'execute', `--id=${id}`, '--rawOutput'], { encoding: 'utf8', maxBuffer: 15 * 1024 * 1024, timeout: 120000 });
  const raw = result.stdout || '';
  let run;
  for (let index = raw.indexOf('{'); index >= 0 && !run; index = raw.indexOf('{', index + 1)) {
    try { run = JSON.parse(raw.slice(index)); } catch { /* CLI setup lines precede JSON. */ }
  }
  const data = run?.data?.resultData || run?.resultData || run?.data || run;
  const runs = data?.runData || {};
  const preview = runs['Preview only']?.flatMap(entry => entry.data?.main?.flat() || []).map(item => item.json) || [];
  const error = data?.error;
  const report = { id, success: result.status === 0 && !error && preview.length > 0, lastNode: data?.lastNodeExecuted, preview, emailCalls: runs['Send owner Gmail']?.length || 0, openAiCalls: 0 };
  if (!report.success) report.error = error?.message || 'CLI verification did not finish at the preview node. Raw credential-bearing output was withheld.';
  reports.push(report);
  console.log(JSON.stringify(report));
}
mkdirSync(path.join(root, '.local'), { recursive: true });
writeFileSync(path.join(root, '.local/automation-verification.json'), JSON.stringify({ checkedAt: new Date().toISOString(), reports }, null, 2));
if (reports.some(report => !report.success || report.emailCalls !== 0)) process.exitCode = 1;
