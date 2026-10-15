import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuthenticatedAgentApi, parseOwnerLogin, parseSSE } from './n8n-agent-api.mjs';

const ownerLogin = { emailOrLdapLoginId: 'owner@example.test', password: 'OfflinePrivatePassword' };
const projectId = 'StockFlowProject01';
const cookie = 'n8n-auth=OfflineSessionToken.test.signature';
const loginResponse = () => new Response(JSON.stringify({ data: { id: 'Owner01' } }), { headers: { 'set-cookie': `${cookie}; Path=/; HttpOnly; SameSite=Lax`, 'content-type': 'application/json' } });
const setup = async (handler = () => new Response(JSON.stringify({ data: { ok: true } }))) => {
  const calls = [];
  const fetchImpl = async (url, options) => { calls.push({ url, options }); return calls.length === 1 ? loginResponse() : await handler(url, options); };
  return { calls, api: await createAuthenticatedAgentApi({ projectId, ownerLogin, fetchImpl, browserId: 'OfflineBrowser01' }) };
};

test('private Markdown parser reads only the unique n8n owner section', () => {
  const markdown = '## Supplier\n- Email: `other@example.test`\n- Password: `OtherPassword`\n\n## n8n owner\r\n- Email: `owner@example.test`\r\n- Password:`OfflinePrivatePassword`\r\n\n## Later\n- Password: `OtherPassword`\n';
  assert.deepEqual(parseOwnerLogin(markdown), ownerLogin);
  for (const value of [null, '', markdown.replace('## n8n owner', '### n8n owner'), `${markdown}\n## n8n owner\n`, markdown.replace('owner@example.test', 'invalid'), markdown.replace('OfflinePrivatePassword', ' '), markdown.replace('## Later', '- Email: `duplicate@example.test`\n## Later')]) {
    assert.throws(() => parseOwnerLogin(value), (error) => !error.message.includes('Password') && !error.message.includes('Offline') && /unavailable/.test(error.message));
  }
});

test('login and all subsequent calls stay local and bind the cookie to the same browser ID', async () => {
  const { api, calls } = await setup();
  assert.deepEqual(await api.request('GET', '/Agent01/config'), { ok: true });
  assert.equal(calls[0].url, 'http://localhost:5678/rest/login');
  assert.deepEqual(JSON.parse(calls[0].options.body), ownerLogin);
  assert.equal(calls[0].options.headers.cookie, undefined);
  assert.equal(calls[1].url, `http://localhost:5678/rest/projects/${projectId}/agents/v2/Agent01/config`);
  assert.equal(calls[1].options.headers.cookie, cookie);
  for (const { options } of calls) {
    assert.equal(options.headers['browser-id'], 'OfflineBrowser01');
    assert.equal(options.redirect, 'error');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.cache, 'no-store');
  }
  assert.deepEqual(Object.keys(api), ['request']);
  assert.doesNotMatch(JSON.stringify(api), /Offline|cookie|password/);
});

test('path and method validation rejects external URLs, traversal, queries, fragments and control characters before fetch', async () => {
  const { api, calls } = await setup();
  for (const value of ['http://evil.example', '//evil.example', '/Agent/../config', '/Agent/%2e%2e/config', '/Agent/config?secret=abc', '/Agent/config#fragment', '/Agent\\config', '/Agent//config', '/Agent/config/', '/', '/Agent\r\nsecret', null]) {
    await assert.rejects(api.request('GET', value), /Invalid relative/);
  }
  await assert.rejects(api.request('TRACE', '/Agent/config'), /Invalid n8n request method/);
  await assert.rejects(api.request('GET', '/Agent/config', { secret: true }), /Invalid n8n request method/);
  await assert.rejects(api.request('GET', '/Agent/config', undefined, { headers: { cookie: 'injected' } }), /Invalid n8n request options/);
  assert.equal(calls.length, 1);
  for (const value of ['../project', 'https://evil.example', '', null, 'x'.repeat(65)]) await assert.rejects(createAuthenticatedAgentApi({ projectId: value, ownerLogin, fetchImpl: () => assert.fail('must not fetch') }), /Invalid n8n project/);
});

test('query parameters encode as query data and cannot change the target origin or path', async () => {
  const { api, calls } = await setup();
  await api.request('GET', '/Agent01/threads', undefined, { query: { origin: 'schedule', limit: 5, cursor: 'https://evil.example/?x=y&z=q', previewOnly: false } });
  const url = new URL(calls[1].url);
  assert.equal(url.origin, 'http://localhost:5678');
  assert.equal(url.pathname, `/rest/projects/${projectId}/agents/v2/Agent01/threads`);
  assert.equal(url.searchParams.get('origin'), 'schedule');
  assert.equal(url.searchParams.get('cursor'), 'https://evil.example/?x=y&z=q');
  for (const query of [[], null, { 'bad-key': 'value' }, { cursor: 'line\nsecret' }, { limit: Infinity }, { filter: {} }, { cursor: 'x'.repeat(2049) }]) await assert.rejects(api.request('GET', '/Agent01/threads', undefined, { query }), /Invalid n8n query/);
});

