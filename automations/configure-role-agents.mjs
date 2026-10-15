import { randomUUID, createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { assertLocalN8n, dockerCapture, exportLocalCredential, exportLocalWorkflows, importLocalObject, localDirectory, projectRoot } from './local-n8n.mjs';
import { createN8nAgentApi } from './n8n-agent-api.mjs';
import { ROLE_AGENT_WORKFLOWS, buildRoleAgentWorkflow, writeAgentWorkflows } from './build-agent-workflows.mjs';
import { ROLE_AGENT_PLANS, ROLE_AGENT_MODEL, ROLE_AGENT_CREDENTIAL, createRoleAgentConfig } from './role-agent-definitions.mjs';

export function readBoundAccount(markdown, name, role) {
  if (typeof markdown !== 'string' || typeof name !== 'string' || /[\r\n]/.test(name) || !['ADMIN', 'SUPPLIER', 'CUSTOMER'].includes(role)) throw new Error('Invalid private account selection.');
  const heading = `### ${name} (${role})`;
  const lines = markdown.split(/\r?\n/);
  const matches = lines.flatMap((line, index) => line === heading ? [index] : []);
  if (matches.length !== 1) throw new Error('Required private StockFlow account documentation is unavailable.');
  const following = lines.slice(matches[0] + 1);
  const end = following.findIndex(line => /^#{1,3} /.test(line));
  const section = following.slice(0, end < 0 ? undefined : end).join('\n');
  const emails = [...section.matchAll(/^- Email: `([^`\r\n]+)`$/gm)];
  const passwords = [...section.matchAll(/^- Password: `([^`\r\n]+)`$/gm)];
  const email = emails[0]?.[1];
  const password = passwords[0]?.[1];
  if (emails.length !== 1 || passwords.length !== 1 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || '') || email.length > 254 || !password?.trim() || password.length > 256) throw new Error('Required private StockFlow account documentation is incomplete.');
  return { email, password };
}

export async function configureRoleAgents(args = process.argv.slice(2)) {
  const apply = args.includes('--apply');
  const previousPath = path.join(localDirectory, 'role-agents.json');
  const previous = existsSync(previousPath) ? JSON.parse(readFileSync(previousPath, 'utf8')) : {};
  const projectId = args.find(value => value.startsWith('--project-id='))?.slice(13) || previous.projectId;
  const adminAgentId = args.find(value => value.startsWith('--admin-agent-id='))?.slice(17) || previous.agents?.find(value => value.role === 'ADMIN')?.id;
  if (args.some(value => value !== '--apply' && !value.startsWith('--project-id=') && !value.startsWith('--admin-agent-id='))) throw new Error('Usage: configure-role-agents.mjs [--apply] [--project-id=ID] [--admin-agent-id=ID]');
  if (!apply) {
    console.log(JSON.stringify({ dryRun: true, model: ROLE_AGENT_MODEL, roles: ROLE_AGENT_PLANS.map(plan => ({ role: plan.role, name: plan.name, boundAccount: plan.boundAccount, schedule: plan.cronExpression, timezone: 'Asia/Kolkata' })), scope: 'read-only API review, comparison, triage and drafts', monthlyBudgetTotalUsd: 9, sessionCostCapUsd: 0.1, rootApiKeyWillRemainPrivate: true }, null, 2));
    return;
  }
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(projectId || '') || !/^[A-Za-z0-9_-]{1,64}$/.test(adminAgentId || '')) throw new Error('Select the existing local project and admin agent IDs before applying.');
  assertLocalN8n();
  const api = await createN8nAgentApi({ projectId });
  const existingAdmin = await api.request('GET', `/${adminAgentId}`);
  if (existingAdmin.name !== 'Admin Notification') throw new Error('The selected existing agent is not Admin Notification. No configuration changed.');
  const backupDirectory = path.join(localDirectory, 'n8n-agent-backups', randomUUID());
  mkdirSync(backupDirectory, { recursive: true });
  writeFileSync(path.join(backupDirectory, 'admin-before.json'), JSON.stringify(await api.request('GET', `/${adminAgentId}/config`), null, 2), { mode: 0o600 });
  writeFileSync(path.join(backupDirectory, 'workflows-before.json'), JSON.stringify(exportLocalWorkflows(), null, 2), { mode: 0o600 });

  const environment = dotenv.parse(readFileSync(path.join(projectRoot, '.env'), 'utf8'));
  const apiKey = environment.OPENAI_API_KEY;
  if (typeof apiKey !== 'string' || !apiKey.startsWith('sk-') || apiKey.length < 20) throw new Error('A valid OPENAI_API_KEY is required in the root .env. Its value was withheld.');
  importLocalObject('credentials', [{ id: ROLE_AGENT_CREDENTIAL, name: 'StockFlow OpenAI GPT-5 mini', type: 'openAiApi', data: { apiKey, url: 'https://api.openai.com/v1' } }]);
  const stored = exportLocalCredential(ROLE_AGENT_CREDENTIAL);
  const fingerprint = value => createHash('sha256').update(String(value)).digest('hex');
  if (stored?.type !== 'openAiApi' || fingerprint(stored.data?.apiKey) !== fingerprint(apiKey) || stored.data?.url !== 'https://api.openai.com/v1') throw new Error('Encrypted OpenAI credential verification failed. Secrets were withheld.');

  const loginDoc = readFileSync(path.join(localDirectory, 'LOGIN-ACCOUNTS.md'), 'utf8');
  const loginCredentials = ROLE_AGENT_WORKFLOWS.filter(value => value.role !== 'ADMIN').map(definition => ({ id: definition.credentialId, name: definition.credentialName, type: 'httpCustomAuth', data: { json: JSON.stringify({ body: readBoundAccount(loginDoc, definition.role === 'SUPPLIER' ? 'Supplier Test' : 'Customer Test', definition.role) }) } }));
  importLocalObject('credentials', loginCredentials);
  writeAgentWorkflows();
  for (const definition of ROLE_AGENT_WORKFLOWS) {
    importLocalObject('workflow', buildRoleAgentWorkflow(definition));
    dockerCapture(['exec', 'n8n', 'n8n', 'publish:workflow', `--id=${definition.id}`]);
  }
  dockerCapture(['restart', 'n8n']);
  let healthy = false;
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      // The health endpoint can respond before the optional Agents module registers its routes.
      const ready = await api.request('GET', `/${adminAgentId}`);
      healthy = ready.id === adminAgentId;
    } catch (error) {
      if (error.status !== 404 && error.status !== 503 && error.message !== 'Local n8n request could not be completed.') throw error;
    }
    if (healthy) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (!healthy) throw new Error('Local n8n did not become healthy after role-tool installation.');

  const agents = [];
  for (const plan of ROLE_AGENT_PLANS) {
    const id = plan.role === 'ADMIN' ? adminAgentId : plan.id;
    let agent;
    try { agent = await api.request('GET', `/${id}`); } catch (error) { if (error.status !== 404 || plan.role === 'ADMIN') throw error; }
    const config = createRoleAgentConfig(plan, agent?.name || plan.name);
    if (!agent) await api.request('POST', '', { id, name: plan.name, schema: config });
    else {
      if (plan.role !== 'ADMIN' && agent.name !== plan.name) throw new Error('A role agent ID is occupied by another agent. It was not overwritten.');
      const current = await api.request('GET', `/${id}/config`);
      config.tasks = current.config.tasks || [];
      await api.request('PUT', `/${id}/config`, { config, baseConfigHash: current.configHash });
    }
    const taskResponse = await api.request('GET', `/${id}/tasks`);
    const tasks = Array.isArray(taskResponse) ? taskResponse : taskResponse.data || taskResponse.tasks || [];
    const task = tasks.find(value => value.name === plan.taskName);
    const taskData = { name: plan.taskName, objective: plan.objective, cronExpression: plan.cronExpression, timezone: 'Asia/Kolkata' };
    if (task) await api.request('PATCH', `/${id}/tasks/${task.id}`, taskData);
    else await api.request('POST', `/${id}/tasks`, { ...taskData, enabled: true });
    if (task) {
      const current = await api.request('GET', `/${id}/config`);
      const reference = current.config.tasks.find(value => value.type === 'task' && value.id === task.id);
      if (!reference) throw new Error('The managed scheduled task is missing its configuration reference.');
      if (!reference.enabled) {
        reference.enabled = true;
        await api.request('PUT', `/${id}/config`, { config: current.config, baseConfigHash: current.configHash });
      }
    }
    const validation = await api.request('GET', `/${id}/validation`);
    writeFileSync(path.join(backupDirectory, `${plan.role.toLowerCase()}-validation.json`), JSON.stringify(validation, null, 2), { mode: 0o600 });
    if (validation.status !== 'valid') throw new Error('The role agent configuration did not pass native n8n validation. Inspect the private validation report.');
    await api.request('POST', `/${id}/publish`, {});
    const verified = await api.request('GET', `/${id}`);
    const final = await api.request('GET', `/${id}/config`);
    if (!verified.isRunnable || !verified.activeVersionId || verified.activeVersionId !== verified.versionId || final.config.model !== ROLE_AGENT_MODEL || final.config.credential !== ROLE_AGENT_CREDENTIAL || !verified.setupCompletedAt) throw new Error('A role agent did not reach a runnable, published setup. No model calls were made.');
    agents.push({ id, name: verified.name || plan.name, role: plan.role, model: final.config.model, boundAccount: plan.boundAccount, toolWorkflowId: ROLE_AGENT_WORKFLOWS.find(value => value.role === plan.role).id, taskName: plan.taskName, schedule: plan.cronExpression, timezone: 'Asia/Kolkata', monthlyBudgetUsd: 3, sessionCostCapUsd: 0.1, readOnly: true, published: true, setupCompleted: true });
    console.log(JSON.stringify({ role: plan.role, name: verified.name, published: true, model: final.config.model, toolCount: final.config.tools.length }));
  }
  writeFileSync(previousPath, JSON.stringify({ configuredAt: new Date().toISOString(), projectId, agents, rootKeyStoredEncrypted: true, monthlyBudgetTotalUsd: 9, paidTestsPerformed: false }, null, 2), { mode: 0o600 });
  console.log('Three role agents configured. No paid model test has been run by this installer.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await configureRoleAgents(); } catch (error) {
    console.error(error instanceof SyntaxError ? 'Invalid local setup data. Secrets were withheld.' : error.message);
    if (error.issues) console.error(JSON.stringify(error.issues));
    process.exitCode = 1;
  }
}
