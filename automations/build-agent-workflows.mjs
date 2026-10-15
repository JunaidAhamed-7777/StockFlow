import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { projectRoleAgentContext } from './agent-tools.mjs';

export const ROLE_AGENT_WORKFLOWS = Object.freeze([
  { role: 'ADMIN', id: 'StockFlowAdminTool01', name: 'StockFlow admin context', credentialId: 'StockFlowApiLogin01', credentialName: 'StockFlow API login (local demo)', toolName: 'admin_context' },
  { role: 'SUPPLIER', id: 'StockFlowSupplierTool01', name: 'StockFlow supplier context', credentialId: 'StockFlowSupplierLogin01', credentialName: 'StockFlow supplier agent login', toolName: 'supplier_context' },
  { role: 'CUSTOMER', id: 'StockFlowCustomerTool01', name: 'StockFlow customer context', credentialId: 'StockFlowCustomerLogin01', credentialName: 'StockFlow customer agent login', toolName: 'customer_context' },
]);

export function buildRoleAgentWorkflow(definition) {
  const { role, id, name, credentialId, credentialName } = definition;
  if (!ROLE_AGENT_WORKFLOWS.some(value => value.id === id && value.role === role)) throw new Error('Unknown role tool definition.');
  const node = (name, type, x, parameters, extra = {}) => ({ id: name.toLowerCase().replaceAll(' ', '-'), name, type: `n8n-nodes-base.${type}`, typeVersion: type === 'httpRequest' ? 4.2 : type === 'executeWorkflowTrigger' ? 1.1 : type === 'manualTrigger' ? 1 : 2, position: [x, 120], parameters, ...extra });
  const authenticatedGet = (name, endpoint, x) => node(name, 'httpRequest', x, { url: `={{ $('Scope').first().json.apiBaseUrl + '${endpoint}' }}`, sendHeaders: true, headerParameters: { parameters: [{ name: 'Authorization', value: "={{ 'Bearer ' + $('Account login').first().json.data.token }}" }] }, options: { timeout: 15000 } }, { retryOnFail: true, maxTries: 2, waitBetweenTries: 1000 });
  const directory = role !== 'CUSTOMER';
  const nodes = [
    node('Agent tool input', 'executeWorkflowTrigger', 0, { inputSource: 'workflowInputs', workflowInputs: { values: [{ name: 'search', type: 'string' }] } }),
    { ...node('Manual verification', 'manualTrigger', 0, {}), position: [0, 300] },
    node('Scope', 'code', 220, { jsCode: `const search = $input.first().json.search ?? '';\nif (typeof search !== 'string' || search.length > 120) throw new Error('Search must be a string of at most 120 characters.');\nreturn [{json: {role: '${role}', search, apiBaseUrl: 'http://host.docker.internal:3001/api'}}];` }),
    node('Account login', 'httpRequest', 440, { method: 'POST', url: "={{ $('Scope').first().json.apiBaseUrl + '/auth/login' }}", authentication: 'genericCredentialType', genericAuthType: 'httpCustomAuth', sendBody: true, contentType: 'json', specifyBody: 'json', jsonBody: '{}', options: { timeout: 15000 } }, { credentials: { httpCustomAuth: { id: credentialId, name: credentialName } } }),
    authenticatedGet('Verify account', '/auth/me', 660),
    node('Assert account role', 'code', 880, { jsCode: `const identity = $input.first().json.data;\nif (identity?.role !== '${role}' || !Number.isSafeInteger(identity.id) || identity.id <= 0) throw new Error('The configured account does not match this agent role. No private records were read.');\nreturn [{json: {identity: {id: identity.id, name: identity.name, email: identity.email, role: identity.role}}}];` }),
    authenticatedGet('Read catalog', '/products', 1100),
    ...(directory ? [authenticatedGet('Resolve suppliers', '/discovery/suppliers', 1320)] : []),
    authenticatedGet('Read categories', '/discovery/categories', 1540),
    authenticatedGet('Read scoped orders', '/orders', 1760),
    node('Project safe role context', 'code', 1980, { jsCode: `${projectRoleAgentContext.toString()}\nconst unwrap = value => Array.isArray(value) ? value : value?.data;\nreturn [{json: projectRoleAgentContext({role: '${role}', identity: $('Assert account role').first().json.identity, search: $('Scope').first().json.search, products: unwrap($('Read catalog').first().json), suppliers: ${directory ? "unwrap($('Resolve suppliers').first().json)" : '[]'}, categories: unwrap($('Read categories').first().json), orders: unwrap($('Read scoped orders').first().json)})}];` }),
  ];
  const connections = {};
  const connect = (from, to) => { connections[from] = { main: [[{ node: to, type: 'main', index: 0 }]] }; };
  connect('Agent tool input', 'Scope'); connect('Manual verification', 'Scope'); connect('Scope', 'Account login'); connect('Account login', 'Verify account'); connect('Verify account', 'Assert account role'); connect('Assert account role', 'Read catalog');
  if (directory) { connect('Read catalog', 'Resolve suppliers'); connect('Resolve suppliers', 'Read categories'); } else connect('Read catalog', 'Read categories');
  connect('Read categories', 'Read scoped orders'); connect('Read scoped orders', 'Project safe role context');
  return { id, name, active: false, nodes, connections, settings: { executionOrder: 'v1', timezone: 'Asia/Kolkata', callerPolicy: 'workflowsFromSameOwner', saveDataSuccessExecution: 'none', saveDataErrorExecution: 'none', saveManualExecutions: false, saveExecutionProgress: false, executionTimeout: 90 }, staticData: null, pinData: {} };
}

export function writeAgentWorkflows() {
  const output = path.join(path.dirname(fileURLToPath(import.meta.url)), 'agent-workflows');
  mkdirSync(output, { recursive: true });
  for (const definition of ROLE_AGENT_WORKFLOWS) writeFileSync(path.join(output, `stockflow-${definition.role.toLowerCase()}-tool.json`), JSON.stringify(buildRoleAgentWorkflow(definition), null, 2) + '\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) writeAgentWorkflows();
