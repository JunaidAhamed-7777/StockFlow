import { randomUUID } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { validateRuntimeConfig, validateN8nContainer } from '../scripts/runtime-safety.mjs';
import { validateGmailCredential } from './gmail-config.mjs';

export const TEST_WORKFLOW_ID = 'StockFlowGmailTest01';
export const TEST_DESTINATION = 'junuhammad2@gmail.com';
const TEST_NODE = 'Send connection test';
const USAGE = 'node automations/test-gmail-local.mjs [--send --gmail-credential-id=ID] [--repeat]';

export function parseConnectionTestArgs(args) {
  const options = { send: false, repeat: false, credentialId: undefined };
  const seen = new Set();
  for (const argument of args) {
    const key = argument.startsWith('--gmail-credential-id=') ? '--gmail-credential-id' : argument;
    if (seen.has(key)) throw new Error(`Duplicate connection-test option. Usage: ${USAGE}`);
    seen.add(key);
    if (argument === '--send') options.send = true;
    else if (argument === '--repeat') options.repeat = true;
    else if (key === '--gmail-credential-id') {
      options.credentialId = argument.slice('--gmail-credential-id='.length);
      if (!/^[a-zA-Z0-9_-]{1,64}$/.test(options.credentialId)) throw new Error('Use one valid n8n Gmail credential ID.');
    } else throw new Error(`Unknown connection-test option. Usage: ${USAGE}`);
  }
  if (options.send && !options.credentialId) throw new Error('Sending a connection test requires --gmail-credential-id=ID.');
  if (options.repeat && !options.send) throw new Error('--repeat is valid only with an explicit --send.');
  return options;
}

export function createConnectionTestWorkflow(gmail = { id: 'REVIEW_ONLY', name: 'Choose a send-only Gmail credential' }) {
  if (!gmail || !/^[a-zA-Z0-9_-]{1,64}$/.test(gmail.id) || typeof gmail.name !== 'string' || !gmail.name.trim()) throw new Error('Invalid connection-test credential reference.');
  return {
    id: TEST_WORKFLOW_ID, name: 'StockFlow · Gmail CONNECTION TEST (manual only)', active: false,
    nodes: [
      { id: 'manual-connection-test', name: 'Manual connection test', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} },
      {
        id: 'send-connection-test', name: TEST_NODE, type: 'n8n-nodes-base.gmail', typeVersion: 2.2, position: [260, 0],
        parameters: {
          authentication: 'oAuth2', resource: 'message', operation: 'send', sendTo: TEST_DESTINATION,
          subject: '[REDIRECTED] StockFlow CONNECTION TEST', emailType: 'text',
          message: [
            'CONNECTION TEST — fictional StockFlow owner attribution.',
            'Intended stock owner: Supplier Test',
            'Intended owner email: supplier.test@stockflow.local',
            'Supplier ID: 1',
            `Actual testing destination: ${TEST_DESTINATION}`,
            'The fictional owner was not emailed. This test is redirected only to the address above.',
            '',
            'This message checks the local n8n Gmail OAuth connection only.',
            'It is not an inventory alert and makes no claim about current stock or orders.',
            'No OpenAI request, prediction, attachment, or automatic follow-up is part of this test.',
          ].join('\n'),
          options: { appendAttribution: false },
        },
        credentials: { gmailOAuth2: { id: gmail.id, name: gmail.name } }, retryOnFail: false, onError: 'stopWorkflow',
      },
    ],
    connections: { 'Manual connection test': { main: [[{ node: TEST_NODE, type: 'main', index: 0 }]] } },
    settings: { executionOrder: 'v1', timezone: 'Asia/Kolkata', saveDataSuccessExecution: 'none', saveDataErrorExecution: 'none', saveManualExecutions: false, saveExecutionProgress: false, executionTimeout: 60 },
    staticData: null, pinData: {},
  };
}

