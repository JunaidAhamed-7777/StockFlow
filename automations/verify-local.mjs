import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertLocalN8n, parseCliJson } from './local-n8n.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const WORKFLOW_MODES = Object.freeze({
  StockFlowCritical01: 'low-stock',
  StockFlowDigest01: 'daily-digest',
  StockFlowOrders01: 'stale-orders',
  StockFlowAudit01: 'inventory-audit',
  StockFlowUpdates01: 'order-updates',
});

/** Exclude UI placement and the Discord webhook credential reference; fingerprint all executable behavior. */
export function previewWorkflowFingerprint(workflow) {
  const fingerprint = {
    id: workflow.id,
    nodes: workflow.nodes.filter((node) => node.type !== 'n8n-nodes-base.stickyNote').map((node) => ({
      id: node.id, name: node.name, type: node.type, typeVersion: node.typeVersion, parameters: node.parameters,
      credentials: node.name === 'Send Discord notification' && node.type === 'n8n-nodes-base.discord' ? null : node.credentials || null,
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
  const destination = 'discord-channel';
  const settings = `return [{json: {apiBaseUrl: 'http://host.docker.internal:3001/api', mode: '${mode}', deliveryMode: 'discord', notificationsEnabled: false, criticalRatio: 0.5, reminderHours: 24, auditRecipientEmail: 'admin.test@stockflow.local'}}];`;
  const settingsNode = find('Settings');
  if (settingsNode.type !== 'n8n-nodes-base.code' || settingsNode.parameters?.jsCode !== settings) refuse();
  const discord = find('Send Discord notification');
  const transport = { authentication: 'webhook', operation: 'sendLegacy', content: '={{ $json.discordContent }}', options: { wait: true, flags: ['SUPPRESS_EMBEDS'], tts: false } };
  if (discord.type !== 'n8n-nodes-base.discord' || discord.typeVersion !== 2 || JSON.stringify(discord.parameters) !== JSON.stringify(transport) || discord.retryOnFail !== false) refuse();
  const guard = find('Delivery enabled');
  const expectedExpression = `={{ $json.kind === 'notification' && $json.deliveryEnabled === true && $json.deliveryMode === 'discord' && $json.to === '${destination}' && typeof $json.intendedRecipient?.email === 'string' && $json.intendedRecipient.email.length > 0 && typeof $json.intendedRecipient.name === 'string' && Number.isSafeInteger($json.intendedRecipient.supplierId) }}`;
  const conditions = guard.parameters?.conditions;
  if (guard.type !== 'n8n-nodes-base.if' || conditions?.conditions?.length !== 1 || conditions.combinator !== 'and' || conditions.conditions[0].leftValue !== expectedExpression || conditions.conditions[0].operator?.type !== 'boolean' || conditions.conditions[0].operator?.operation !== 'true') refuse();
  const incoming = (target) => Object.entries(workflow.connections || {}).flatMap(([from, value]) => (value.main || []).flatMap((branch, index) => (branch || []).filter(({ node }) => node === target).map(() => `${from}:${index}`)));
  if (JSON.stringify(incoming('Prepare Discord message')) !== JSON.stringify(['Delivery enabled:0']) || JSON.stringify(incoming('Send Discord notification')) !== JSON.stringify(['Prepare Discord message:0']) || JSON.stringify(incoming('Remember successful delivery')) !== JSON.stringify(['Send Discord notification:0'])) refuse();
  if (workflow.nodes.some((node) => node.disabled === true || node.type === 'n8n-nodes-base.gmail') || workflow.nodes.filter((node) => node.type === 'n8n-nodes-base.discord').length !== 1 || workflow.settings?.errorWorkflow) refuse();
}

export function assertMatchingPreviewWorkflow(expected, actual) {
  assertSafePreviewSource(expected, WORKFLOW_MODES[expected.id]);
  if (hashPreviewWorkflow(actual) !== hashPreviewWorkflow(expected)) {
    throw new Error(`Refusing to test ${expected.id}: executable nodes, notification transport, code, settings, pinned data, or routing differ from the disabled-delivery source. No workflow executed.`);
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
    throw new Error(`Refusing to test ${expected.id}: executable nodes, notification transport, code, settings, pinned data, or routing differ from the disabled-delivery source. No workflow executed.`);
  }
}

/** Whitelist preview fields so neither raw HTTP responses nor the login JWT enter logs or reports. */
export function summarizePreviewItem(item) {
  const json = item?.json || {};
  return {
    mode: json.mode, deliveryEnabled: json.deliveryEnabled !== false,
    deliveryMode: json.deliveryMode, to: json.to || null,
    intendedRecipient: json.intendedRecipient ? { supplierId: json.intendedRecipient.supplierId, name: json.intendedRecipient.name, email: json.intendedRecipient.email } : null,
    supplierId: json.supplierId ?? null, checkedProducts: json.checkedProducts, checkedOrders: json.checkedOrders,
    skipped: Array.isArray(json.skipped) ? json.skipped.map((entry) => ({ supplierId: entry.supplierId, reason: entry.reason })) : [],
    eventCount: json.eventCount || 0, note: json.note,
  };
}

export function createPreviewReport(workflow, result) {
  let run;
  try { run = parseCliJson(result.stdout || '', (value) => Boolean(value?.data?.resultData || value?.resultData || value?.data?.runData || value?.runData)); }
  catch { /* Do not expose raw, potentially credential-bearing output. */ }
  const data = run?.data?.resultData || run?.resultData || run?.data || run;
  const runs = data?.runData && typeof data.runData === 'object' && !Array.isArray(data.runData) ? data.runData : {};
  const known = new Set(workflow.nodes.map((node) => node.name));
  const entries = Object.entries(runs);
  const validRuns = entries.every(([name, rows]) => known.has(name) && Array.isArray(rows) && rows.length > 0 && rows.every((row) => row && !row.error && (!row.executionStatus || row.executionStatus === 'success')));
  const deliveryPathPresent = ['Prepare Discord message', 'Send Discord notification', 'Remember successful delivery'].some((name) => Object.hasOwn(runs, name));
  const previewRuns = runs['Preview only'];
  const previewShape = Array.isArray(previewRuns) && previewRuns.every((entry) => Array.isArray(entry?.data?.main) && entry.data.main.every(Array.isArray));
  const previewItems = previewShape ? previewRuns.flatMap((entry) => entry.data.main.flat()) : [];
  const validPreview = previewItems.every((item) => item?.json && !item.json.error && item.json.deliveryEnabled === false);
  const preview = previewItems.map(summarizePreviewItem);
  const calls = (pattern) => entries.filter(([name]) => pattern.test(name)).reduce((count, [, rows]) => count + (Array.isArray(rows) ? rows.length : 1), 0);
  const notificationCalls = calls(/^Send Discord notification$/);
  const gmailCalls = calls(/gmail/i);
  const openAiCalls = calls(/openai|language model|\bagent\b/i);
  const envelopeSuccess = run && !run.error && (run.finished === undefined || run.finished === true) && (run.status === undefined || run.status === 'success');
  const success = result.status === 0 && envelopeSuccess && !data?.error && validRuns && !deliveryPathPresent && validPreview && data?.lastNodeExecuted === 'Preview only' && preview.length > 0 && notificationCalls === 0 && gmailCalls === 0 && openAiCalls === 0;
  const report = { id: workflow.id, success: Boolean(success), lastNode: known.has(data?.lastNodeExecuted) ? data.lastNodeExecuted : null, preview, notificationCalls, gmailCalls, openAiCalls };
  if (!report.success) report.error = 'CLI verification did not finish safely at the preview node. Raw credential-bearing output was withheld.';
  return report;
}

export function verifyLocalPreviews({
  projectRoot = root, readWorkflow = (mode) => JSON.parse(readFileSync(path.join(projectRoot, `automations/workflows/stockflow-${mode}.json`), 'utf8')),
  assertLocal = assertLocalN8n, inspectWorkflow = inspectInstalledWorkflow,
  executeWorkflow = (id) => spawnSync('docker', ['exec', '-e', 'N8N_RUNNERS_BROKER_PORT=5680', 'n8n', 'n8n', 'execute', `--id=${id}`, '--rawOutput'], { encoding: 'utf8', maxBuffer: 15 * 1024 * 1024, timeout: 120000, windowsHide: true }),
  writeReport = (value) => {
    mkdirSync(path.join(projectRoot, '.local'), { recursive: true });
    writeFileSync(path.join(projectRoot, '.local/automation-verification.json'), JSON.stringify(value, null, 2), { mode: 0o600 });
  }, log = console.log,
} = {}) {
  const sources = Object.entries(WORKFLOW_MODES).map(([id, mode]) => {
    const workflow = readWorkflow(mode);
    if (workflow.id !== id) throw new Error(`Unexpected workflow ID in the ${mode} template. No workflow executed.`);
    assertSafePreviewSource(workflow, mode);
    return workflow;
  });
  try { assertLocal(); }
  catch { throw new Error('Cannot verify the owned local n8n runtime. No workflow executed; private output was withheld.'); }
  // Inspect every workflow before executing any. A single live or edited workflow blocks the entire verifier.
  for (const workflow of sources) inspectWorkflow(workflow);
  const reports = [];
  for (const workflow of sources) {
    const { id } = workflow;
    // Recheck immediately before each run in case someone edited a workflow after the full preflight.
    inspectWorkflow(workflow);
    // A separate broker port lets the supported CLI run beside the n8n daemon.
    // Raw CLI output stays in memory because it contains the short-lived API JWT.
    let result;
    try { result = executeWorkflow(id); }
    catch { result = { status: 1, stdout: '' }; }
    const report = createPreviewReport(workflow, result);
    reports.push(report);
    log(JSON.stringify(report));
    if (!report.success) break;
  }
  writeReport({ checkedAt: new Date().toISOString(), reports });
  return reports;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const reports = verifyLocalPreviews();
  if (reports.some((report) => !report.success)) process.exitCode = 1;
}
