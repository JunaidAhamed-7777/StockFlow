// Installer contract fixtures only: no installed configuration, Docker, network or model is accessed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { configureRoleAgents } from './configure-role-agents.mjs';
import { ROLE_AGENT_PLANS, ROLE_AGENT_MODEL, ROLE_AGENT_CREDENTIAL, createRoleAgentConfig } from './role-agent-definitions.mjs';
import { ROLE_AGENT_WORKFLOWS } from './build-agent-workflows.mjs';

const projectId = 'FixtureProject01';
const adminId = 'FixtureExistingAdmin01';
const privateDetail = 'FIXTURE_PRIVATE_REQUEST_OR_CREDENTIAL_DETAIL';
const apiKey = `sk-${'fixture-private-key-'.repeat(3)}`;
const idFor = (plan) => plan.role === 'ADMIN' ? adminId : plan.id;
const managedPlan = (id) => ROLE_AGENT_PLANS.find((plan) => idFor(plan) === id);
const httpError = (status, message = privateDetail) => Object.assign(new Error(message), { status });
const agentWrites = (state) => state.requests.filter(({ method, route }) => method !== 'GET' && (route === '' || /\/config$|\/tasks(?:\/|$)/.test(route)));

function fixture(t) {
  const prefix = path.join(tmpdir(), 'stockflow-role-agent-setup-');
  const root = mkdtempSync(prefix);
  t.after(() => { assert.ok(root.startsWith(prefix)); rmSync(root, { recursive: true, force: true }); });
  const localDirectory = path.join(root, 'private-fixture');
  const unrelatedTask = { id: 'FixtureUnrelatedTask01', name: 'Existing operator task', objective: 'Keep this independent review', enabled: false, timezone: 'UTC', cronExpression: '0 8 * * *' };
  const unrelatedReference = { type: 'task', id: unrelatedTask.id, enabled: false, operatorMetadata: { preserve: true } };
  const adminPlan = ROLE_AGENT_PLANS.find((plan) => plan.role === 'ADMIN');
  const adminConfig = createRoleAgentConfig(adminPlan);
  adminConfig.tasks = [structuredClone(unrelatedReference)];
  const state = {
    agents: new Map([[adminId, { id: adminId, name: adminPlan.name, config: adminConfig, revision: 1, tasks: [structuredClone(unrelatedTask)] }]]),
    requests: [], dependencies: [], imports: [], workflows: new Map(), credentials: new Map(), logs: [],
    nextTask: 1, waits: 0, readinessReads: 0, readinessPhase: false, readinessFailures: [], taskEnvelope: 'direct',
  };
  const configHash = (agent) => `fixture-${agent.id}-${agent.revision}`;
  const api = { async request(method, route, body) {
    state.requests.push({ method, route, ...(body === undefined ? {} : { body: structuredClone(body) }) });
    assert.doesNotMatch(route, /chat|messages|execute|sessions|completion/i, 'Installer must not invoke an agent or model');
    if (state.requestFailure) throw state.requestFailure;
    if (state.beforeRequest) await state.beforeRequest({ method, route, body });
    if (state.readinessPhase && method === 'GET' && route === `/${adminId}`) {
      state.readinessReads++;
      if (state.readinessFailures.length) throw state.readinessFailures.shift();
      state.readinessPhase = false;
    }
    if (method === 'POST' && route === '') {
      assert.ok(body && !state.agents.has(body.id));
      state.agents.set(body.id, { id: body.id, name: body.name, config: structuredClone(body.schema), revision: 1, tasks: [] });
      return { id: body.id, name: body.name };
    }
    const [, id, resource, taskId] = route.split('/');
    const agent = state.agents.get(id);
    if (!agent) throw httpError(404);
    if (method === 'GET' && !resource) {
      return structuredClone({ id: agent.id, name: agent.name, isRunnable: agent.isRunnable || false, versionId: agent.versionId,
        activeVersionId: agent.activeVersionId, setupCompletedAt: agent.setupCompletedAt });
    }
    if (method === 'GET' && resource === 'config') return { config: structuredClone(agent.config), configHash: configHash(agent) };
    if (method === 'PUT' && resource === 'config') {
      assert.equal(body.baseConfigHash, configHash(agent), 'Configuration writes must use the current native hash');
      agent.config = structuredClone(body.config); agent.revision++;
      return { config: structuredClone(agent.config), configHash: configHash(agent) };
    }
    if (method === 'GET' && resource === 'tasks') {
      if (Object.hasOwn(agent, 'taskResponse')) return structuredClone(agent.taskResponse);
      const tasks = structuredClone(agent.tasks);
      return state.taskEnvelope === 'data' ? { data: tasks } : state.taskEnvelope === 'tasks' ? { tasks } : tasks;
    }
    if (method === 'POST' && resource === 'tasks') {
      const task = { id: `FixtureManagedTask${state.nextTask++}`, ...structuredClone(body) };
      agent.tasks.push(task);
      agent.config.tasks.push({ type: 'task', id: task.id, enabled: body.enabled === true }); agent.revision++;
      return structuredClone(task);
    }
    if (method === 'PATCH' && resource === 'tasks') {
      const task = agent.tasks.find((value) => value.id === taskId);
      assert.ok(task); Object.assign(task, structuredClone(body)); return structuredClone(task);
    }
    if (method === 'GET' && resource === 'validation') return { status: state.invalidRole === managedPlan(id)?.role ? 'invalid' : 'valid' };
    if (method === 'POST' && resource === 'publish') {
      agent.versionId = `fixture-version-${agent.revision}`; agent.activeVersionId = agent.versionId;
      agent.setupCompletedAt = '2026-10-16T05:00:00.000Z'; agent.isRunnable = true;
      return { published: true };
    }
    assert.fail(`Unexpected fixture request: ${method} ${route}`);
  } };
  const options = {
    root, localDirectory,
    assertLocal: () => { state.dependencies.push('assertLocal'); },
    createApi: async (selection) => { state.dependencies.push('createApi'); assert.deepEqual(selection, { projectId }); return api; },
    exportWorkflows: () => { state.dependencies.push('exportWorkflows'); return structuredClone([...state.workflows.values()]); },
    importObject: (kind, value) => {
      state.dependencies.push(`import:${kind}`); state.imports.push({ kind, value: structuredClone(value) });
      if (kind === 'credentials') for (const credential of Array.isArray(value) ? value : [value]) state.credentials.set(credential.id, structuredClone(credential));
      else { assert.equal(kind, 'workflow'); state.workflows.set(value.id, structuredClone(value)); }
    },
    exportCredential: (id) => {
      state.dependencies.push('exportCredential');
      if (state.credentialFailure) return { id, type: 'openAiApi', data: { apiKey: privateDetail, url: 'https://api.openai.com/v1' } };
      return structuredClone(state.credentials.get(id));
    },
    writeWorkflows: () => { state.dependencies.push('writeWorkflows'); },
    docker: (args) => {
      state.dependencies.push(`docker:${args[0]}`);
      assert.ok(args[0] === 'restart' || args.includes('publish:workflow'), 'Only publish/restart fixture boundaries are supported');
      if (args[0] === 'restart') state.readinessPhase = true;
      return '';
    },
    readEnvironment: () => { state.dependencies.push('readEnvironment'); return { OPENAI_API_KEY: apiKey }; },
    readLoginDocument: () => {
      state.dependencies.push('readLoginDocument');
      return ROLE_AGENT_PLANS.filter((plan) => plan.role !== 'ADMIN').map((plan) => `### ${plan.boundAccount} (${plan.role})\n- Email: \`${plan.role.toLowerCase()}@fixture.example.test\`\n- Password: \`fixture-${plan.role.toLowerCase()}-password\`\n`).join('\n');
    },
    wait: async () => { state.waits++; }, log: (message) => state.logs.push(message),
  };
  const args = ['--apply', `--project-id=${projectId}`, `--admin-agent-id=${adminId}`];
  const addManagedTask = (plan = adminPlan, { references = 1, enabled = true } = {}) => {
    const agent = state.agents.get(idFor(plan));
    const task = { id: `FixtureExistingManaged-${plan.role}`, name: plan.taskName, objective: 'Previous managed objective', enabled: true };
    agent.tasks.push(task);
    for (let index = 0; index < references; index++) agent.config.tasks.push({ type: 'task', id: task.id, enabled });
    return task;
  };
  return { root, localDirectory, state, options, args, addManagedTask, unrelatedTask, unrelatedReference,
    statusPath: path.join(localDirectory, 'role-agents.json') };
}

