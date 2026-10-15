import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertLocalN8n, localDirectory } from './local-n8n.mjs';

const ORIGIN = 'http://localhost:5678';
const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const HTTP_FAILURE = Symbol('localN8nHttpFailure');
const ISSUE_CODES = new Set(['missing_required', 'missing_credential', 'invalid_credential', 'incompatible_credential', 'invalid_value', 'missing_reference', 'incompatible_reference']);
const ISSUE_FIELDS = new Set(['agent', 'name', 'description', 'instructions', 'model', 'modelDeploymentName', 'credential', 'memory', 'enabled', 'storage', 'config', 'reasoning', 'promptCaching', 'webSearch', 'toolCallConcurrency', 'maxIterations', 'guardrails', 'budget', 'monthlyBudgetUsd', 'sessionCostCapUsd', 'alertThresholdPercent', 'tools', 'type', 'id', 'workflow', 'workflowId', 'node', 'nodeType', 'nodeTypeVersion', 'nodeParameters', 'credentials', 'skills', 'tasks', 'integrations', 'credentialId', 'mcpServers', 'vectorStores', 'subAgents', 'agents', 'agentId', 'url']);

/** Read only the private owner section; never include its contents in an error. */
export function parseOwnerLogin(markdown) {
  if (typeof markdown !== 'string') throw new Error('The private n8n owner login is unavailable.');
  const matches = [...markdown.matchAll(/^##[ \t]+n8n owner[ \t]*\r?$/gm)];
  if (matches.length !== 1) throw new Error('The private n8n owner login is unavailable.');
  const following = markdown.slice(matches[0].index + matches[0][0].length);
  const section = following.split(/^#{1,2}[ \t]+/m)[0];
  const readField = (label) => [...section.matchAll(new RegExp(`^- ${label}:[ \\t]*\x60([^\x60\\r\\n]+)\x60[ \\t]*\\r?$`, 'gm'))];
  const emails = readField('Email');
  const passwords = readField('Password');
  if (emails.length !== 1 || passwords.length !== 1 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emails[0][1]) || !passwords[0][1].trim()) {
    throw new Error('The private n8n owner login is unavailable.');
  }
  return { emailOrLdapLoginId: emails[0][1], password: passwords[0][1] };
}

export function parseSSE(text) {
  if (typeof text !== 'string') throw new Error('Invalid n8n event stream.');
  const events = [];
  for (const block of text.replace(/\r\n/g, '\n').split('\n\n')) {
    const data = block.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).replace(/^ /, '')).join('\n');
    if (!data || data === '[DONE]') continue;
    try { events.push(JSON.parse(data)); } catch { throw new Error('Invalid n8n event stream.'); }
  }
  return events;
}

function projectBase(projectId) {
  if (typeof projectId !== 'string' || !SAFE_ID.test(projectId) || projectId.length > 64) throw new Error('Invalid n8n project ID.');
  return `${ORIGIN}/rest/projects/${projectId}/agents/v2`;
}

function requestUrl(base, relativePath, query) {
  if (typeof relativePath !== 'string' || relativePath.length > 1024 || (relativePath !== '' && (!relativePath.startsWith('/') || !relativePath.slice(1).split('/').every((segment) => SAFE_ID.test(segment))))) {
    throw new Error('Invalid relative n8n agent path.');
  }
  const url = new URL(`${base}${relativePath}`);
  if (query !== undefined) {
    if (!query || typeof query !== 'object' || Array.isArray(query) || Object.getPrototypeOf(query) !== Object.prototype) throw new Error('Invalid n8n query parameters.');
    for (const [key, value] of Object.entries(query)) {
      if (!/^[A-Za-z][A-Za-z0-9]{0,39}$/.test(key) || !['string', 'number', 'boolean'].includes(typeof value) || (typeof value === 'number' && !Number.isFinite(value)) || String(value).length > 2048 || /[\x00-\x1f\x7f]/.test(String(value))) {
        throw new Error('Invalid n8n query parameters.');
      }
      url.searchParams.set(key, String(value));
    }
  }
  return url.href;
}

function safeIssues(value) {
  const issues = Array.isArray(value?.issues) ? value.issues : Array.isArray(value?.data?.issues) ? value.data.issues : [];
  return issues.slice(0, 30).flatMap((issue) => {
    if (!ISSUE_CODES.has(issue?.code)) return [];
    const segments = typeof issue.path === 'string' ? issue.path.split('.') : Array.isArray(issue.path) ? issue.path.map(String) : [];
    const safePath = segments.length > 0 && segments.length <= 12 && segments.every((segment) => ISSUE_FIELDS.has(segment) || /^\d{1,3}$/.test(segment));
    return [{ code: issue.code, ...(safePath ? { path: segments.join('.') } : {}) }];
  });
}

function httpError(status, value) {
  const error = new Error(`Local n8n request failed (HTTP ${status}).`);
  error[HTTP_FAILURE] = true;
  error.status = status;
  const issues = safeIssues(value);
  if (issues.length) error.issues = issues;
  return error;
}

