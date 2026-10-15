import test from 'node:test';
import assert from 'node:assert/strict';
import { createNotificationMaintenance } from './notification-maintenance.mjs';
import { WORKFLOW_MODES } from './verify-local.mjs';

const ids = Object.keys(WORKFLOW_MODES);
const login = { emailOrLdapLoginId: 'owner@example.test', password: 'OFFLINE_PRIVATE_PASSWORD' };
const response = (data, options) => new Response(JSON.stringify({ data }), options);

function fixture(overrides = {}) {
  const state = {
    workflows: new Map(ids.map((id) => [id, { id, versionId: `version-${id}`, active: true, activeVersionId: `version-${id}`, activeVersion: { versionId: `version-${id}` }, checksum: `checksum-${id}` }])),
    settings: { versionCli: '2.43.6', executionMode: 'regular', isMultiMain: false, useWorkflowPublicationService: overrides.outbox ?? false },
    calls: [], sessions: 0, verified: 0, ownerReads: 0, milliseconds: 0, deactivated: [], drainReads: 0,
    activeErrors: new Map(), owner: true,
  };
  const fetchImpl = async (input, options) => {
    const url = new URL(input);
    assert.equal(url.origin, 'http://localhost:5678');
    state.calls.push({ url, options });
    const changed = await overrides.request?.(url, options, state);
    if (changed) return changed;
    if (url.pathname === '/rest/login') {
      state.sessions++;
      return response({ role: state.owner ? 'global:owner' : 'global:admin', isOwner: state.owner }, { headers: { 'set-cookie': `n8n-auth=OFFLINE_SESSION_${state.sessions}; Path=/; HttpOnly` } });
    }
    if (url.pathname === '/rest/settings') return response(state.settings);
    if (url.pathname === '/rest/active-workflows') return response([...state.workflows.values()].filter((row) => row.active).map((row) => row.id).concat('UnrelatedAgentWorkflow'));
    const errorId = url.pathname.match(/^\/rest\/active-workflows\/error\/([A-Za-z0-9_-]+)$/)?.[1];
    if (errorId) return response(state.activeErrors.get(errorId) ?? null);
    const publicationId = url.pathname.match(/^\/rest\/workflows\/([A-Za-z0-9_-]+)\/publication-status$/)?.[1];
    if (publicationId) {
      const workflow = state.workflows.get(publicationId);
      return response(overrides.publication?.(publicationId, state) ?? (workflow.active
        ? { status: 'published', liveVersionId: workflow.activeVersionId, pendingVersionId: null, triggers: ['schedule', 'manual-check', 'send-discord-notification'].map((nodeId) => ({ nodeId, status: 'activated', errorMessage: null })) }
        : { status: 'not_published', liveVersionId: null, pendingVersionId: null, triggers: [] }));
    }
    const workflow = url.pathname.match(/^\/rest\/workflows\/([A-Za-z0-9_-]+)(\/deactivate)?$/);
    if (workflow) {
      assert.ok(ids.includes(workflow[1]));
      const current = state.workflows.get(workflow[1]);
      if (workflow[2]) {
        assert.equal(options.method, 'POST');
        assert.deepEqual(JSON.parse(options.body), { expectedChecksum: current.checksum });
        current.active = false; current.activeVersionId = null; current.activeVersion = null;
        state.deactivated.push(current.id);
      } else assert.equal(options.method, 'GET');
      return response(current);
    }
    if (url.pathname === '/rest/executions') {
      assert.equal(options.method, 'GET'); assert.equal(url.searchParams.get('limit'), '1');
      const filter = JSON.parse(url.searchParams.get('filter'));
      assert.ok(ids.includes(filter.workflowId)); assert.deepEqual(filter.status, ['new', 'running', 'waiting', 'unknown']);
      state.drainReads++;
      return response(overrides.executions?.(filter.workflowId, state) ?? { results: [], count: 0, estimated: false, nextCursor: null });
    }
    assert.fail('Unexpected notification maintenance route');
  };
  const options = { fetchImpl, verifyLocal: async () => { state.verified++; }, readOwnerLogin: async () => { state.ownerReads++; return login; },
    wait: async (milliseconds) => { state.milliseconds += milliseconds; }, now: () => state.milliseconds, timeoutMs: 20, pollMs: 10 };
  return { state, options, helper: createNotificationMaintenance(options), expected: () => structuredClone([...state.workflows.values()]) };
}

