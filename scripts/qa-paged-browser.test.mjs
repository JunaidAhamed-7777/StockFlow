import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { browserApiTarget, createBrowserBridge } from './qa-paged-browser.mjs';

test('browser bridge rejects remote or credential-bearing API destinations', () => {
  assert.equal(browserApiTarget('http://127.0.0.1:55419/api').port, '55419');
  for (const base of ['http://localhost:3001/api', 'https://127.0.0.1:55419/api', 'http://remote.invalid:3001/api',
    'http://user:secret@127.0.0.1:55419/api', 'http://127.0.0.1:55419/api?url=elsewhere', 'http://127.0.0.1:55419/']) assert.throws(() => browserApiTarget(base));
});

test('browser bridge keeps proxy queries, isolates failures and refuses unrelated routes/origins', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'stockflow-bridge-test-'));
  const seen = [];
  const upstream = http.createServer((req, res) => { seen.push(req.url); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ fixture: true, path: req.url })); });
  let bridge;
  try {
    await writeFile(path.join(directory, 'index.html'), '<h1>Isolated test build</h1>');
    await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
    bridge = await createBrowserBridge({ base: `http://127.0.0.1:${upstream.address().port}/api`, distRoot: directory });
    const page = await fetch(`${bridge.url}/customer/products`);
    assert.match(await page.text(), /Isolated test build/);
    const proxied = await fetch(`${bridge.url}/api/products?page=2&pageSize=12&search=last%20SKU`);
    assert.equal((await proxied.json()).path, '/api/products?page=2&pageSize=12&search=last%20SKU');
    assert.equal((await fetch(`${bridge.url}/api/ai/run`)).status, 404);
    assert.equal((await fetch(`${bridge.url}/api/products`, { headers: { origin: 'http://unrelated.invalid' } })).status, 403);
    assert.equal(seen.length, 1);
    await fetch(`${bridge.url}/__qa/product-availability?fail=true`, { method: 'POST' });
    assert.equal((await fetch(`${bridge.url}/api/products?page=1`)).status, 503);
    assert.equal(seen.length, 1);
    await fetch(`${bridge.url}/__qa/product-availability?fail=false`, { method: 'POST' });
    assert.equal((await fetch(`${bridge.url}/api/products?page=1`)).status, 200);
    assert.equal(bridge.report.failuresInjected, 1);
  } finally {
    if (bridge) { bridge.server.closeAllConnections(); await new Promise((resolve) => bridge.server.close(resolve)); }
    upstream.closeAllConnections(); await new Promise((resolve) => upstream.close(resolve));
    const resolved = path.resolve(directory);
    assert.ok(resolved.startsWith(`${path.resolve(tmpdir())}${path.sep}`) && path.basename(resolved).startsWith('stockflow-bridge-test-'));
    await rm(resolved, { recursive: true, force: true });
  }
});
