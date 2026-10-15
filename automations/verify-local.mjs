import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const WORKFLOW_MODES = Object.freeze({
  StockFlowCritical01: 'low-stock',
  StockFlowDigest01: 'daily-digest',
  StockFlowOrders01: 'stale-orders',
  StockFlowAudit01: 'inventory-audit',
  StockFlowUpdates01: 'order-updates',
});

/** Exclude UI placement and attached Gmail credential IDs; include every executable node and behavior. */
export function previewWorkflowFingerprint(workflow) {
  const fingerprint = {
    id: workflow.id,
    nodes: workflow.nodes.filter((node) => node.type !== 'n8n-nodes-base.stickyNote').map((node) => ({
      id: node.id, name: node.name, type: node.type, typeVersion: node.typeVersion, parameters: node.parameters,
      credentials: node.type === 'n8n-nodes-base.gmail' ? null : node.credentials || null,
      disabled: node.disabled === true, executeOnce: node.executeOnce === true,
      alwaysOutputData: node.alwaysOutputData === true, continueOnFail: node.continueOnFail === true,
      retryOnFail: node.retryOnFail === true, maxTries: node.maxTries ?? null, waitBetweenTries: node.waitBetweenTries ?? null,
      onError: node.onError || 'stopWorkflow',
    })).sort((one, two) => one.name < two.name ? -1 : one.name > two.name ? 1 : 0),
    connections: workflow.connections,
    pinnedData: workflow.pinData || {},
    settings: {
      executionOrder: workflow.settings?.executionOrder,
      timezone: workflow.settings?.timezone,
      errorWorkflow: workflow.settings?.errorWorkflow || '',
      saveDataSuccessExecution: workflow.settings?.saveDataSuccessExecution,
      saveDataErrorExecution: workflow.settings?.saveDataErrorExecution,
      saveManualExecutions: workflow.settings?.saveManualExecutions === true,
      saveExecutionProgress: workflow.settings?.saveExecutionProgress === true,
    },
  };
  // n8n may reorder JSON object properties when saving; arrays and every value remain significant.
  const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
  return canonical(fingerprint);
}

export function hashPreviewWorkflow(workflow) {
  return createHash('sha256').update(JSON.stringify(previewWorkflowFingerprint(workflow))).digest('hex');
}

/** This verifier runs disabled templates only; it must never be used to test delivery-enabled workflows. */
export function assertSafePreviewSource(workflow, mode) {
  const refuse = () => { throw new Error(`Refusing to test ${workflow.id}: source is not the fixed, disabled-delivery preview template. No workflow executed.`); };
  if (WORKFLOW_MODES[workflow.id] !== mode || !Array.isArray(workflow.nodes) || Object.keys(workflow.pinData || {}).length) refuse();
  const find = (name) => {
    const matching = workflow.nodes.filter((node) => node.name === name);
    if (matching.length !== 1) refuse();
    return matching[0];
  };
  const destination = 'junuhammad2@gmail.com';
  const settings = `return [{json: {apiBaseUrl: 'http://host.docker.internal:3001/api', mode: '${mode}', deliveryMode: 'redirect', redirectTo: '${destination}', mailEnabled: false, criticalRatio: 0.5, reminderHours: 24, auditRecipientEmail: 'admin.test@stockflow.local'}}];`;
  const settingsNode = find('Settings');
  if (settingsNode.type !== 'n8n-nodes-base.code' || settingsNode.parameters?.jsCode !== settings) refuse();
  const gmail = find('Send owner Gmail');
  const transport = { authentication: 'oAuth2', resource: 'message', operation: 'send', sendTo: destination, subject: '={{ $json.subject }}', emailType: 'text', message: '={{ $json.message }}', options: { appendAttribution: false } };
  if (gmail.type !== 'n8n-nodes-base.gmail' || JSON.stringify(gmail.parameters) !== JSON.stringify(transport)) refuse();
  const guard = find('Delivery enabled');
  const expectedExpression = `={{ $json.kind === 'notification' && $json.deliveryEnabled === true && $json.deliveryMode === 'redirect' && $json.to === '${destination}' && typeof $json.intendedRecipient?.email === 'string' && $json.intendedRecipient.email.length > 0 && typeof $json.intendedRecipient.name === 'string' && Number.isSafeInteger($json.intendedRecipient.supplierId) }}`;
  const conditions = guard.parameters?.conditions;
  if (guard.type !== 'n8n-nodes-base.if' || conditions?.conditions?.length !== 1 || conditions.combinator !== 'and' || conditions.conditions[0].leftValue !== expectedExpression || conditions.conditions[0].operator?.type !== 'boolean' || conditions.conditions[0].operator?.operation !== 'true') refuse();
  if (workflow.nodes.some((node) => node.disabled === true) || workflow.settings?.errorWorkflow) refuse();
}

export function assertMatchingPreviewWorkflow(expected, actual) {
  assertSafePreviewSource(expected, WORKFLOW_MODES[expected.id]);
  if (hashPreviewWorkflow(actual) !== hashPreviewWorkflow(expected)) {
    throw new Error(`Refusing to test ${expected.id}: executable nodes, mail transport, code, settings, pinned data, or routing differ from the disabled-delivery source. No workflow executed.`);
  }
}