test('construction and invalid IDs/versions have no filesystem, authentication or mutation effects', async () => {
  const f = fixture(); assert.deepEqual(Object.keys(f.helper), ['quiesce', 'verifyActive']); assert.equal(f.state.calls.length, 0);
  for (const expected of [null, [], f.expected().slice(1), [...f.expected().slice(1), f.expected()[1]], f.expected().map((row, index) => index ? row : { ...row, id: 'UnrelatedWorkflow' }), f.expected().map((row, index) => index ? row : { ...row, versionId: '' })]) await assert.rejects(f.helper.quiesce(expected));
  await assert.rejects(f.helper.verifyActive(['UnrelatedWorkflow']));
  assert.equal(f.state.calls.length, 0); assert.equal(f.state.verified, 0); assert.equal(f.state.ownerReads, 0);
});

test('all versions are checked before deactivation, schedules are removed before drain and existing runs finish naturally', async () => {
  const f = fixture({ executions: (id, state) => id === ids[0] && state.milliseconds === 0
    ? { results: [{ workflowId: id, status: 'running' }], count: 1, estimated: false, nextCursor: 'opaque-cursor' } : undefined });
  const result = await f.helper.quiesce(f.expected());
  assert.deepEqual(result, { quiesced: true, deactivatedCount: 5, drained: true });
  assert.deepEqual(f.state.deactivated, ids); assert.equal(f.state.drainReads, 10); assert.equal(f.state.milliseconds, 10);
  const firstMutation = f.state.calls.findIndex(({ url }) => url.pathname.endsWith('/deactivate'));
  assert.deepEqual(f.state.calls.slice(2, firstMutation - 1).map(({ url }) => url.pathname), ids.map((id) => `/rest/workflows/${id}`));
  const firstDrain = f.state.calls.findIndex(({ url }) => url.pathname === '/rest/executions');
  assert.equal(f.state.calls.slice(0, firstDrain).filter(({ url }) => url.pathname.endsWith('/deactivate')).length, 5);
  for (const { url, options } of f.state.calls) {
    assert.equal(options.redirect, 'error'); assert.equal(options.credentials, 'omit'); assert.equal(options.cache, 'no-store');
    assert.ok(options.signal); assert.ok(options.headers['browser-id']);
    if (url.pathname !== '/rest/login') assert.equal(options.headers.cookie, 'n8n-auth=OFFLINE_SESSION_1');
    assert.ok(options.method === 'GET' || url.pathname === '/rest/login' || url.pathname.endsWith('/deactivate'));
    assert.doesNotMatch(url.pathname, /\/run$|\/stop$|retry|stopMany|chat|execute/);
  }
  assert.doesNotMatch(JSON.stringify(result) + JSON.stringify(f.helper), /OFFLINE|cookie|password/);
});

test('stale last workflow versions and unsupported runtime modes abort before any deactivation', async () => {
  const stale = fixture(); const expected = stale.expected(); stale.state.workflows.get(ids.at(-1)).versionId = 'concurrent-version';
  await assert.rejects(stale.helper.quiesce(expected), (error) => error.paused === false && error.deactivatedCount === 0);
  assert.deepEqual(stale.state.deactivated, []);
  for (const mutation of [{ versionCli: '2.43.7' }, { executionMode: 'queue' }, { isMultiMain: true }, { useWorkflowPublicationService: undefined }, { useWorkflowPublicationService: 'true' }]) {
    const f = fixture(); Object.assign(f.state.settings, mutation);
    await assert.rejects(f.helper.quiesce(f.expected()), /Unsupported/); assert.deepEqual(f.state.deactivated, []);
  }
});

test('each version is rechecked just before deactivation and partial failures do not claim full pause', async () => {
  let reads = 0;
  const f = fixture({ request: (url, options, state) => {
    if (url.pathname === `/rest/workflows/${ids[1]}` && ++reads === 2) state.workflows.get(ids[1]).versionId = 'concurrent-version';
  } });
  await assert.rejects(f.helper.quiesce(f.expected()), (error) => error.paused === false && error.deactivatedCount === 1);
  assert.equal(f.state.deactivated.length, 1);
  const transport = fixture({ request: (url) => { if (url.pathname === `/rest/workflows/${ids[1]}/deactivate`) throw new Error('OFFLINE_PRIVATE_TOKEN'); } });
  await assert.rejects(transport.helper.quiesce(transport.expected()), (error) => error.paused === false && error.deactivatedCount === 1 && !error.message.includes('OFFLINE'));
  assert.equal(transport.state.workflows.get(ids[1]).active, true); assert.equal(transport.state.drainReads, 0);
});