test('dry run reads no private files or dependencies and creates no directories', async (t) => {
  const f = fixture(t);
  const forbidden = () => assert.fail('Dry run invoked an installation dependency');
  await configureRoleAgents([], Object.fromEntries(Object.entries(f.options).map(([name, value]) => [name, typeof value === 'function' && name !== 'log' ? forbidden : value])));
  assert.deepEqual(readdirSync(f.root), []); assert.deepEqual(f.state.dependencies, []); assert.deepEqual(f.state.requests, []);
  const summary = JSON.parse(f.state.logs[0]);
  assert.equal(summary.dryRun, true); assert.equal(summary.model, ROLE_AGENT_MODEL); assert.equal(summary.roles.length, ROLE_AGENT_PLANS.length);
});

test('first apply reuses ADMIN, creates the other roles and one managed task per agent while preserving unrelated tasks', async (t) => {
  const f = fixture(t);
  await configureRoleAgents(f.args, f.options);
  assert.equal(f.state.agents.size, ROLE_AGENT_PLANS.length);
  assert.equal(f.state.requests.filter(({ method, route }) => method === 'POST' && route === '').length, ROLE_AGENT_PLANS.length - 1);
  assert.equal(f.state.requests.filter(({ method, route }) => method === 'POST' && route.endsWith('/tasks')).length, ROLE_AGENT_PLANS.length);
  for (const plan of ROLE_AGENT_PLANS) {
    const agent = f.state.agents.get(idFor(plan));
    const tasks = agent.tasks.filter((task) => task.name === plan.taskName);
    assert.equal(tasks.length, 1);
    assert.deepEqual(agent.config.tasks.filter((reference) => reference.type === 'task' && reference.id === tasks[0].id), [{ type: 'task', id: tasks[0].id, enabled: true }]);
    assert.equal(tasks[0].cronExpression, plan.cronExpression); assert.equal(tasks[0].timezone, 'Asia/Kolkata');
    assert.equal(agent.config.model, ROLE_AGENT_MODEL); assert.equal(agent.config.credential, ROLE_AGENT_CREDENTIAL);
    assert.equal(agent.config.tools.length, 1); assert.equal(agent.config.tools[0].workflowId, ROLE_AGENT_WORKFLOWS.find((definition) => definition.role === plan.role).id);
    assert.equal(agent.isRunnable, true); assert.equal(agent.activeVersionId, agent.versionId);
  }
  const admin = f.state.agents.get(adminId);
  assert.deepEqual(admin.tasks.find((task) => task.id === f.unrelatedTask.id), f.unrelatedTask);
  assert.deepEqual(admin.config.tasks.find((reference) => reference.id === f.unrelatedTask.id), f.unrelatedReference);
  const status = JSON.parse(readFileSync(f.statusPath, 'utf8'));
  assert.equal(status.projectId, projectId); assert.equal(status.agents.length, ROLE_AGENT_PLANS.length); assert.equal(status.paidTestsPerformed, false);
  assert.equal(f.state.logs.join('\n').includes(apiKey), false);
});

