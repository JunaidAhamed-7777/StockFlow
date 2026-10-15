import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { planNotifications, recordSuccessfulDelivery, clearRecoveredStock } from './notification-rules.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const output = path.join(here, 'workflows');
mkdirSync(output, { recursive: true });
const modes = [
  { mode: 'low-stock', id: 'StockFlowCritical01', title: 'StockFlow · Critical stock owner alerts', interval: [{ field: 'minutes', minutesInterval: 15 }] },
  { mode: 'daily-digest', id: 'StockFlowDigest01', title: 'StockFlow · Daily inventory owner digest', interval: [{ field: 'cronExpression', expression: '0 0 9 * * *' }] },
  { mode: 'stale-orders', id: 'StockFlowOrders01', title: 'StockFlow · Open order follow-up', interval: [{ field: 'cronExpression', expression: '0 0 10 * * *' }] },
];
const node = (name, type, position, parameters, extras = {}) => ({ id: name.toLowerCase().replaceAll(' ', '-'), name, type: `n8n-nodes-base.${type}`, typeVersion: type === 'httpRequest' ? 4.2 : type === 'gmail' ? 2.2 : type === 'scheduleTrigger' ? 1.2 : type === 'if' ? 2.2 : 2, position, parameters, ...extras });
for (const mode of modes) {
  const nodes = [
    node('Schedule', 'scheduleTrigger', [0, 0], { rule: { interval: mode.interval } }),
    node('Manual check', 'manualTrigger', [0, 200], {}, { typeVersion: 1 }),
    node('Settings', 'code', [240, 100], { jsCode: `return [{json: {apiBaseUrl: 'http://host.docker.internal:3001/api', mode: '${mode.mode}', mailEnabled: false, criticalRatio: 0.5, reminderHours: 24}}];` }),
    node('StockFlow login', 'httpRequest', [460, 100], { method: 'POST', url: "={{ $('Settings').first().json.apiBaseUrl + '/auth/login' }}", authentication: 'genericCredentialType', genericAuthType: 'httpCustomAuth', sendBody: true, contentType: 'json', specifyBody: 'json', jsonBody: '{}', options: { timeout: 15000 } }, { credentials: { httpCustomAuth: { id: 'StockFlowApiLogin01', name: 'StockFlow API login (local demo)' } }, retryOnFail: true, maxTries: 3, waitBetweenTries: 1500 }),
    node('Read inventory', 'httpRequest', [680, 100], { url: "={{ $('Settings').first().json.apiBaseUrl + '/products' }}", sendHeaders: true, headerParameters: { parameters: [{ name: 'Authorization', value: "={{ 'Bearer ' + $('StockFlow login').first().json.data.token }}" }] }, options: { timeout: 15000 } }, { retryOnFail: true, maxTries: 3, waitBetweenTries: 1500 }),
    node('Read owners', 'httpRequest', [900, 100], { url: "={{ $('Settings').first().json.apiBaseUrl + '/discovery/suppliers' }}", options: { timeout: 15000 } }, { retryOnFail: true, maxTries: 3, waitBetweenTries: 1500 }),
  ];
  if (mode.mode === 'stale-orders') nodes.push(node('Read orders', 'httpRequest', [1120, 100], { url: "={{ $('Settings').first().json.apiBaseUrl + '/orders' }}", sendHeaders: true, headerParameters: { parameters: [{ name: 'Authorization', value: "={{ 'Bearer ' + $('StockFlow login').first().json.data.token }}" }] }, options: { timeout: 15000 } }, { retryOnFail: true, maxTries: 3, waitBetweenTries: 1500 }));
  const code = [
    planNotifications.toString(), clearRecoveredStock.toString(),
    "const settings = $('Settings').first().json;",
    "const unwrap = (value) => Array.isArray(value) ? value : value?.data;",
    "const products = unwrap($('Read inventory').first().json);",
    "const suppliers = unwrap($('Read owners').first().json);",
    mode.mode === 'stale-orders' ? "const orders = unwrap($('Read orders').first().json);" : 'const orders = [];',
    "const state = $getWorkflowStaticData('global');",
    '// Validate all source data before changing remembered state.',
    'planNotifications({...settings, products, suppliers, orders, state});',
    'clearRecoveredStock(state, products, settings.criticalRatio);',
    'const report = planNotifications({...settings, products, suppliers, orders, state});',
    "if (!report.notifications.length) return [{json: {kind: 'summary', ...report, note: 'No eligible recipients or no notifications due. Reserved demo addresses never receive email.'}}];",
    'return report.notifications.map((json) => ({json}));',
  ].join('\n');
  nodes.push(
    node('Plan notifications', 'code', [1360, 100], { jsCode: code }),
    node('Delivery enabled', 'if', [1580, 100], { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 }, conditions: [{ id: 'delivery-guard', leftValue: "={{ $json.kind === 'notification' && $json.deliveryEnabled === true }}", rightValue: true, operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and' }, options: {} }),
    node('Send owner Gmail', 'gmail', [1820, 0], { authentication: 'oAuth2', resource: 'message', operation: 'send', sendTo: '={{ $json.to }}', subject: '={{ $json.subject }}', emailType: 'text', message: '={{ $json.message }}', options: { appendAttribution: false } }),
    node('Remember successful delivery', 'code', [2060, 0], { mode: 'runOnceForEachItem', jsCode: `${recordSuccessfulDelivery.toString()}\nconst notification = $('Delivery enabled').item.json;\nconst state = $getWorkflowStaticData('global');\nrecordSuccessfulDelivery(state, notification);\nreturn {json: {delivered: true, supplierId: notification.supplierId, eventCount: notification.events.length}};` }),
    node('Preview only', 'code', [1820, 240], { jsCode: "return $input.all().map(item => ({json: {mode: item.json.mode, deliveryEnabled: false, supplierId: item.json.supplierId || null, checkedProducts: item.json.checkedProducts, skipped: item.json.skipped || [], eventCount: item.json.events?.length || 0, note: 'Preview mode. Connect Gmail OAuth and enable mailEnabled in Settings to deliver. No email sent.'}}));" }),
    node('Setup and behavior', 'stickyNote', [240, -420], { content: `## ${mode.title}\n\nLocal, rule-based and $0 in OpenAI usage.\n\n**Preview mode is enabled. No email is sent.**\n\n1. Connect a Gmail OAuth2 credential on Send owner Gmail.\n2. Check real supplier email addresses and review a manual preview.\n3. Change mailEnabled to true in Settings and publish.\n\nLow stock = zero units or at most 50% of the product's own reorder threshold. Messages are grouped per owner; successful deliveries have a 24-hour cooldown. Out-of-stock escalation sends immediately. Daily digest runs at 09:00 and open-order follow-up at 10:00 Asia/Kolkata. Reserved demo emails are skipped.\n\nAPI login is stored only in an encrypted n8n credential. No OpenAI key is needed. Source: automations/README.md.`, height: 350, width: 780 }, { typeVersion: 1 }),
  );
  const connections = {};
  const connect = (from, to, branch = 0) => {
    connections[from] ||= { main: [] };
    connections[from].main[branch] = [{ node: to, type: 'main', index: 0 }];
  };
  connect('Schedule', 'Settings'); connect('Manual check', 'Settings'); connect('Settings', 'StockFlow login'); connect('StockFlow login', 'Read inventory'); connect('Read inventory', 'Read owners');
  if (mode.mode === 'stale-orders') { connect('Read owners', 'Read orders'); connect('Read orders', 'Plan notifications'); }
  else connect('Read owners', 'Plan notifications');
  connect('Plan notifications', 'Delivery enabled'); connect('Delivery enabled', 'Send owner Gmail'); connect('Delivery enabled', 'Preview only', 1); connect('Send owner Gmail', 'Remember successful delivery');
  const workflow = { id: mode.id, name: mode.title, active: false, nodes, connections, settings: { executionOrder: 'v1', timezone: 'Asia/Kolkata', saveDataSuccessExecution: 'none', saveDataErrorExecution: 'none', saveManualExecutions: false, saveExecutionProgress: false }, staticData: null, pinData: {} };
  writeFileSync(path.join(output, `stockflow-${mode.mode}.json`), JSON.stringify(workflow, null, 2) + '\n');
  console.log(`Built ${mode.title}`);
}
