import { randomUUID, createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import dotenv from 'dotenv';
import { assertLocalN8n, dockerCapture as defaultDocker, exportLocalCredential, exportLocalWorkflows, importLocalObject, projectRoot } from './local-n8n.mjs';
import { createN8nAgentApi } from './n8n-agent-api.mjs';
import { ROLE_AGENT_WORKFLOWS, buildRoleAgentWorkflow, writeAgentWorkflows } from './build-agent-workflows.mjs';
import { ROLE_AGENT_PLANS, ROLE_AGENT_MODEL, ROLE_AGENT_CREDENTIAL, createRoleAgentConfig } from './role-agent-definitions.mjs';

class RoleAgentSetupError extends Error {}

export function readBoundAccount(markdown, name, role) {
  if (typeof markdown !== 'string' || typeof name !== 'string' || /[\r\n]/.test(name) || !['ADMIN', 'SUPPLIER', 'CUSTOMER'].includes(role)) throw new RoleAgentSetupError('Invalid private account selection.');
  const heading = `### ${name} (${role})`;
  const lines = markdown.split(/\r?\n/);
  const matches = lines.flatMap((line, index) => line === heading ? [index] : []);
  if (matches.length !== 1) throw new RoleAgentSetupError('Required private StockFlow account documentation is unavailable.');
  const following = lines.slice(matches[0] + 1);
  const end = following.findIndex(line => /^#{1,3} /.test(line));
  const section = following.slice(0, end < 0 ? undefined : end).join('\n');
  const emails = [...section.matchAll(/^- Email: `([^`\r\n]+)`$/gm)];
  const passwords = [...section.matchAll(/^- Password: `([^`\r\n]+)`$/gm)];
  const email = emails[0]?.[1];
  const password = passwords[0]?.[1];
  if (emails.length !== 1 || passwords.length !== 1 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || '') || email.length > 254 || !password?.trim() || password.length > 256) throw new RoleAgentSetupError('Required private StockFlow account documentation is incomplete.');
  return { email, password };
}

function managedTask(response, plan) {
  const keys = response && !Array.isArray(response) && typeof response === 'object' ? ['data', 'tasks'].filter((key) => Object.hasOwn(response, key)) : [];
  const tasks = Array.isArray(response) ? response : keys.length === 1 ? response[keys[0]] : undefined;
  if (!Array.isArray(tasks)) throw new RoleAgentSetupError('The native scheduled-task response is invalid or ambiguous.');
  if (tasks.some((task) => !task || typeof task.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(task.id) || typeof task.name !== 'string' || !task.name)
    || new Set(tasks.map((task) => task.id)).size !== tasks.length) throw new RoleAgentSetupError('The native scheduled-task response is invalid or ambiguous.');
  const matches = tasks.filter((task) => task.name === plan.taskName);
  if (matches.length > 1) throw new RoleAgentSetupError('Multiple managed scheduled tasks exist. Review them locally before retrying; none were deleted.');
  return matches[0];
}

function managedReference(config, task) {
  if (!config || !Array.isArray(config.tasks)) throw new RoleAgentSetupError('Native task configuration references are invalid.');
  const matches = config.tasks.filter((reference) => reference?.type === 'task' && reference.id === task.id);
  if (matches.length !== 1) throw new RoleAgentSetupError('The managed scheduled task must have exactly one configuration reference.');
  return matches[0];
}

function preservedReferences(config, task, unrelated) {
  const reference = managedReference(config, task);
  const others = config.tasks.filter((value) => !(value?.type === 'task' && value.id === task.id));
  if (!isDeepStrictEqual(others, unrelated)) throw new RoleAgentSetupError('Unrelated task configuration references were not preserved.');
  return reference;
}

export async function configureRoleAgents(args = process.argv.slice(2), {
  root = projectRoot, localDirectory = path.join(root, '.local'), assertLocal = assertLocalN8n,
  createApi = createN8nAgentApi, exportWorkflows = exportLocalWorkflows, importObject = importLocalObject,
  exportCredential = exportLocalCredential, writeWorkflows = writeAgentWorkflows, docker = defaultDocker,
  readEnvironment = () => dotenv.parse(readFileSync(path.join(root, '.env'), 'utf8')),
  readLoginDocument = () => readFileSync(path.join(localDirectory, 'LOGIN-ACCOUNTS.md'), 'utf8'),
  wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)), log = console.log,
} = {}) {
  try {
    const flags = ['--apply'];
    if (!Array.isArray(args) || args.some((value) => typeof value !== 'string' || (!flags.includes(value) && !value.startsWith('--project-id=') && !value.startsWith('--admin-agent-id=')))
      || new Set(args).size !== args.length || args.filter((value) => value.startsWith('--project-id=')).length > 1 || args.filter((value) => value.startsWith('--admin-agent-id=')).length > 1) {
      throw new RoleAgentSetupError('Usage: configure-role-agents.mjs [--apply] [--project-id=ID] [--admin-agent-id=ID]');
    }
    for (const prefix of ['--project-id=', '--admin-agent-id=']) {
      const option = args.find((value) => value.startsWith(prefix));
      if (option && !/^[A-Za-z0-9_-]{1,64}$/.test(option.slice(prefix.length))) throw new RoleAgentSetupError('A valid existing local project and admin agent ID is required.');
    }
    if (!args.includes('--apply')) {
      const summary = { dryRun: true, model: ROLE_AGENT_MODEL, roles: ROLE_AGENT_PLANS.map(plan => ({ role: plan.role, name: plan.name, boundAccount: plan.boundAccount, schedule: plan.cronExpression, timezone: 'Asia/Kolkata' })), scope: 'read-only API review, comparison, triage and drafts', monthlyBudgetTotalUsd: 9, sessionCostCapUsd: 0.1, rootApiKeyWillRemainPrivate: true };
      log(JSON.stringify(summary, null, 2));
      return summary;
    }
    const previousPath = path.join(localDirectory, 'role-agents.json');
    const previous = existsSync(previousPath) ? JSON.parse(readFileSync(previousPath, 'utf8')) : {};
    if (!previous || typeof previous !== 'object' || Array.isArray(previous)) throw new RoleAgentSetupError('The saved role-agent metadata is invalid.');
    const projectId = args.find(value => value.startsWith('--project-id='))?.slice(13) || previous.projectId;
    const adminAgentId = args.find(value => value.startsWith('--admin-agent-id='))?.slice(17) || previous.agents?.find(value => value.role === 'ADMIN')?.id;
    if (typeof projectId !== 'string' || typeof adminAgentId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(projectId) || !/^[A-Za-z0-9_-]{1,64}$/.test(adminAgentId)) throw new RoleAgentSetupError('Select the existing local project and admin agent IDs before applying.');
    await assertLocal();
    const api = await createApi({ projectId });
    const existingAdmin = await api.request('GET', `/${adminAgentId}`);
    if (existingAdmin.name !== 'Admin Notification') throw new RoleAgentSetupError('The selected existing agent is not Admin Notification. No configuration changed.');
    const backupDirectory = path.join(localDirectory, 'n8n-agent-backups', randomUUID());
    mkdirSync(backupDirectory, { recursive: true });
    writeFileSync(path.join(backupDirectory, 'admin-before.json'), JSON.stringify(await api.request('GET', `/${adminAgentId}/config`), null, 2), { mode: 0o600 });
    writeFileSync(path.join(backupDirectory, 'workflows-before.json'), JSON.stringify(await exportWorkflows(), null, 2), { mode: 0o600 });

    const environment = await readEnvironment();
    const apiKey = environment.OPENAI_API_KEY;
    if (typeof apiKey !== 'string' || !apiKey.startsWith('sk-') || apiKey.length < 20) throw new RoleAgentSetupError('A valid OPENAI_API_KEY is required in the root .env. Its value was withheld.');
    await importObject('credentials', [{ id: ROLE_AGENT_CREDENTIAL, name: 'StockFlow OpenAI GPT-5 mini', type: 'openAiApi', data: { apiKey, url: 'https://api.openai.com/v1' } }]);
    const stored = await exportCredential(ROLE_AGENT_CREDENTIAL);
    const fingerprint = value => createHash('sha256').update(String(value)).digest('hex');
    if (stored?.type !== 'openAiApi' || fingerprint(stored.data?.apiKey) !== fingerprint(apiKey) || stored.data?.url !== 'https://api.openai.com/v1') throw new RoleAgentSetupError('Encrypted OpenAI credential verification failed. Secrets were withheld.');

    const loginDoc = await readLoginDocument();
    const loginCredentials = ROLE_AGENT_WORKFLOWS.filter(value => value.role !== 'ADMIN').map(definition => ({ id: definition.credentialId, name: definition.credentialName, type: 'httpCustomAuth', data: { json: JSON.stringify({ body: readBoundAccount(loginDoc, definition.role === 'SUPPLIER' ? 'Supplier Test' : 'Customer Test', definition.role) }) } }));
    await importObject('credentials', loginCredentials);
    await writeWorkflows();
    for (const definition of ROLE_AGENT_WORKFLOWS) {
      await importObject('workflow', buildRoleAgentWorkflow(definition));
      await docker(['exec', 'n8n', 'n8n', 'publish:workflow', `--id=${definition.id}`]);
    }
    await docker(['restart', 'n8n']);
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
      await wait(500);
    }
    if (!healthy) throw new RoleAgentSetupError('Local n8n did not become healthy after role-tool installation.');

    const agents = [];
    for (const plan of ROLE_AGENT_PLANS) {
      const id = plan.role === 'ADMIN' ? adminAgentId : plan.id;
      let agent;
      try { agent = await api.request('GET', `/${id}`); } catch (error) { if (error.status !== 404 || plan.role === 'ADMIN') throw error; }
      const config = createRoleAgentConfig(plan, agent?.name || plan.name);
      let task;
      let unrelatedReferences = [];
      if (agent) {
        if (plan.role !== 'ADMIN' && agent.name !== plan.name) throw new RoleAgentSetupError('A role agent ID is occupied by another agent. It was not overwritten.');
        const current = await api.request('GET', `/${id}/config`);
        if (!Array.isArray(current?.config?.tasks) || typeof current.configHash !== 'string' || !current.configHash) throw new RoleAgentSetupError('Native task configuration references or version hash are invalid.');
        task = managedTask(await api.request('GET', `/${id}/tasks`), plan);
        if (task) managedReference(current.config, task);
        unrelatedReferences = structuredClone(current.config.tasks.filter((value) => !(task && value?.type === 'task' && value.id === task.id)));
        config.tasks = structuredClone(current.config.tasks);
        await api.request('PUT', `/${id}/config`, { config, baseConfigHash: current.configHash });
      } else {
        await api.request('POST', '', { id, name: plan.name, schema: config });
        task = managedTask(await api.request('GET', `/${id}/tasks`), plan);
      }
      const taskData = { name: plan.taskName, objective: plan.objective, cronExpression: plan.cronExpression, timezone: 'Asia/Kolkata' };
      if (task) await api.request('PATCH', `/${id}/tasks/${task.id}`, taskData);
      else await api.request('POST', `/${id}/tasks`, { ...taskData, enabled: true });
      const installedTask = managedTask(await api.request('GET', `/${id}/tasks`), plan);
      if (!installedTask || Object.entries(taskData).some(([key, value]) => installedTask[key] !== value)) throw new RoleAgentSetupError('The managed scheduled task did not match its reviewed objective and schedule.');
      const current = await api.request('GET', `/${id}/config`);
      const reference = preservedReferences(current.config, installedTask, unrelatedReferences);
      if (reference.enabled !== true) {
        reference.enabled = true;
        await api.request('PUT', `/${id}/config`, { config: current.config, baseConfigHash: current.configHash });
      }
      const expectedReferences = structuredClone(current.config.tasks);
      const validation = await api.request('GET', `/${id}/validation`);
      writeFileSync(path.join(backupDirectory, `${plan.role.toLowerCase()}-validation.json`), JSON.stringify(validation, null, 2), { mode: 0o600 });
      if (validation.status !== 'valid') throw new RoleAgentSetupError('The role agent configuration did not pass native n8n validation. Inspect the private validation report.');
      await api.request('POST', `/${id}/publish`, {});
      const verified = await api.request('GET', `/${id}`);
      const final = await api.request('GET', `/${id}/config`);
      const finalTask = managedTask(await api.request('GET', `/${id}/tasks`), plan);
      if (!finalTask || finalTask.id !== installedTask.id || Object.entries(taskData).some(([key, value]) => finalTask[key] !== value)
        || !isDeepStrictEqual(final.config.tasks, expectedReferences) || preservedReferences(final.config, finalTask, unrelatedReferences).enabled !== true) {
        throw new RoleAgentSetupError('The published managed task or configuration references did not match the reviewed setup.');
      }
      if (!verified.isRunnable || !verified.activeVersionId || verified.activeVersionId !== verified.versionId || final.config.model !== ROLE_AGENT_MODEL || final.config.credential !== ROLE_AGENT_CREDENTIAL || !verified.setupCompletedAt) throw new RoleAgentSetupError('A role agent did not reach a runnable, published setup. No model calls were made.');
      agents.push({ id, name: plan.name, role: plan.role, model: final.config.model, boundAccount: plan.boundAccount, toolWorkflowId: ROLE_AGENT_WORKFLOWS.find(value => value.role === plan.role).id, taskName: plan.taskName, schedule: plan.cronExpression, timezone: 'Asia/Kolkata', monthlyBudgetUsd: 3, sessionCostCapUsd: 0.1, readOnly: true, published: true, setupCompleted: true });
      log(JSON.stringify({ role: plan.role, name: plan.name, published: true, model: final.config.model, toolCount: final.config.tools.length }));
    }
    writeFileSync(previousPath, JSON.stringify({ configuredAt: new Date().toISOString(), projectId, agents, rootKeyStoredEncrypted: true, monthlyBudgetTotalUsd: 9, paidTestsPerformed: false }, null, 2), { mode: 0o600 });
    log('Three role agents configured. No paid model test has been run by this installer.');
    return { projectId, agents, paidTestsPerformed: false };
  } catch (error) {
    if (error instanceof RoleAgentSetupError) throw error;
    throw new RoleAgentSetupError('Local role-agent configuration failed. Sensitive local data and subprocess output were withheld.');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await configureRoleAgents(); } catch (error) {
    console.error(error instanceof RoleAgentSetupError ? error.message : 'Local role-agent configuration failed. Sensitive local data and subprocess output were withheld.');
    process.exitCode = 1;
  }
}