export function assertSafeConnectionTestWorkflow(actual, expected) {
  const refuse = () => { throw new Error('Connection-test draft differs from the exact inactive manual-only template. No workflow executed or replaced.'); };
  if (!actual || actual.id !== TEST_WORKFLOW_ID || actual.active !== false || actual.activeVersionId || actual.activeVersion || actual.isArchived === true) refuse();
  for (const field of ['id', 'name', 'nodes', 'connections', 'settings']) {
    if (JSON.stringify(actual[field]) !== JSON.stringify(expected[field])) refuse();
  }
  if (actual.pinData && Object.keys(actual.pinData).length) refuse();
  if (actual.staticData && Object.keys(actual.staticData).length) refuse();
}

/** Locate a complete JSON envelope without exposing preceding or following CLI logs. */
export function extractConnectionTestJson(raw, accepts) {
  if (typeof raw !== 'string') throw new Error('n8n returned no readable result. Raw output withheld.');
  for (let start = 0; start < raw.length; start++) {
    if (!['[', '{'].includes(raw[start])) continue;
    const stack = [];
    let quoted = false;
    let escaped = false;
    for (let end = start; end < raw.length; end++) {
      const char = raw[end];
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') quoted = false;
        continue;
      }
      if (char === '"') quoted = true;
      else if (char === '[' || char === '{') stack.push(char);
      else if (char === ']' || char === '}') {
        if (stack.pop() !== (char === ']' ? '[' : '{')) break;
        if (!stack.length) {
          try { const value = JSON.parse(raw.slice(start, end + 1)); if (accepts(value)) return value; } catch { /* Try the next complete envelope. */ }
          break;
        }
      }
    }
  }
  throw new Error('n8n did not return the expected JSON result. Raw output withheld.');
}

export function summarizeConnectionTestResult(raw, exitStatus) {
  if (exitStatus !== 0) throw new Error('The Gmail connection test was not confirmed. Raw output withheld; inspect n8n privately before repeating.');
  const run = extractConnectionTestJson(raw, value => Boolean(value?.data?.resultData?.runData || value?.resultData?.runData));
  const result = run.data?.resultData || run.resultData;
  const executions = result.runData;
  const gmail = executions[TEST_NODE];
  const allowedNodes = new Set(['Manual connection test', TEST_NODE]);
  const failed = result.error || run.status === 'error' || run.finished === false || result.lastNodeExecuted !== TEST_NODE
    || Object.keys(executions).some(name => !allowedNodes.has(name))
    || Object.values(executions).some(entries => !Array.isArray(entries) || entries.some(entry => entry.error || (entry.executionStatus && entry.executionStatus !== 'success')))
    || !Array.isArray(gmail) || gmail.length !== 1;
  const main = gmail?.[0]?.data?.main;
  const item = main?.[0]?.[0]?.json;
  if (failed || !Array.isArray(main) || main.length !== 1 || main[0].length !== 1 || item?.error || typeof item?.id !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(item.id)) {
    throw new Error('The Gmail connection test was not confirmed. Raw output withheld; inspect n8n privately before repeating.');
  }
  return { success: true, messageId: item.id };
}

export function assertCanSendConnectionTest(marker, { credentialId, repeat = false }) {
  if (!marker) return;
  if (marker.credentialId !== credentialId || marker.destination !== TEST_DESTINATION || !['confirmed', 'pending', 'unknown'].includes(marker.status)) throw new Error('The private connection-test marker is invalid. No email sent.');
  if (!repeat) throw new Error('A connection test was already attempted for this credential. Inspect the private marker and use --repeat only when another email is intended.');
}

