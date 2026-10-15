import { isDeepStrictEqual } from 'node:util';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createN8nAgentApi } from './n8n-agent-api.mjs';
import { localDirectory } from './local-n8n.mjs';
import { ROLE_AGENT_PLANS, createRoleAgentConfig } from './role-agent-definitions.mjs';

export function verifyPublishedAgent(plan, agent, config, tasks, validation, budget) {
  const expected = createRoleAgentConfig(plan, plan.name);
  // The editor adds presentation metadata and an empty provider-tools list on load.
  const { tasks: references, personalisation: _personalisation, providerTools = {}, ...actualConfig } = config;
  const { tasks: _tasks, ...expectedConfig } = expected;
  const managed = tasks.filter(task => task.name === plan.taskName);
  const noProviderTools = providerTools && typeof providerTools === 'object' && (Array.isArray(providerTools) || Object.getPrototypeOf(providerTools) === Object.prototype) && Object.keys(providerTools).length === 0;
  if (agent.name !== plan.name || !agent.isRunnable || !agent.setupCompletedAt || !agent.activeVersionId || agent.versionId !== agent.activeVersionId || validation.status !== 'valid' || !noProviderTools || !isDeepStrictEqual(actualConfig, expectedConfig)) throw new Error('Published role-agent configuration differs from the reviewed setup.');
  if (managed.length !== 1 || managed[0].objective !== plan.objective || managed[0].cronExpression !== plan.cronExpression || managed[0].timezone !== 'Asia/Kolkata' || !references?.some(ref => ref.type === 'task' && ref.id === managed[0].id && ref.enabled === true)) throw new Error('The reviewed scheduled task is missing, changed, or disabled.');
  if (!Number.isFinite(budget.spentUsd) || budget.spentUsd < 0) throw new Error('Agent budget data is unavailable.');
  return { role: plan.role, id: agent.id, name: agent.name, model: config.model, published: true, runnable: true, readOnly: true, boundAccount: plan.boundAccount, toolWorkflowId: config.tools[0].workflowId, schedule: plan.cronExpression, timezone: managed[0].timezone, monthlyBudgetUsd: 3, sessionCostCapUsd: 0.1, spentUsd: budget.spentUsd };
}

export async function verifyRoleAgents() {
  const setup = JSON.parse(readFileSync(path.join(localDirectory, 'role-agents.json'), 'utf8'));
  const api = await createN8nAgentApi({ projectId: setup.projectId });
  const reports = [];
  for (const plan of ROLE_AGENT_PLANS) {
    const id = setup.agents.find(agent => agent.role === plan.role)?.id;
    if (!id) throw new Error('Private role-agent setup is incomplete.');
    const agent = await api.request('GET', `/${id}`);
    const { config } = await api.request('GET', `/${id}/config`);
    const tasks = await api.request('GET', `/${id}/tasks`);
    const validation = await api.request('GET', `/${id}/validation`);
    const budget = await api.request('GET', `/${id}/budget`);
    reports.push(verifyPublishedAgent(plan, agent, config, Array.isArray(tasks) ? tasks : tasks.data || tasks.tasks || [], validation, budget));
  }
  const report = { checkedAt: new Date().toISOString(), success: true, reports, totalSpentUsd: reports.reduce((sum, report) => sum + report.spentUsd, 0), modelCallsMadeByVerifier: 0 };
  writeFileSync(path.join(localDirectory, 'role-agent-verification.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(report, null, 2));
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await verifyRoleAgents(); }
  catch { console.error('Role-agent verification failed. Configuration and credentials were withheld. No model calls were made.'); process.exitCode = 1; }
}
