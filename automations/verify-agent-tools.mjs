import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertLocalN8n, dockerCapture, localDirectory, parseCliJson } from './local-n8n.mjs';
import { ROLE_AGENT_WORKFLOWS, buildRoleAgentWorkflow } from './build-agent-workflows.mjs';

/** UI positions and notes do not execute. Every other node field remains significant. */
export function roleToolFingerprint(workflow) {
  const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
  const settings = { ...workflow.settings };
  // n8n inserts this disabled discovery default when persisting imported workflows.
  if (settings.availableInMCP === false) delete settings.availableInMCP;
  const nodes = workflow.nodes.map(({ position: _position, notes: _notes, notesInFlow: _notesInFlow, ...node }) => node).sort((one, two) => one.name.localeCompare(two.name, 'en'));
  return createHash('sha256').update(JSON.stringify(canonical({ id: workflow.id, name: workflow.name, nodes, connections: workflow.connections, settings, pinData: workflow.pinData || {}, staticData: workflow.staticData || null }))).digest('hex');
}

export function assertMatchingRoleTool(definition, actual) {
  const known = ROLE_AGENT_WORKFLOWS.find((value) => value.id === definition?.id && value.role === definition?.role);
  if (!known || !actual || !Array.isArray(actual.nodes) || roleToolFingerprint(buildRoleAgentWorkflow(known)) !== roleToolFingerprint(actual)) {
    throw new Error('Refusing to run a role tool whose executable graph differs from its read-only builder. No workflow executed.');
  }
}

function inspectInstalledTool(definition) {
  const temporaryPath = `/tmp/stockflow-role-inspect-${randomUUID()}.json`;
  try {
    dockerCapture(['exec', 'n8n', 'n8n', 'export:workflow', `--id=${definition.id}`, `--output=${temporaryPath}`]);
    const values = JSON.parse(dockerCapture(['exec', 'n8n', 'node', '-e', `process.stdout.write(require('fs').readFileSync('${temporaryPath}','utf8'))`]));
    if (!Array.isArray(values) || values.length !== 1) throw new Error('Invalid workflow export.');
    assertMatchingRoleTool(definition, values[0]);
    return values[0];
  } catch {
    throw new Error('Role-tool verification preflight failed. Workflow exports and credential references were withheld; no workflow executed.');
  } finally { dockerCapture(['exec', 'n8n', 'node', '-e', `require('fs').rmSync('${temporaryPath}',{force:true})`]); }
}

/** Output is counts and enums only. Source records, contacts, JWTs and prompts never leave the process. */
export function summarizeRoleToolContext(context, expectedRole) {
  if (!context || context.schemaVersion !== 1 || context.access !== 'read-only' || context.role !== expectedRole || context.account?.role !== expectedRole || !Number.isSafeInteger(context.account.id) || context.account.id <= 0) throw new Error('The final role-tool context did not verify its read-only account scope.');
  if (expectedRole === 'SUPPLIER' && (!Number.isSafeInteger(context.scope?.supplierId) || context.scope.supplierId !== context.account.supplierId)) throw new Error('The supplier tool did not verify its ownership scope.');
  if (expectedRole === 'CUSTOMER' && context.scope?.customerId !== context.account.id) throw new Error('The customer tool did not verify its ownership scope.');
  const count = (value) => {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('The final role-tool context contained invalid counts.');
    return value;
  };
  return {
    role: expectedRole,
    readOnly: true,
    accountScopeVerified: true,
    catalogProducts: count(context.catalog?.totalCount),
    catalogMatches: count(context.catalog?.matchedCount),
    returnedProducts: count(context.catalog?.returnedCount),
    inventoryProducts: count(context.inventory?.productCount),
    lowStockProducts: count(context.inventory?.lowStockCount),
    criticalStockProducts: count(context.inventory?.criticalStockCount),
    outOfStockProducts: count(context.inventory?.outOfStockCount),
    orders: count(context.orders?.totalCount),
    returnedOrders: count(context.orders?.returnedCount),
    categories: count(context.categories?.totalCount),
    ...(expectedRole === 'ADMIN' ? { suppliers: count(context.suppliers?.totalCount) } : {}),
  };
}