test('JSON data envelopes unwrap while paginated responses retain their metadata and writes serialize exactly', async () => {
  let response = { data: [{ id: 'Agent01' }], count: 1 };
  const { api, calls } = await setup(() => new Response(JSON.stringify(response)));
  assert.deepEqual(await api.request('GET', ''), response);
  response = { data: { configHash: 'hash' } };
  const body = { config: { model: 'openai/gpt-5-mini' }, baseConfigHash: 'hash' };
  assert.deepEqual(await api.request('PUT', '/Agent01/config', body), { configHash: 'hash' });
  assert.deepEqual(JSON.parse(calls[2].options.body), body);
});

test('chat responses stay in memory as SSE and parser supports comments, CRLF and multiline data', async () => {
  const raw = ':ok\r\n\r\ndata: {"type":"execution-started",\r\ndata: "sessionId":"session-01"}\r\n\r\ndata: {"type":"finish","finishReason":"stop"}\r\n\r\n';
  const { api, calls } = await setup(() => new Response(raw, { headers: { 'content-type': 'text/event-stream' } }));
  assert.equal(await api.request('POST', '/Agent01/n8n-chat', { message: 'Read scoped inventory.', newSession: true }, { stream: true }), raw);
  assert.equal(calls[1].options.headers.accept, 'text/event-stream');
  assert.deepEqual(parseSSE(raw), [{ type: 'execution-started', sessionId: 'session-01' }, { type: 'finish', finishReason: 'stop' }]);
  assert.deepEqual(parseSSE(':ping\n\ndata: [DONE]\n\n'), []);
  assert.throws(() => parseSSE('data: secret-invalid-json\n\n'), (error) => !error.message.includes('secret'));
});

test('HTTP errors expose only status and recognized structural validation codes and paths', async () => {
  const { api } = await setup(() => new Response(JSON.stringify({ message: ownerLogin.password, cookie, issues: [{ code: 'missing_required', path: 'instructions', value: ownerLogin.password }, { code: 'invalid_value', path: 'tools.0.workflowId' }, { code: 'invalid_value', path: `tools.${ownerLogin.password}` }, { code: ownerLogin.password, path: 'credential' }] }), { status: 422 }));
  await assert.rejects(api.request('PUT', '/Agent01/config', {}), (error) => {
    assert.equal(error.status, 422);
    assert.deepEqual(error.issues, [{ code: 'missing_required', path: 'instructions' }, { code: 'invalid_value', path: 'tools.0.workflowId' }, { code: 'invalid_value' }]);
    assert.doesNotMatch(`${error.message}${JSON.stringify(error)}`, /Offline|SessionToken|password|cookie/);
    return true;
  });
});

test('network, redirect, malformed JSON and missing-cookie failures never include remote or credential content', async () => {
  for (const fetchImpl of [async () => { throw Object.assign(new Error(`redirected to https://evil.example/${ownerLogin.password}`), { status: 500 }); }, async () => new Response(ownerLogin.password), async () => new Response(JSON.stringify({ data: {} }))]) {
    await assert.rejects(createAuthenticatedAgentApi({ projectId, ownerLogin, fetchImpl }), (error) => !/Offline|evil|http:|https:/.test(error.message));
  }
  const { api } = await setup(() => new Response(ownerLogin.password, { status: 500 }));
  await assert.rejects(api.request('GET', '/Agent01/config'), (error) => error.status === 500 && !error.message.includes(ownerLogin.password));
});

test('invalid event streams and unserializable request bodies fail without exposing their values', async () => {
  const { api } = await setup(() => new Response(JSON.stringify({ secret: ownerLogin.password }), { headers: { 'content-type': 'application/json' } }));
  await assert.rejects(api.request('POST', '/Agent01/chat', { message: 'Test.' }, { stream: true }), /invalid event stream/);
  for (const value of [() => ownerLogin.password, 1n, { toJSON() { throw new Error(ownerLogin.password); } }]) {
    await assert.rejects(api.request('PUT', '/Agent01/config', value), (error) => error.message === 'Invalid local n8n request body.');
  }
});

test('timeouts abort the request and response-size limits reject excessive data', async () => {
  const { api } = await setup(async (_url, options) => await new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error(ownerLogin.password)), { once: true })));
  await assert.rejects(api.request('GET', '/Agent01/config', undefined, { timeoutMs: 5 }), /timed out/);
  const { api: largeApi } = await setup(() => new Response('x'.repeat(2 * 1024 * 1024 + 1)));
  await assert.rejects(largeApi.request('GET', '/Agent01/config'), /size limit/);
  for (const timeoutMs of [0, -1, 120001, Infinity, '5']) await assert.rejects(largeApi.request('GET', '/Agent01/config', undefined, { timeoutMs }), /Invalid n8n request options/);
});