test('reruns reuse native agents and tasks without duplicating or changing configuration task references', async (t) => {
  const f = fixture(t); await configureRoleAgents(f.args, f.options);
  const references = new Map([...f.state.agents].map(([id, agent]) => [id, structuredClone(agent.config.tasks)]));
  const taskIds = new Map([...f.state.agents].map(([id, agent]) => [id, agent.tasks.map((task) => task.id)]));
  f.state.requests = [];
  await configureRoleAgents(['--apply'], f.options);
  assert.equal(f.state.requests.filter(({ method, route }) => method === 'POST' && (route === '' || route.endsWith('/tasks'))).length, 0);
  for (const [id, agent] of f.state.agents) {
    assert.deepEqual(agent.config.tasks, references.get(id)); assert.deepEqual(agent.tasks.map((task) => task.id), taskIds.get(id));
  }
});

test('a committed task POST with a lost response resumes using the existing task and native reference', async (t) => {
  const f = fixture(t); let loseResponse = true;
  const options = { ...f.options, createApi: async (selection) => {
    const api = await f.options.createApi(selection);
    return { async request(method, route, body) {
      const result = await api.request(method, route, body);
      if (loseResponse && method === 'POST' && route.endsWith('/tasks')) {
        loseResponse = false; throw new Error(privateDetail);
      }
      return result;
    } };
  } };
  await assert.rejects(configureRoleAgents(f.args, options), (error) => !error.message.includes(privateDetail));
  const adminPlan = ROLE_AGENT_PLANS.find((plan) => plan.role === 'ADMIN');
  const admin = f.state.agents.get(adminId);
  const task = admin.tasks.find((value) => value.name === adminPlan.taskName);
  assert.ok(task); assert.equal(existsSync(f.statusPath), false);
  const reference = structuredClone(admin.config.tasks.find((value) => value.id === task.id));
  await configureRoleAgents(f.args, options);
  assert.equal(admin.tasks.filter((value) => value.name === adminPlan.taskName).length, 1);
  assert.deepEqual(admin.config.tasks.find((value) => value.id === task.id), reference);
  assert.equal(f.state.requests.filter(({ method, route }) => method === 'POST' && route === `/${adminId}/tasks`).length, 1);
  assert.equal(f.state.agents.size, ROLE_AGENT_PLANS.length);
  assert.equal(JSON.parse(readFileSync(f.statusPath, 'utf8')).agents.length, ROLE_AGENT_PLANS.length);
});