async function readResponse(response, maximumBytes) {
  if (!response.body?.getReader) {
    const text = await response.text();
    if (Buffer.byteLength(text) > maximumBytes) throw new Error('Local n8n response exceeded the size limit.');
    return text;
  }
  const reader = response.body.getReader();
  const parts = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximumBytes) {
        await reader.cancel();
        throw new Error('Local n8n response exceeded the size limit.');
      }
      parts.push(Buffer.from(value));
    }
    return Buffer.concat(parts).toString('utf8');
  } finally { reader.releaseLock(); }
}

function extractAuthCookie(headers) {
  const values = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [headers.get('set-cookie') || ''];
  const cookies = values.flatMap((value) => [...value.matchAll(/(?:^|,\s*)n8n-auth=([A-Za-z0-9._~-]{1,8192})(?=;|,|$)/g)].map((match) => `n8n-auth=${match[1]}`));
  if (cookies.length !== 1) throw new Error('Local n8n did not issue an authenticated session.');
  return cookies[0];
}

/** Dependency-injected transport for offline tests. Session credentials remain in this closure. */
export async function createAuthenticatedAgentApi({ projectId, ownerLogin, fetchImpl = globalThis.fetch, browserId = randomUUID() }) {
  const base = projectBase(projectId);
  if (typeof fetchImpl !== 'function' || typeof browserId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(browserId) || !ownerLogin || typeof ownerLogin.emailOrLdapLoginId !== 'string' || typeof ownerLogin.password !== 'string' || !ownerLogin.password) {
    throw new Error('Invalid local n8n authentication configuration.');
  }
  let cookie;
  async function transport(url, method, body, { stream = false, timeoutMs = 30000 } = {}, login = false) {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000 || typeof stream !== 'boolean') throw new Error('Invalid n8n request options.');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let serialized;
    try {
      if (body !== undefined) {
        serialized = JSON.stringify(body);
        if (serialized === undefined) throw new Error('Invalid body.');
      }
    } catch { clearTimeout(timeout); throw new Error('Invalid local n8n request body.'); }
    try {
      const response = await fetchImpl(url, {
        method,
        headers: { 'content-type': 'application/json', accept: stream ? 'text/event-stream' : 'application/json', 'browser-id': browserId, ...(cookie ? { cookie } : {}) },
        body: serialized,
        redirect: 'error',
        credentials: 'omit',
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!Number.isInteger(response.status)) throw new Error('Invalid response.');
      const raw = await readResponse(response, stream ? 4 * 1024 * 1024 : 2 * 1024 * 1024);
      let parsed;
      if (!stream || !response.ok) { try { parsed = raw ? JSON.parse(raw) : undefined; } catch { /* Never expose a server response in an error. */ } }
      if (!response.ok || response.status >= 300) throw httpError(response.status, parsed);
      if (login) cookie = extractAuthCookie(response.headers);
      if (stream) {
        if (!/^text\/event-stream(?:;|$)/i.test(response.headers.get('content-type') || '')) throw new Error('Local n8n returned an invalid event stream.');
        return raw;
      }
      if (response.status === 204 || !raw) return undefined;
      if (parsed === undefined) throw new Error('Local n8n returned an invalid JSON response.');
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Object.keys(parsed).length === 1 && Object.hasOwn(parsed, 'data') ? parsed.data : parsed;
    } catch (error) {
      if (error?.[HTTP_FAILURE] === true) throw error;
      if (error?.message === 'Local n8n returned an invalid JSON response.' || error?.message === 'Local n8n returned an invalid event stream.' || error?.message === 'Local n8n did not issue an authenticated session.' || error?.message === 'Local n8n response exceeded the size limit.') throw error;
      throw new Error(controller.signal.aborted ? 'Local n8n request timed out.' : 'Local n8n request could not be completed.');
    } finally { clearTimeout(timeout); }
  }
  await transport(`${ORIGIN}/rest/login`, 'POST', { emailOrLdapLoginId: ownerLogin.emailOrLdapLoginId, password: ownerLogin.password }, undefined, true);
  return Object.freeze({
    async request(method, relativePath = '', body, options = {}) {
      if (!METHODS.has(method) || (method === 'GET' && body !== undefined)) throw new Error('Invalid n8n request method or body.');
      if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some((key) => !['query', 'stream', 'timeoutMs'].includes(key))) throw new Error('Invalid n8n request options.');
      const url = requestUrl(base, relativePath, options.query);
      const defaultTimeout = /\/(?:n8n-chat|chat)$/.test(relativePath) ? 60000 : 30000;
      return await transport(url, method, body, { ...options, timeoutMs: options.timeoutMs ?? defaultTimeout });
    },
  });
}

/** Production entry point: verify this project's container before loading private owner credentials. */
export async function createN8nAgentApi({ projectId }) {
  projectBase(projectId);
  assertLocalN8n();
  let markdown;
  try { markdown = await readFile(path.join(localDirectory, 'LOGIN-ACCOUNTS.md'), 'utf8'); } catch { throw new Error('The private n8n owner login is unavailable.'); }
  return await createAuthenticatedAgentApi({ projectId, ownerLogin: parseOwnerLogin(markdown) });
}
