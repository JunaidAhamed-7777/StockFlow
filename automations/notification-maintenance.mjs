import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { assertLocalN8n, projectRoot } from './local-n8n.mjs';
import { parseOwnerLogin } from './n8n-agent-api.mjs';
import { WORKFLOW_MODES } from './verify-local.mjs';

// Official n8n@2.43.6 sources: workflows/workflows.controller.ts,
// executions/{executions.controller,parse-range-query.middleware}.ts and
// controllers/active-workflows.controller.ts. No execution/stop/retry endpoint is used.
const origin = 'http://localhost:5678';
const ids = Object.freeze(Object.keys(WORKFLOW_MODES));
// DiscordV2 exposes a webhook handler even for sendLegacy; n8n 2.43.6 classifies it as trigger-like.
const triggerIds = ['schedule', 'manual-check', 'send-discord-notification']; // Fixed IDs emitted by build-workflows.mjs.
const safeId = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
class MaintenanceError extends Error {}
const fail = (message) => { throw new MaintenanceError(message); };

function exactIds(values) {
  if (!Array.isArray(values) || values.length !== ids.length || new Set(values).size !== ids.length || values.some((id) => !ids.includes(id))) fail('Exactly five known StockFlow notification IDs are required.');
  return [...values];
}

function publication(workflow) {
  if (!workflow || !ids.includes(workflow.id) || !safeId(workflow.versionId) || typeof workflow.active !== 'boolean' || workflow.isArchived === true) fail('Managed workflow publication metadata is invalid.');
  if (Object.hasOwn(workflow, 'activeVersionId') && (workflow.active ? !safeId(workflow.activeVersionId) : workflow.activeVersionId !== null)) fail('Managed workflow publication metadata is invalid.');
  if (Object.hasOwn(workflow, 'activeVersion') && (workflow.active
    ? !workflow.activeVersion || !safeId(workflow.activeVersion.versionId) || (workflow.activeVersionId && workflow.activeVersion.versionId !== workflow.activeVersionId)
    : workflow.activeVersion !== null)) fail('Managed workflow publication metadata is invalid.');
  return { id: workflow.id, versionId: workflow.versionId, active: workflow.active,
    ...(Object.hasOwn(workflow, 'activeVersionId') ? { activeVersionId: workflow.activeVersionId } : {}) };
}

function sameVersion(expected, actual) {
  const current = publication(actual);
  if (Object.entries(expected).some(([key, value]) => current[key] !== value)) fail('Managed workflow versions changed. No further schedules were changed.');
  return current;
}

function checksumAvailable(workflow) {
  if (workflow.active && (typeof workflow.checksum !== 'string' || !workflow.checksum || workflow.checksum.length > 256)) fail('Managed workflow conflict metadata is unavailable.');
}