test('invalid, duplicate and empty CLI selections are rejected before defaults or installation dependencies', async (t) => {
  for (const args of [
    ['--apply', '--project-id=', `--admin-agent-id=${adminId}`],
    ['--apply', `--project-id=${projectId}`, '--admin-agent-id='],
    ['--project-id=../private'], ['--admin-agent-id=../private'],
    ['--apply', '--project-id=one', '--project-id=two', `--admin-agent-id=${adminId}`],
    ['--apply', `--project-id=${projectId}`, '--admin-agent-id=one', '--admin-agent-id=two'],
    ['--apply', '--apply', `--project-id=${projectId}`, `--admin-agent-id=${adminId}`],
    ['--unknown'],
  ]) {
    const f = fixture(t);
    const forbidden = () => assert.fail('Invalid CLI selection invoked an installation dependency');
    const options = Object.fromEntries(Object.entries(f.options).map(([name, value]) => [name, typeof value === 'function' && name !== 'log' ? forbidden : value]));
    await assert.rejects(configureRoleAgents(args, options));
    assert.deepEqual(readdirSync(f.root), []); assert.deepEqual(f.state.dependencies, []); assert.deepEqual(f.state.requests, []);
  }
  const configured = fixture(t); await configureRoleAgents(configured.args, configured.options);
  const previous = readFileSync(configured.statusPath, 'utf8');
  configured.state.dependencies = []; configured.state.requests = [];
  await assert.rejects(configureRoleAgents(['--apply', '--project-id=', '--admin-agent-id='], configured.options));
  assert.deepEqual(configured.state.dependencies, []); assert.deepEqual(configured.state.requests, []);
  assert.equal(readFileSync(configured.statusPath, 'utf8'), previous);
});