export function runLocalGmailConnectionTest(args = process.argv.slice(2)) {
  const options = parseConnectionTestArgs(args);
  if (!options.send) {
    const workflow = createConnectionTestWorkflow(options.credentialId ? { id: options.credentialId, name: 'Selected credential (not inspected in dry run)' } : undefined);
    const mail = workflow.nodes[1].parameters;
    const review = { dryRun: true, sent: false, workflowId: TEST_WORKFLOW_ID, destination: mail.sendTo, subject: mail.subject, message: mail.message, requiredScope: 'https://www.googleapis.com/auth/gmail.send', draftRetainedIfSent: true, command: USAGE };
    console.log(JSON.stringify(review, null, 2));
    return review;
  }
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const local = path.join(root, '.local');
  const runtime = JSON.parse(readFileSync(path.join(local, 'runtime.json'), 'utf8'));
  validateRuntimeConfig(runtime);
  const docker = (command, input) => {
    const result = spawnSync('docker', command, { input, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, timeout: 120000, windowsHide: true });
    if (result.status !== 0) throw new Error('Local n8n operation failed. Raw output withheld because it may contain credentials.');
    return result.stdout;
  };
  validateN8nContainer(JSON.parse(docker(['inspect', 'n8n']))[0], runtime.n8nContainerId);
  const markerDir = path.join(local, 'gmail-connection-tests');
  mkdirSync(markerDir, { recursive: true });
  const markerPath = path.join(markerDir, `${options.credentialId}.json`);
  const lockPath = path.join(markerDir, 'send.lock');
  let lock;
  try { lock = openSync(lockPath, 'wx', 0o600); } catch { throw new Error('Another Gmail test is running or an interrupted-test lock remains. No email sent.'); }
  let attempted = false;
  const saveMarker = value => writeFileSync(markerPath, JSON.stringify({ credentialId: options.credentialId, destination: TEST_DESTINATION, ...value }, null, 2), { mode: 0o600 });
  const exportWorkflows = () => {
    const filename = `/tmp/stockflow-gmail-inspect-${randomUUID()}.json`;
    try {
      docker(['exec', 'n8n', 'n8n', 'export:workflow', '--all', `--output=${filename}`]);
      return JSON.parse(docker(['exec', 'n8n', 'node', '-e', `process.stdout.write(require('fs').readFileSync('${filename}','utf8'))`]));
    } finally { docker(['exec', 'n8n', 'node', '-e', `require('fs').rmSync('${filename}',{force:true})`]); }
  };
  try {
    assertCanSendConnectionTest(existsSync(markerPath) ? JSON.parse(readFileSync(markerPath, 'utf8')) : null, options);
    const rawCredential = docker(['exec', 'n8n', 'n8n', 'export:credentials', `--id=${options.credentialId}`, '--decrypted']);
    const credentials = extractConnectionTestJson(rawCredential, Array.isArray);
    const gmail = validateGmailCredential(credentials.find(value => value.id === options.credentialId), options.credentialId);
    const expected = createConnectionTestWorkflow(gmail);
    const previous = exportWorkflows().find(value => value.id === TEST_WORKFLOW_ID);
    if (previous) assertSafeConnectionTestWorkflow(previous, expected);
    const filename = `/tmp/stockflow-gmail-test-${randomUUID()}.json`;
    try {
      docker(['exec', '-i', 'n8n', 'node', '-e', `require('fs').writeFileSync('${filename}',require('fs').readFileSync(0),{mode:384})`], JSON.stringify(expected));
      docker(['exec', 'n8n', 'n8n', 'import:workflow', `--input=${filename}`]);
    } finally { docker(['exec', 'n8n', 'node', '-e', `require('fs').rmSync('${filename}',{force:true})`]); }
    // Re-export immediately before execution; never publish or add an automatic trigger.
    assertSafeConnectionTestWorkflow(exportWorkflows().find(value => value.id === TEST_WORKFLOW_ID), expected);
    saveMarker({ status: 'pending', attemptedAt: new Date().toISOString() });
    attempted = true;
    const rawResult = docker(['exec', '-e', 'N8N_RUNNERS_BROKER_PORT=5681', 'n8n', 'n8n', 'execute', `--id=${TEST_WORKFLOW_ID}`, '--rawOutput']);
    const result = summarizeConnectionTestResult(rawResult, 0);
    saveMarker({ status: 'confirmed', confirmedAt: new Date().toISOString(), messageId: result.messageId });
    attempted = false;
    console.log(JSON.stringify(result));
    return result;
  } catch (error) {
    if (attempted) saveMarker({ status: 'unknown', attemptedAt: new Date().toISOString() });
    throw error;
  } finally {
    closeSync(lock);
    rmSync(lockPath, { force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { runLocalGmailConnectionTest(); } catch (error) {
    // Exception values from credential-bearing subprocesses are never printed.
    console.error(error instanceof SyntaxError ? 'Local test data was invalid. No confirmed email; raw output withheld.' : error.message);
    process.exitCode = 1;
  }
}