export function summarizeRoleToolRun(definition, run, exitStatus) {
  const data = run?.data?.resultData || run?.resultData || run?.data || run;
  const runs = data?.runData;
  if (exitStatus !== 0 || data?.error || !runs || typeof runs !== 'object' || data.lastNodeExecuted !== 'Project safe role context') throw new Error('The read-only tool did not complete at its final projection. Raw execution output was withheld.');
  const expected = buildRoleAgentWorkflow(definition);
  const allowedNames = new Set(expected.nodes.map((node) => node.name));
  if (Object.keys(runs).some((name) => !allowedNames.has(name))) throw new Error('Unexpected node execution detected. Raw execution output was withheld.');
  for (const name of ['Account login', 'Verify account', 'Assert account role', 'Read catalog', 'Read categories', 'Read scoped orders', 'Project safe role context']) {
    if (!Array.isArray(runs[name]) || runs[name].length !== 1 || runs[name][0]?.error) throw new Error('The read-only tool did not complete its required checks. Raw execution output was withheld.');
  }
  const items = runs['Project safe role context'][0]?.data?.main?.flat() || [];
  if (items.length !== 1) throw new Error('The role tool returned an unexpected projection count.');
  return { workflowId: definition.id, success: true, ...summarizeRoleToolContext(items[0].json, definition.role), executedNodeCount: Object.keys(runs).length, openAiCalls: 0, businessMutations: 0 };
}

function executeReadOnlyTool(definition) {
  const result = spawnSync('docker', ['exec', '-e', 'N8N_RUNNERS_BROKER_PORT=5682', 'n8n', 'n8n', 'execute', `--id=${definition.id}`, '--rawOutput'], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, timeout: 120000, windowsHide: true });
  // CLI output contains intermediate HTTP data, including the login JWT. Keep it in memory.
  const run = parseCliJson(result.stdout || '', (value) => Boolean(value && !Array.isArray(value) && (value.data?.resultData?.runData || value.resultData?.runData || value.data?.runData || value.runData)));
  return summarizeRoleToolRun(definition, run, result.status);
}

export function verifyRoleAgentTools({ inspect = inspectInstalledTool, execute = executeReadOnlyTool, persist = true, log = (report) => console.log(JSON.stringify(report)), verifyLocal = assertLocalN8n } = {}) {
  verifyLocal();
  // All three must pass before any HTTP read occurs; repeat the gate immediately before each execution.
  for (const definition of ROLE_AGENT_WORKFLOWS) assertMatchingRoleTool(definition, inspect(definition));
  const reports = [];
  for (const definition of ROLE_AGENT_WORKFLOWS) {
    assertMatchingRoleTool(definition, inspect(definition));
    try {
      const report = execute(definition);
      reports.push(report);
      log(report);
    } catch {
      const report = { workflowId: definition.id, role: definition.role, success: false, error: 'Read-only tool verification failed. Raw credential-bearing execution output was withheld.', openAiCalls: 0 };
      reports.push(report);
      log(report);
      break;
    }
  }
  if (persist) {
    mkdirSync(localDirectory, { recursive: true });
    writeFileSync(path.join(localDirectory, 'role-agent-tool-verification.json'), JSON.stringify({ checkedAt: new Date().toISOString(), success: reports.length === ROLE_AGENT_WORKFLOWS.length && reports.every((report) => report.success), reports }, null, 2), { mode: 0o600 });
  }
  return reports;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const reports = verifyRoleAgentTools();
    if (reports.length !== ROLE_AGENT_WORKFLOWS.length || reports.some((report) => !report.success)) process.exitCode = 1;
  } catch { console.error('Role-tool verification stopped before execution. Sensitive output was withheld.'); process.exitCode = 1; }
}
