import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reports = [];
for (const id of ['StockFlowCritical01', 'StockFlowDigest01', 'StockFlowOrders01']) {
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