test('existing managed references are re-enabled while unrelated disabled references stay unchanged', async (t) => {
  const f = fixture(t); const task = f.addManagedTask(undefined, { enabled: false });
  await configureRoleAgents(f.args, f.options);
  const admin = f.state.agents.get(adminId);
  assert.deepEqual(admin.config.tasks.find((reference) => reference.id === task.id), { type: 'task', id: task.id, enabled: true });
  assert.deepEqual(admin.config.tasks.find((reference) => reference.id === f.unrelatedTask.id), f.unrelatedReference);
  assert.equal(admin.tasks.filter((value) => value.name === ROLE_AGENT_PLANS[0].taskName).length, 1);
  assert.equal(f.state.requests.some(({ method, route }) => method === 'POST' && route === `/${adminId}/tasks`), false);
});

test('all supported native task response envelopes remain idempotent', async (t) => {
  for (const envelope of ['direct', 'data', 'tasks']) {
    const f = fixture(t); f.state.taskEnvelope = envelope; f.addManagedTask();
    await configureRoleAgents(f.args, f.options);
    assert.equal(f.state.requests.some(({ method, route }) => method === 'POST' && route === `/${adminId}/tasks`), false);
  }
});

test('duplicate managed task names and missing or duplicate managed references fail before agent config or task writes', async (t) => {
  for (const mode of ['duplicate-name', 'missing-reference', 'duplicate-reference', 'wrong-reference-type', 'malformed-references']) {
    const f = fixture(t);
    const task = f.addManagedTask(undefined, { references: mode === 'missing-reference' ? 0 : mode === 'duplicate-reference' ? 2 : 1 });
    const admin = f.state.agents.get(adminId);
    if (mode === 'duplicate-name') admin.tasks.push({ ...task, id: 'FixtureDuplicateManagedTask' });
    if (mode === 'wrong-reference-type') admin.config.tasks.find((reference) => reference.id === task.id).type = 'unknown';
    if (mode === 'malformed-references') admin.config.tasks = {};
    const before = structuredClone(admin.config);
    await assert.rejects(configureRoleAgents(f.args, f.options));
    assert.deepEqual(agentWrites(f.state), []); assert.deepEqual(admin.config, before);
    assert.equal(existsSync(f.statusPath), false);
  }
});

test('ambiguous, malformed and duplicate-ID task responses fail closed before configuration mutation', async (t) => {
  const taskName = ROLE_AGENT_PLANS.find((plan) => plan.role === 'ADMIN').taskName;
  for (const response of [{}, { data: [], tasks: [] }, { data: [], tasks: {} }, { data: null, tasks: [] }, { data: 'malformed', tasks: [] }, { data: [], tasks: null }, { data: {} }, { tasks: null }, null,
    [{ id: 'duplicate-id', name: taskName }, { id: 'duplicate-id', name: 'Another task' }], [{ id: '', name: taskName }], [{ name: taskName }]]) {
    const f = fixture(t); f.state.agents.get(adminId).taskResponse = response;
    await assert.rejects(configureRoleAgents(f.args, f.options));
    assert.deepEqual(agentWrites(f.state), []); assert.equal(existsSync(f.statusPath), false);
  }
});

test('wrong existing ADMIN and occupied reserved role names are not overwritten', async (t) => {
  const wrongAdmin = fixture(t); wrongAdmin.state.agents.get(adminId).name = 'Unrelated operator agent';
  await assert.rejects(configureRoleAgents(wrongAdmin.args, wrongAdmin.options));
  assert.deepEqual(agentWrites(wrongAdmin.state), []); assert.deepEqual(wrongAdmin.state.imports, []);
  const f = fixture(t); const plan = ROLE_AGENT_PLANS.find((value) => value.role !== 'ADMIN');
  const config = createRoleAgentConfig(plan, 'Unrelated reserved-ID occupant');
  f.state.agents.set(plan.id, { id: plan.id, name: 'Unrelated reserved-ID occupant', config, revision: 1, tasks: [] });
  await assert.rejects(configureRoleAgents(f.args, f.options));
  assert.deepEqual(f.state.agents.get(plan.id).config, config);
  assert.equal(agentWrites(f.state).some(({ route }) => route.startsWith(`/${plan.id}/`)), false);
  assert.equal(existsSync(f.statusPath), false);
});