async function responseText(response) {
  const chunks = []; let bytes = 0;
  for await (const chunk of response.body || []) {
    bytes += chunk.byteLength;
    if (bytes > 2 * 1024 * 1024) fail('Local n8n response exceeded the size limit.');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Lazy local owner session. Construction performs no I/O; all errors omit raw responses. */
export function createNotificationMaintenance({
  root = projectRoot, fetchImpl = globalThis.fetch, verifyLocal = assertLocalN8n,
  readOwnerLogin = async () => parseOwnerLogin(await readFile(path.join(root, '.local/LOGIN-ACCOUNTS.md'), 'utf8')),
  wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)), now = Date.now,
  timeoutMs = 120000, pollMs = 500,
} = {}) {
  if (![fetchImpl, verifyLocal, readOwnerLogin, wait, now].every((value) => typeof value === 'function')
    || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000 || !Number.isInteger(pollMs) || pollMs < 1 || pollMs > 10000) fail('Invalid notification maintenance configuration.');

  async function authenticate() {
    await verifyLocal();
    const owner = await readOwnerLogin();
    if (!owner || typeof owner.emailOrLdapLoginId !== 'string' || typeof owner.password !== 'string' || !owner.password) fail('The private n8n owner login is unavailable.');
    const browserId = randomUUID(); let cookie;
    async function request(route, method = 'GET', body) {
      const response = await fetchImpl(`${origin}/rest${route}`, {
        method, headers: { 'content-type': 'application/json', accept: 'application/json', 'browser-id': browserId, ...(cookie ? { cookie } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: 'error', credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(10000),
      });
      if (response.redirected || !response.ok || response.status >= 300) fail('Local n8n maintenance request failed. Sensitive response data was withheld.');
      const raw = await responseText(response);
      let envelope;
      try { envelope = JSON.parse(raw); } catch { fail('Local n8n returned invalid maintenance metadata.'); }
      if (!envelope || !Object.hasOwn(envelope, 'data')) fail('Local n8n returned invalid maintenance metadata.');
      if (route === '/login') {
        if (envelope.data?.role !== 'global:owner' || envelope.data?.isOwner !== true) fail('Local n8n owner authentication is required.');
        const headers = response.headers;
        const values = headers.getSetCookie ? headers.getSetCookie() : [headers.get('set-cookie') || ''];
        const matches = values.flatMap((value) => [...value.matchAll(/(?:^|,\s*)n8n-auth=([A-Za-z0-9._~-]{1,8192})(?=;|,|$)/g)]);
        if (matches.length !== 1) fail('Local n8n owner authentication is required.');
        cookie = `n8n-auth=${matches[0][1]}`;
      }
      return envelope.data;
    }
    await request('/login', 'POST', { emailOrLdapLoginId: owner.emailOrLdapLoginId, password: owner.password });
    const settings = await request('/settings');
    if (settings?.versionCli !== '2.43.6' || settings.executionMode !== 'regular' || settings.isMultiMain !== false || typeof settings.useWorkflowPublicationService !== 'boolean') fail('Unsupported local n8n version or execution/publication mode.');
    return { request, outbox: settings.useWorkflowPublicationService };
  }

  async function activeIds(request) {
    const active = await request('/active-workflows');
    if (!Array.isArray(active) || active.some((id) => !safeId(id)) || new Set(active).size !== active.length) fail('Local active workflow metadata is invalid.');
    return active;
  }

  async function triggerStatus(request, id) {
    const status = await request(`/workflows/${id}/publication-status`);
    if (!status || !['in_progress', 'not_published', 'published', 'partial', 'failed'].includes(status.status)
      || !(status.liveVersionId === null || safeId(status.liveVersionId)) || !(status.pendingVersionId === null || safeId(status.pendingVersionId))
      || !Array.isArray(status.triggers) || new Set(status.triggers.map((row) => row?.nodeId)).size !== status.triggers.length
      || status.triggers.some((row) => !safeId(row?.nodeId) || !['activated', 'failed'].includes(row.status) || !(row.errorMessage === null || typeof row.errorMessage === 'string'))) fail('Managed publication trigger metadata is invalid.');
    return status;
  }

  async function schedulesPaused(request, outbox, expected) {
    if ((await activeIds(request)).some((id) => ids.includes(id))) fail('Managed notification schedules are not paused.');
    if (!outbox) return true;
    let settled = true;
    for (const workflow of expected) {
      const current = publication(await request(`/workflows/${workflow.id}`));
      if (current.active || current.activeVersionId !== null || current.versionId !== workflow.versionId) fail('Managed notification publication changed during maintenance.');
      const status = await triggerStatus(request, workflow.id);
      if (status.status === 'in_progress') { settled = false; continue; }
      if (status.status !== 'not_published' || status.liveVersionId !== null || status.pendingVersionId !== null || status.triggers.length !== 0) fail('Managed notification trigger teardown could not be verified.');
      const error = await request(`/active-workflows/error/${workflow.id}`);
      if (error !== null) {
        if (typeof error !== 'string') fail('Managed activation metadata is invalid.');
        settled = false;
      }
    }
    return settled;
  }

  async function untilSettled(check, message) {
    const deadline = now() + timeoutMs;
    for (;;) {
      if (await check()) return;
      if (now() >= deadline) fail(message);
      await wait(Math.min(pollMs, deadline - now()));
    }
  }

  return Object.freeze({
    async quiesce(expectedWorkflows) {
      let deactivatedCount = 0, paused = false;
      try {
        if (!Array.isArray(expectedWorkflows)) fail('Exactly five known StockFlow notification IDs are required.');
        exactIds(expectedWorkflows.map((workflow) => workflow?.id));
        const expected = expectedWorkflows.map(publication);
        const { request, outbox } = await authenticate();
        // Validate every version before the first mutation, then recheck each immediately before it.
        for (const workflow of expected) {
          const current = await request(`/workflows/${workflow.id}`);
          sameVersion(workflow, current); checksumAvailable(current);
          if (outbox) await triggerStatus(request, workflow.id); // Require the supported daemon-status route before mutating.
        }
        for (const workflow of expected) {
          const current = await request(`/workflows/${workflow.id}`);
          sameVersion(workflow, current);
          if (!current.active) continue;
          checksumAvailable(current);
          const result = await request(`/workflows/${workflow.id}/deactivate`, 'POST', { expectedChecksum: current.checksum });
          const state = publication(result);
          if (state.id !== workflow.id || state.versionId !== workflow.versionId || state.active || state.activeVersionId !== null) fail('Managed schedule deactivation could not be verified.');
          deactivatedCount++;
        }
        // In 2.43.6, settled empty trigger rows are recorded only AFTER daemon teardown.
        // See n8n@2.43.6 workflow-publication-applier.ts and publication-status-reporter.ts.
        await untilSettled(() => schedulesPaused(request, outbox, expected), 'Managed notification trigger teardown did not settle in time. Pause state is unverified; no executions were stopped.');
        paused = true;
        const deadline = now() + timeoutMs;
        for (;;) {
          paused = false;
          if (!await schedulesPaused(request, outbox, expected)) fail('Managed notification publication changed during drain.');
          paused = true;
          let pending = 0;
          for (const id of ids) {
            const filter = JSON.stringify({ workflowId: id, status: ['new', 'running', 'waiting', 'unknown'] });
            const data = await request(`/executions?${new URLSearchParams({ filter, limit: '1' })}`);
            if (!data || !Array.isArray(data.results) || data.results.length > 1 || !Number.isSafeInteger(data.count) || data.count < data.results.length || data.estimated !== false
              || data.results.some((run) => run.workflowId !== id || !['new', 'running', 'waiting', 'unknown'].includes(run.status))
              || (data.count === 0 && data.nextCursor !== null)) fail('Managed execution drain metadata is invalid.');
            pending += data.count;
          }
          if (pending === 0) {
            paused = false;
            if (!await schedulesPaused(request, outbox, expected)) fail('Managed notification schedules changed during drain.');
            paused = true;
            return { quiesced: true, deactivatedCount, drained: true };
          }
          if (now() >= deadline) fail('Managed notification executions did not drain in time. Schedules remain paused; no executions were stopped.');
          await wait(Math.min(pollMs, deadline - now()));
        }
      } catch (error) {
        const failure = new MaintenanceError(error instanceof MaintenanceError ? error.message : 'Local notification maintenance failed. Sensitive local data was withheld.');
        failure.paused = paused; failure.deactivatedCount = deactivatedCount;
        throw failure;
      }
    },
    async verifyActive(expectedIDs) {
      try {
        exactIds(expectedIDs);
        const { request, outbox } = await authenticate();
        await untilSettled(async () => {
          const active = await activeIds(request); let settled = true;
          for (const id of ids) {
            const workflow = publication(await request(`/workflows/${id}`));
            if (!active.includes(id) || !workflow.active || !workflow.activeVersionId || workflow.activeVersionId !== workflow.versionId) fail('Managed workflow publication or activation could not be verified.');
            if (outbox) {
              const status = await triggerStatus(request, id);
              if (status.status === 'in_progress') { settled = false; continue; }
              if (status.status !== 'published' || status.liveVersionId !== workflow.activeVersionId || status.pendingVersionId !== null
                || status.triggers.length !== triggerIds.length || triggerIds.some((nodeId) => !status.triggers.some((row) => row.nodeId === nodeId && row.status === 'activated' && row.errorMessage === null))) fail('Managed daemon trigger activation could not be verified.');
            }
            if (await request(`/active-workflows/error/${id}`) !== null) fail('A managed notification workflow has an activation error. Sensitive error data was withheld.');
          }
          return settled;
        }, 'Managed notification trigger activation did not settle in time.');
        return { activeCount: ids.length, activationErrors: 0 };
      } catch (error) {
        throw new MaintenanceError(error instanceof MaintenanceError ? error.message : 'Local notification activation verification failed. Sensitive local data was withheld.');
      }
    },
  });
}