function inspectInstalledWorkflow(expected) {
  const temporaryPath = `/tmp/stockflow-verify-${expected.id}-${randomUUID()}.json`;
  const exported = spawnSync('docker', ['exec', 'n8n', 'n8n', 'export:workflow', `--id=${expected.id}`, `--output=${temporaryPath}`], { encoding: 'utf8', timeout: 30000 });
  if (exported.status !== 0) throw new Error(`Cannot inspect ${expected.id}. No workflow executed; raw n8n output was withheld.`);
  // Hash inside the container: workflow source, credentials, static data, and run data are never printed.
  const inspectionCode = `const fs=require('fs'),crypto=require('crypto');try{const workflow=JSON.parse(fs.readFileSync('${temporaryPath}','utf8'))[0];const projection=(${previewWorkflowFingerprint.toString()})(workflow);console.log(JSON.stringify({fingerprint:crypto.createHash('sha256').update(JSON.stringify(projection)).digest('hex')}));}finally{fs.rmSync('${temporaryPath}',{force:true});}`;
  const inspection = spawnSync('docker', ['exec', 'n8n', 'node', '-e', inspectionCode], { encoding: 'utf8', timeout: 30000 });
  let actual;
  try { actual = inspection.status === 0 ? JSON.parse(inspection.stdout) : null; } catch { /* Never echo potentially sensitive process output. */ }
  if (!actual || actual.fingerprint !== hashPreviewWorkflow(expected)) {
    throw new Error(`Refusing to test ${expected.id}: executable nodes, mail transport, code, settings, pinned data, or routing differ from the disabled-delivery source. No workflow executed.`);
  }
}

/** Whitelist preview fields so neither raw HTTP responses nor the login JWT enter logs or reports. */
export function summarizePreviewItem(item) {
  const json = item?.json || {};
  return {
    mode: json.mode, deliveryEnabled: json.deliveryEnabled === true,
    deliveryMode: json.deliveryMode, to: json.to || null,
    intendedRecipient: json.intendedRecipient ? { supplierId: json.intendedRecipient.supplierId, name: json.intendedRecipient.name, email: json.intendedRecipient.email } : null,
    supplierId: json.supplierId ?? null, checkedProducts: json.checkedProducts, checkedOrders: json.checkedOrders,
    skipped: Array.isArray(json.skipped) ? json.skipped.map((entry) => ({ supplierId: entry.supplierId, reason: entry.reason })) : [],
    eventCount: json.eventCount || 0, note: json.note,
  };
}

export function verifyLocalPreviews() {
  const sources = Object.entries(WORKFLOW_MODES).map(([id, mode]) => {
    const workflow = JSON.parse(readFileSync(path.join(root, `automations/workflows/stockflow-${mode}.json`), 'utf8'));
    if (workflow.id !== id) throw new Error(`Unexpected workflow ID in the ${mode} template. No workflow executed.`);
    assertSafePreviewSource(workflow, mode);
    return workflow;
  });
  // Inspect every workflow before executing any. A single live or edited workflow blocks the entire verifier.
  for (const workflow of sources) inspectInstalledWorkflow(workflow);
  const reports = [];
  for (const workflow of sources) {
    const { id } = workflow;
    // Recheck immediately before each run in case someone edited a workflow after the full preflight.
    inspectInstalledWorkflow(workflow);
    // A separate broker port lets the supported CLI run beside the n8n daemon.
    // Raw CLI output stays in memory because it contains the short-lived API JWT.
    const result = spawnSync('docker', ['exec', '-e', 'N8N_RUNNERS_BROKER_PORT=5680', 'n8n', 'n8n', 'execute', `--id=${id}`, '--rawOutput'], { encoding: 'utf8', maxBuffer: 15 * 1024 * 1024, timeout: 120000 });
    const raw = result.stdout || '';
    let run;
    for (let index = raw.indexOf('{'); index >= 0 && !run; index = raw.indexOf('{', index + 1)) {
      try { run = JSON.parse(raw.slice(index)); } catch { /* CLI setup lines precede JSON. */ }
    }
    const data = run?.data?.resultData || run?.resultData || run?.data || run;
    const runs = data?.runData || {};
    const preview = runs['Preview only']?.flatMap((entry) => entry.data?.main?.flat() || []).map(summarizePreviewItem) || [];
    const emailCalls = runs['Send owner Gmail']?.length || 0;
    const report = { id, success: result.status === 0 && !data?.error && preview.length > 0 && emailCalls === 0 && preview.every((entry) => entry.deliveryEnabled === false), lastNode: data?.lastNodeExecuted, preview, emailCalls, openAiCalls: 0 };
    if (!report.success) report.error = 'CLI verification did not finish safely at the preview node. Raw credential-bearing output was withheld.';
    reports.push(report);
    console.log(JSON.stringify(report));
    if (emailCalls > 0) break;
  }
  mkdirSync(path.join(root, '.local'), { recursive: true });
  writeFileSync(path.join(root, '.local/automation-verification.json'), JSON.stringify({ checkedAt: new Date().toISOString(), reports }, null, 2));
  if (reports.some((report) => !report.success || report.emailCalls !== 0)) process.exitCode = 1;
  return reports;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) verifyLocalPreviews();