test('drain timeout leaves schedules paused, never stops runs and supports already-unpublished recovery', async () => {
  const f = fixture({ executions: (id) => ({ results: [{ workflowId: id, status: 'waiting' }], count: 1, estimated: false, nextCursor: null }) });
  await assert.rejects(f.helper.quiesce(f.expected()), (error) => error.paused === true && error.deactivatedCount === 5 && /did not drain/.test(error.message));
  assert.ok([...f.state.workflows.values()].every((workflow) => !workflow.active));
  assert.equal(f.state.milliseconds, 20); assert.equal(f.state.calls.filter(({ options }) => options.method === 'POST').length, 6);
  const recovered = fixture();
  for (const workflow of recovered.state.workflows.values()) { workflow.active = false; workflow.activeVersionId = null; workflow.activeVersion = null; }
  assert.deepEqual(await recovered.helper.quiesce(recovered.expected()), { quiesced: true, deactivatedCount: 0, drained: true });
  assert.deepEqual(recovered.state.deactivated, []);
});

test('malformed or estimated drain metadata fails closed without exposing execution data', async () => {
  for (const data of [{ results: [], count: 0, estimated: true, nextCursor: null }, { results: [], count: -1, estimated: false, nextCursor: null },
    { results: [{ workflowId: 'UnrelatedWorkflow', status: 'running', secret: 'OFFLINE_PRIVATE_TOKEN' }], count: 1, estimated: false, nextCursor: null },
    { results: [], count: 0, estimated: false, nextCursor: 'unexpected' }, { count: 0, estimated: false }]) {
    const f = fixture({ executions: () => data });
    await assert.rejects(f.helper.quiesce(f.expected()), (error) => error.paused === true && !error.message.includes('OFFLINE'));
  }
});

test('reactivation during execution drain is detected before reporting quiesced', async () => {
  const f = fixture({ executions: (id, state) => {
    if (id === ids.at(-1)) {
      const workflow = state.workflows.get(ids[0]);
      workflow.active = true; workflow.activeVersionId = workflow.versionId; workflow.activeVersion = { versionId: workflow.versionId };
    }
  } });
  await assert.rejects(f.helper.quiesce(f.expected()), (error) => error.paused === false && error.deactivatedCount === 5 && /not paused|changed during drain/.test(error.message));
});

test('outbox mode waits for daemon teardown proof before reading executions', async () => {
  const f = fixture({ outbox: true, publication: (id, state) => !state.workflows.get(id).active && state.milliseconds === 0
    ? { status: 'in_progress', liveVersionId: `version-${id}`, pendingVersionId: null, triggers: [{ nodeId: 'schedule', status: 'activated', errorMessage: null }] } : undefined,
  executions: (_, state) => { assert.equal(state.milliseconds, 10); } });
  assert.deepEqual(await f.helper.quiesce(f.expected()), { quiesced: true, deactivatedCount: 5, drained: true });
  assert.equal(f.state.drainReads, 5); assert.equal(f.state.milliseconds, 10);
  const firstMutation = f.state.calls.findIndex(({ url }) => url.pathname.endsWith('/deactivate'));
  assert.equal(f.state.calls.slice(0, firstMutation).filter(({ url }) => url.pathname.endsWith('/publication-status')).length, 5);
  assert.ok(f.state.calls.filter(({ url }) => url.pathname.endsWith('/publication-status')).length >= 20);
});

test('outbox teardown timeout/malformed/failed states remain unverified and never begin execution drain', async () => {
  const states = [
    { status: 'in_progress', liveVersionId: 'old-live-version', pendingVersionId: null, triggers: [] },
    { status: 'not_published', liveVersionId: 'old-live-version', pendingVersionId: null, triggers: [] },
    { status: 'not_published', liveVersionId: null, pendingVersionId: null, triggers: [{ nodeId: 'schedule', status: 'activated', errorMessage: null }] },
    { status: 'failed', liveVersionId: null, pendingVersionId: null, triggers: [{ nodeId: 'schedule', status: 'failed', errorMessage: 'OFFLINE_PRIVATE_ERROR' }] },
  ];
  for (const status of states) {
    const f = fixture({ outbox: true, publication: (id, state) => !state.workflows.get(id).active ? status : undefined });
    await assert.rejects(f.helper.quiesce(f.expected()), (error) => error.paused === false && error.deactivatedCount === 5 && !error.message.includes('OFFLINE'));
    assert.equal(f.state.drainReads, 0);
  }
  const absent = fixture({ outbox: true, request: (url) => url.pathname.endsWith('/publication-status') ? new Response('OFFLINE_PRIVATE_ERROR', { status: 404 }) : undefined });
  await assert.rejects(absent.helper.quiesce(absent.expected())); assert.deepEqual(absent.state.deactivated, []);
});