test('credential verification and thrown request details are redacted from errors and logs', async (t) => {
  for (const mode of ['credential', 'request']) {
    const f = fixture(t);
    if (mode === 'credential') f.state.credentialFailure = true;
    else f.state.requestFailure = new Error(privateDetail);
    await assert.rejects(configureRoleAgents(f.args, f.options), (error) => !error.message.includes(privateDetail) && !error.message.includes(apiKey));
    assert.equal(f.state.logs.join('\n').includes(privateDetail), false); assert.equal(f.state.logs.join('\n').includes(apiKey), false);
    assert.deepEqual(agentWrites(f.state), []); assert.equal(existsSync(f.statusPath), false);
  }
});

test('readiness retries only 404, 503 and the known generic transport error', async (t) => {
  const f = fixture(t);
  f.state.readinessFailures = [httpError(404), httpError(503), new Error('Local n8n request could not be completed.')];
  await configureRoleAgents(f.args, f.options);
  assert.equal(f.state.readinessReads, 4); assert.equal(f.state.waits, 3);
  for (const error of [httpError(401), new Error(privateDetail)]) {
    const failed = fixture(t); failed.state.readinessFailures = [error];
    await assert.rejects(configureRoleAgents(failed.args, failed.options), (caught) => !caught.message.includes(privateDetail));
    assert.equal(failed.state.readinessReads, 1); assert.equal(failed.state.waits, 0);
    assert.deepEqual(agentWrites(failed.state), []); assert.equal(existsSync(failed.statusPath), false);
  }
});

test('native validation failure does not publish the invalid agent or write a successful status', async (t) => {
  const f = fixture(t); f.state.invalidRole = 'ADMIN';
  await assert.rejects(configureRoleAgents(f.args, f.options));
  assert.equal(f.state.requests.some(({ method, route }) => method === 'POST' && route.endsWith('/publish')), false);
  assert.equal(existsSync(f.statusPath), false);
});

test('post-publish task or reference corruption cannot produce a successful installation status', async (t) => {
  for (const mode of ['missing-managed-reference', 'duplicate-managed-reference', 'dropped-unrelated-reference', 'duplicate-managed-task']) {
    const f = fixture(t); let corrupted = false;
    const adminPlan = ROLE_AGENT_PLANS.find((plan) => plan.role === 'ADMIN');
    f.state.beforeRequest = ({ method, route }) => {
      const admin = f.state.agents.get(adminId);
      if (corrupted || !admin.isRunnable || method !== 'GET' || ![`/${adminId}/config`, `/${adminId}/tasks`].includes(route)) return;
      corrupted = true;
      const task = admin.tasks.find((value) => value.name === adminPlan.taskName);
      const reference = admin.config.tasks.find((value) => value.type === 'task' && value.id === task.id);
      if (mode === 'missing-managed-reference') admin.config.tasks = admin.config.tasks.filter((value) => value !== reference);
      if (mode === 'duplicate-managed-reference') admin.config.tasks.push(structuredClone(reference));
      if (mode === 'dropped-unrelated-reference') admin.config.tasks = admin.config.tasks.filter((value) => value.id !== f.unrelatedTask.id);
      if (mode === 'duplicate-managed-task') admin.tasks.push({ ...structuredClone(task), id: 'FixturePostPublishDuplicate' });
    };
    await assert.rejects(configureRoleAgents(f.args, f.options));
    assert.equal(corrupted, true, 'Fixture must reach the final native state read after publication');
    assert.equal(existsSync(f.statusPath), false);
    assert.equal(f.state.logs.some((message) => /Three role agents configured/.test(message)), false);
  }
});
