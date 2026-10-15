import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { resolveDeliverySettings, createOwnerNotification, planNotifications, recordSuccessfulDelivery, clearRecoveredStock } from './notification-rules.mjs';
import { planMaintenanceNotifications, rememberInitialOrderBaseline } from './maintenance-rules.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const output = path.join(here, 'workflows');
mkdirSync(output, { recursive: true });
const modes = [
  { mode: 'low-stock', id: 'StockFlowCritical01', title: 'StockFlow · Critical stock owner alerts', interval: [{ field: 'minutes', minutesInterval: 15 }] },
  { mode: 'daily-digest', id: 'StockFlowDigest01', title: 'StockFlow · Daily inventory owner digest', interval: [{ field: 'cronExpression', expression: '0 0 9 * * *' }] },
  { mode: 'stale-orders', id: 'StockFlowOrders01', title: 'StockFlow · Open order follow-up', interval: [{ field: 'cronExpression', expression: '0 0 10 * * *' }] },
  { mode: 'inventory-audit', id: 'StockFlowAudit01', title: 'StockFlow · Weekly inventory data audit', interval: [{ field: 'cronExpression', expression: '0 30 9 * * 1' }] },
  { mode: 'order-updates', id: 'StockFlowUpdates01', title: 'StockFlow · New and changed order alerts', interval: [{ field: 'minutes', minutesInterval: 15 }] },
];
const redirectTo = 'junuhammad2@gmail.com';
const node = (name, type, position, parameters, extras = {}) => ({ id: name.toLowerCase().replaceAll(' ', '-'), name, type: `n8n-nodes-base.${type}`, typeVersion: type === 'httpRequest' ? 4.2 : type === 'gmail' ? 2.2 : type === 'scheduleTrigger' ? 1.2 : type === 'if' ? 2.2 : 2, position, parameters, ...extras });
for (const mode of modes) {
  const readsOrders = ['stale-orders', 'order-updates'].includes(mode.mode);
  const isMaintenance = ['inventory-audit', 'order-updates'].includes(mode.mode);
  const nodes = [
    node('Schedule', 'scheduleTrigger', [0, 0], { rule: { interval: mode.interval } }),
    node('Manual check', 'manualTrigger', [0, 200], {}, { typeVersion: 1 }),
    node('Settings', 'code', [240, 100], { jsCode: `return [{json: {apiBaseUrl: 'http://host.docker.internal:3001/api', mode: '${mode.mode}', deliveryMode: 'redirect', redirectTo: '${redirectTo}', mailEnabled: false, criticalRatio: 0.5, reminderHours: 24, auditRecipientEmail: 'admin.test@stockflow.local'}}];` }),
    node('StockFlow login', 'httpRequest', [460, 100], { method: 'POST', url: "={{ $('Settings').first().json.apiBaseUrl + '/auth/login' }}", authentication: 'genericCredentialType', genericAuthType: 'httpCustomAuth', sendBody: true, contentType: 'json', specifyBody: 'json', jsonBody: '{}', options: { timeout: 15000 } }, { credentials: { httpCustomAuth: { id: 'StockFlowApiLogin01', name: 'StockFlow API login (local demo)' } }, retryOnFail: true, maxTries: 3, waitBetweenTries: 1500 }),
    node('Read inventory', 'httpRequest', [680, 100], { url: "={{ $('Settings').first().json.apiBaseUrl + '/products' }}", sendHeaders: true, headerParameters: { parameters: [{ name: 'Authorization', value: "={{ 'Bearer ' + $('StockFlow login').first().json.data.token }}" }] }, options: { timeout: 15000 } }, { retryOnFail: true, maxTries: 3, waitBetweenTries: 1500 }),
    node('Read owners', 'httpRequest', [900, 100], { url: "={{ $('Settings').first().json.apiBaseUrl + '/discovery/suppliers' }}", options: { timeout: 15000 } }, { retryOnFail: true, maxTries: 3, waitBetweenTries: 1500 }),
  ];
  if (readsOrders) nodes.push(node('Read orders', 'httpRequest', [1120, 100], { url: "={{ $('Settings').first().json.apiBaseUrl + '/orders' }}", sendHeaders: true, headerParameters: { parameters: [{ name: 'Authorization', value: "={{ 'Bearer ' + $('StockFlow login').first().json.data.token }}" }] }, options: { timeout: 15000 } }, { retryOnFail: true, maxTries: 3, waitBetweenTries: 1500 }));
  if (mode.mode === 'inventory-audit') nodes.push(node('Read categories', 'httpRequest', [1120, 100], { url: "={{ $('Settings').first().json.apiBaseUrl + '/discovery/categories' }}", options: { timeout: 15000 } }, { retryOnFail: true, maxTries: 3, waitBetweenTries: 1500 }));
  const code = [
    resolveDeliverySettings.toString(), createOwnerNotification.toString(),
    planNotifications.toString(), clearRecoveredStock.toString(),
    planMaintenanceNotifications.toString(), rememberInitialOrderBaseline.toString(),
    "const settings = $('Settings').first().json;",
    "const unwrap = (value) => Array.isArray(value) ? value : value?.data;",
    "const products = unwrap($('Read inventory').first().json);",
    "const suppliers = unwrap($('Read owners').first().json);",
    readsOrders ? "const orders = unwrap($('Read orders').first().json);" : 'const orders = [];',
    mode.mode === 'inventory-audit' ? "const categories = unwrap($('Read categories').first().json);" : 'const categories = [];',
    "const state = $getWorkflowStaticData('global');",
    ...(isMaintenance ? [
      'const report = planMaintenanceNotifications({...settings, products, suppliers, orders, categories, state});',
      'rememberInitialOrderBaseline(state, report);',
    ] : [
      '// Validate all source data before changing remembered state.',
      'planNotifications({...settings, products, suppliers, orders, state});',
      'clearRecoveredStock(state, products, settings.criticalRatio);',
      'const report = planNotifications({...settings, products, suppliers, orders, state});',
    ]),
    "if (!report.notifications.length) return [{json: {kind: 'summary', ...report, note: report.note || 'No eligible recipients or no notifications due. All delivery is redirected; stock owners are not emailed.'}}];",
    'return report.notifications.map((json) => ({json}));',
  ].join('\n');
  nodes.push(
    node('Plan notifications', 'code', [1360, 100], { jsCode: code }),
    node('Delivery enabled', 'if', [1580, 100], { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 }, conditions: [{ id: 'delivery-guard', leftValue: `={{ $json.kind === 'notification' && $json.deliveryEnabled === true && $json.deliveryMode === 'redirect' && $json.to === '${redirectTo}' && typeof $json.intendedRecipient?.email === 'string' && $json.intendedRecipient.email.length > 0 && typeof $json.intendedRecipient.name === 'string' && Number.isSafeInteger($json.intendedRecipient.supplierId) }}`, rightValue: true, operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and' }, options: {} }),
    node('Send owner Gmail', 'gmail', [1820, 0], { authentication: 'oAuth2', resource: 'message', operation: 'send', sendTo: redirectTo, subject: '={{ $json.subject }}', emailType: 'text', message: '={{ $json.message }}', options: { appendAttribution: false } }, { onError: 'continueRegularOutput' }),
    node('Remember successful delivery', 'code', [2060, 0], { mode: 'runOnceForEachItem', jsCode: `${recordSuccessfulDelivery.toString()}\nconst notification = $('Delivery enabled').item.json;\nif ($json.error || !$json.id) return {json: {delivered: false, supplierId: notification.supplierId, note: 'Gmail did not confirm delivery. This owner will be retried on the next scheduled check.'}};\nconst state = $getWorkflowStaticData('global');\nrecordSuccessfulDelivery(state, notification);\nreturn {json: {delivered: true, supplierId: notification.supplierId, eventCount: notification.events.length}};` }),
    node('Preview only', 'code', [1820, 240], { jsCode: "return $input.all().map(item => ({json: {mode: item.json.mode, deliveryEnabled: false, deliveryMode: item.json.deliveryMode, to: item.json.to || null, intendedRecipient: item.json.intendedRecipient || null, supplierId: item.json.supplierId ?? null, checkedProducts: item.json.checkedProducts, checkedOrders: item.json.checkedOrders, skipped: item.json.skipped || [], eventCount: item.json.events?.length || 0, note: item.json.note || 'Preview mode. Connect send-only Gmail OAuth and enable mailEnabled in Settings to deliver redirected mail. No email sent.'}}));" }),
    node('Setup and behavior', 'stickyNote', [240, -500], { content: `## ${mode.title}\n\nLocal, rule-based and $0 in OpenAI usage.\n\n**Tracked templates default to mailEnabled: false. No email is sent until locally enabled.**\n\nAll five Gmail nodes are hard-routed to ${redirectTo}. Delivery also requires deliveryMode: 'redirect', a matching destination, and intended-recipient metadata. Each message labels its intended stock owner or administrator. No CC/BCC. Owners are never emailed by these templates.\n\n1. Connect Gmail OAuth2 with Custom Scopes enabled and only https://www.googleapis.com/auth/gmail.send. Leave Sender Name unset.\n2. Review a manual preview and the intended-recipient information.\n3. Enable mailEnabled locally and publish the selected workflow.\n\nCritical stock and new/changed orders: every 15 minutes. Daily digest: 09:00. Open-order follow-up: 10:00. Inventory data audit: Mondays at 09:30. All times Asia/Kolkata.\n\nCritical alerts and follow-ups have a 24-hour successful-delivery cooldown; zero-stock escalation sends immediately. Order updates establish an initial baseline without emailing historical orders, then remember changes only after Gmail confirms delivery. Audit reports flag data for review and never modify it.\n\nAPI login stays in an encrypted n8n credential. No OpenAI key is needed. Source: automations/README.md.`, height: 440, width: 900 }, { typeVersion: 1 }),
  );
  const connections = {};
  const connect = (from, to, branch = 0) => {
    connections[from] ||= { main: [] };
    connections[from].main[branch] = [{ node: to, type: 'main', index: 0 }];
  };
  connect('Schedule', 'Settings'); connect('Manual check', 'Settings'); connect('Settings', 'StockFlow login'); connect('StockFlow login', 'Read inventory'); connect('Read inventory', 'Read owners');
  if (readsOrders) { connect('Read owners', 'Read orders'); connect('Read orders', 'Plan notifications'); }
  else if (mode.mode === 'inventory-audit') { connect('Read owners', 'Read categories'); connect('Read categories', 'Plan notifications'); }
  else connect('Read owners', 'Plan notifications');
  connect('Plan notifications', 'Delivery enabled'); connect('Delivery enabled', 'Send owner Gmail'); connect('Delivery enabled', 'Preview only', 1); connect('Send owner Gmail', 'Remember successful delivery');
  const workflow = { id: mode.id, name: mode.title, active: false, nodes, connections, settings: { executionOrder: 'v1', timezone: 'Asia/Kolkata', saveDataSuccessExecution: 'none', saveDataErrorExecution: 'none', saveManualExecutions: false, saveExecutionProgress: false }, staticData: null, pinData: {} };
  writeFileSync(path.join(output, `stockflow-${mode.mode}.json`), JSON.stringify(workflow, null, 2) + '\n');
  console.log(`Built ${mode.title}`);
}