test('outbox activation requires exact schedule/manual/Discord trigger registration and rejects an unexpected fourth row', async () => {
  const f = fixture({ outbox: true, publication: (id, state) => state.milliseconds === 0
    ? { status: 'in_progress', liveVersionId: null, pendingVersionId: `version-${id}`, triggers: [] } : undefined });
  assert.deepEqual(await f.helper.verifyActive(ids), { activeCount: 5, activationErrors: 0 });
  assert.equal(f.state.milliseconds, 10);
  const expected = { status: 'published', liveVersionId: `version-${ids[0]}`, pendingVersionId: null, triggers: ['schedule', 'manual-check', 'send-discord-notification'].map((nodeId) => ({ nodeId, status: 'activated', errorMessage: null })) };
  const invalid = [
    { ...expected, liveVersionId: 'other-version' }, { ...expected, pendingVersionId: 'pending-version' },
    { ...expected, triggers: expected.triggers.slice(0, 2) },
    { ...expected, triggers: [...expected.triggers.slice(0, 2), { nodeId: 'unrelated-trigger', status: 'activated', errorMessage: null }] },
    { ...expected, triggers: [...expected.triggers, { nodeId: 'unrelated-trigger', status: 'activated', errorMessage: null }] },
    { ...expected, triggers: [expected.triggers[0], expected.triggers[0]] },
    { ...expected, status: 'partial', triggers: [expected.triggers[0], { nodeId: 'manual-check', status: 'failed', errorMessage: 'OFFLINE_PRIVATE_ERROR' }] },
    { ...expected, triggers: [expected.triggers[0], { nodeId: 'manual-check', status: 'activated', errorMessage: 'OFFLINE_PRIVATE_ERROR' }] },
  ];
  for (const status of invalid) {
    const bad = fixture({ outbox: true, publication: (id) => id === ids[0] ? status : undefined });
    await assert.rejects(bad.helper.verifyActive(ids), (error) => !error.message.includes('OFFLINE'));
    assert.deepEqual(bad.state.deactivated, []);
  }
  const stuck = fixture({ outbox: true, publication: (id) => ({ status: 'in_progress', liveVersionId: null, pendingVersionId: `version-${id}`, triggers: [] }) });
  await assert.rejects(stuck.helper.verifyActive(ids), /activation did not settle/); assert.equal(stuck.state.milliseconds, 20);
});

test('verification reauthenticates after restart, requires all five published IDs and checks activation errors', async () => {
  const f = fixture(); await f.helper.quiesce(f.expected());
  for (const workflow of f.state.workflows.values()) { workflow.active = true; workflow.activeVersionId = workflow.versionId; workflow.activeVersion = { versionId: workflow.versionId }; }
  assert.deepEqual(await f.helper.verifyActive(ids), { activeCount: 5, activationErrors: 0 });
  assert.equal(f.state.sessions, 2); assert.equal(f.state.verified, 2); assert.equal(f.state.ownerReads, 2);
  const last = f.state.calls.at(-1); assert.equal(last.options.headers.cookie, 'n8n-auth=OFFLINE_SESSION_2');
  f.state.activeErrors.set(ids[0], 'OFFLINE_PRIVATE_TOKEN');
  await assert.rejects(f.helper.verifyActive(ids), (error) => /activation error/.test(error.message) && !error.message.includes('OFFLINE'));
  f.state.activeErrors.clear(); f.state.workflows.get(ids[0]).activeVersionId = 'older-published-version'; f.state.workflows.get(ids[0]).activeVersion = { versionId: 'older-published-version' };
  await assert.rejects(f.helper.verifyActive(ids), /could not be verified/);
  f.state.workflows.get(ids[0]).active = false; f.state.workflows.get(ids[0]).activeVersionId = null; f.state.workflows.get(ids[0]).activeVersion = null;
  await assert.rejects(f.helper.verifyActive(ids), /could not be verified/);
});

test('local verification, owner authentication, redirect and raw transport failures are redacted', async () => {
  const verify = fixture();
  await assert.rejects(createNotificationMaintenance({ ...verify.options, verifyLocal: () => { throw new Error('OFFLINE_PRIVATE_MARKER'); } }).quiesce(verify.expected()), (error) => !error.message.includes('OFFLINE'));
  assert.equal(verify.state.ownerReads, 0); assert.equal(verify.state.calls.length, 0);
  const nonOwner = fixture(); nonOwner.state.owner = false;
  await assert.rejects(nonOwner.helper.quiesce(nonOwner.expected()), /owner authentication/); assert.deepEqual(nonOwner.state.deactivated, []);
  for (const handler of [() => new Response('OFFLINE_PRIVATE_TOKEN', { status: 302, headers: { location: 'https://remote.invalid' } }), () => { throw new Error('OFFLINE_PRIVATE_PASSWORD'); }, () => new Response('OFFLINE_PRIVATE_TOKEN', { status: 500 }), () => new Response('OFFLINE_PRIVATE_TOKEN')]) {
    const f = fixture({ request: handler });
    await assert.rejects(f.helper.quiesce(f.expected()), (error) => !error.message.includes('OFFLINE') && error.paused === false && error.deactivatedCount === 0);
    assert.equal(f.state.calls.length, 1);
  }
});
