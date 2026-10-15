// These are isolated fixture-contract tests, not PostgreSQL bootstrap verification.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import http from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runDemoSeed } from './seed-demo-catalog.mjs';
import { profiles, products, photos } from './data/demo-catalog.mjs';

const adminEmail = 'fixture-admin@example.test';
const adminPassword = 'fixture-admin-password';
const hash = (password) => createHash('sha256').update(password).digest('hex');
const marker = { isolatedDemo: true, containerName: 'stockflow-db', containerId: 'fixture-owned-id', databaseUrl: 'postgresql://stockflow:fixture-password@localhost:55432/stock_management?schema=public', jwtSecret: 'x'.repeat(48), initialized: true };
const ownedContainer = { Id: marker.containerId, Config: { Image: 'postgres:16-alpine', Env: ['POSTGRES_USER=stockflow', 'POSTGRES_DB=stock_management', 'POSTGRES_PASSWORD=fixture-password'] }, HostConfig: { PortBindings: { '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: '55432' }] } }, Mounts: [{ Destination: '/var/lib/postgresql/data', Type: 'volume', Name: 'stockflow_demo_pgdata' }] };
const publicUser = ({ passwordHash, ...user }) => user;
const response = (data, status = 200) => new Response(JSON.stringify(status >= 400 ? { message: 'REMOTE_PRIVATE_MESSAGE', data } : { success: true, data }), { status, headers: { 'Content-Type': 'application/json' } });

async function fixture(t) {
  const prefix = path.join(tmpdir(), 'stockflow-seed-');
  const directory = await mkdtemp(prefix);
  const localDirectory = path.join(directory, 'local');
  await mkdir(localDirectory);
  await writeFile(path.join(localDirectory, 'runtime.json'), JSON.stringify(marker));
  t.after(async () => { assert.ok(directory.startsWith(prefix)); await rm(directory, { recursive: true, force: true }); });
  const state = {
    users: new Map([[adminEmail, { id: 1, name: 'Fixture admin', email: adminEmail, role: 'ADMIN', passwordHash: hash(adminPassword) }]]),
    suppliers: [], products: [], orders: [{ id: 1, customerId: 900, status: 'PENDING', totalAmount: 12.50 }],
    categories: [...new Set(products.map((product) => product.category))].map((name, index) => ({ id: index + 1, name })),
    calls: [], dbWrites: 0, factories: 0, inspections: 0, disconnects: 0,
  };
  const credentials = async () => JSON.parse(await readFile(path.join(localDirectory, 'demo-accounts.json'), 'utf8'));
  const prisma = {
    user: { findUnique: async ({ where }) => {
      const user = [...state.users.values()].find((entry) => entry.id === where.id);
      return state.transformDBUser ? state.transformDBUser(user && publicUser(user)) : user && publicUser(user);
    } },
    supplier: {
      findUnique: async ({ where }) => state.suppliers.find((supplier) => supplier.userId === where.userId) || null,
      create: async ({ data }) => { state.dbWrites++; const supplier = { id: state.suppliers.length + 1, ...data }; state.suppliers.push(supplier); return supplier; },
    },
    $disconnect: async () => { state.disconnects++; },
  };
  const fetchImpl = async (url, options) => {
    assert.equal(options.redirect, 'error');
    assert.equal(new URL(url).hostname, '127.0.0.1');
    const endpoint = new URL(url).pathname;
    const method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : undefined;
    state.calls.push(`${method} ${endpoint}`);
    if (state.intercept) { const intercepted = await state.intercept({ endpoint, method, body }); if (intercepted) return intercepted; }
    if (endpoint === '/api/health') return response({ success: true });
    if (endpoint === '/api/auth/login') {
      const user = state.users.get(body.email);
      if (!user || user.passwordHash !== hash(body.password)) return response(null, 401);
      return response({ token: 'fixture-admin-token', user: publicUser(user) });
    }
    assert.equal(options.headers.Authorization, 'Bearer fixture-admin-token');
    if (endpoint === '/api/auth/register' && method === 'POST') {
      // Registration must never precede a complete, saved local credential.
      assert.equal((await credentials()).accounts[body.email].password, body.password);
      if (state.users.has(body.email)) return response(null, 409);
      const { password, ...fields } = body;
      const user = { id: state.users.size + 1, ...fields, passwordHash: hash(password) };
      state.users.set(user.email, user);
      if (state.loseRegistrationResponse) { state.loseRegistrationResponse = false; throw new Error('PRIVATE_TRANSPORT_DETAILS'); }
      return response(publicUser(user), 201);
    }
    if (endpoint === '/api/discovery/categories') return response(state.categories);
    if (endpoint === '/api/discovery/suppliers') return response(state.suppliers.map((supplier) => ({ ...supplier, user: publicUser([...state.users.values()].find((user) => user.id === supplier.userId)) })));
    if (endpoint === '/api/products' && method === 'GET') return response(state.products);
    if (endpoint === '/api/products' && method === 'POST') {
      if (state.failProductAt === state.products.length) throw new Error('PRIVATE_PRODUCT_TRANSPORT_DETAILS');
      assert.ok(state.categories.some((category) => category.id === body.categoryId));
      assert.ok(state.suppliers.some((supplier) => supplier.id === body.supplierId));
      assert.equal(state.products.some((product) => product.sku === body.sku), false);
      const product = { id: state.products.length + 1, ...body }; state.products.push(product); return response(product, 201);
    }
    assert.fail(`Unexpected fixture operation: ${method} ${endpoint}`);
  };
  const options = {
    localDirectory, apply: true, localSupplierProfiles: true, adminEmail, adminPassword, fetchImpl,
    inspectContainer: async (name) => { state.inspections++; assert.equal(name, 'stockflow-db'); return structuredClone(ownedContainer); },
    prismaFactory: async (url) => { state.factories++; assert.equal(url, marker.databaseUrl); return prisma; },
  };
  return { directory, localDirectory, options, state, credentials, writeMarker: (value) => writeFile(path.join(localDirectory, 'runtime.json'), JSON.stringify(value)) };
}

test('catalog fixtures resolve every fictional profile, supplier, category and credited photo', () => {
  assert.equal(profiles.length, 8); assert.equal(products.length, 40);
  assert.equal(new Set(profiles.map((profile) => profile.email)).size, 8);
  assert.equal(new Set(products.map((product) => product.sku)).size, 40);
  for (const profile of profiles) assert.ok(profile.email.endsWith('@stockflow.example.test'));
  for (const product of products) {
    assert.ok(profiles.some((profile) => profile.key === product.supplierKey && profile.role === 'SUPPLIER'));
    assert.ok(product.category);
    const photo = photos[product.photoKey];
    for (const field of ['src', 'creditUrl', 'licenseUrl']) assert.equal(new URL(photo[field]).protocol, 'https:');
    assert.ok(photo.alt && photo.creditName);
  }
});

test('dry-run does not inspect files, create directories, call HTTP, inspect Docker or instantiate Prisma', async (t) => {
  const f = await fixture(t);
  const localDirectory = path.join(f.directory, 'not-created');
  const forbidden = () => assert.fail('Dry-run invoked a side effect');
  const result = await runDemoSeed({ ...f.options, localDirectory, apply: false, fetchImpl: forbidden, inspectContainer: forbidden, prismaFactory: forbidden });
  assert.deepEqual(result, { dryRun: true, demoProfiles: 8, demoProducts: 40 });
  await assert.rejects(access(localDirectory), { code: 'ENOENT' });
});

test('first run creates eight accounts, four supplier records and forty products; rerun preserves all existing data', async (t) => {
  const f = await fixture(t);
  const first = await runDemoSeed(f.options);
  assert.equal(first.createdProfiles, 8); assert.equal(first.createdProducts, 40); assert.equal(first.demoProducts, 40);
  assert.equal(f.state.suppliers.length, 4); assert.equal(f.state.dbWrites, 4);
  const accounts = await f.credentials();
  f.state.products[0].price = 987.65; f.state.products[0].quantity = 3;
  const before = JSON.stringify({ users: [...f.state.users], suppliers: f.state.suppliers, products: f.state.products, orders: f.state.orders });
  const second = await runDemoSeed(f.options);
  assert.equal(second.createdProfiles, 0); assert.equal(second.createdProducts, 0);
  assert.equal(JSON.stringify({ users: [...f.state.users], suppliers: f.state.suppliers, products: f.state.products, orders: f.state.orders }), before);
  assert.deepEqual(await f.credentials(), accounts);
  assert.equal(f.state.dbWrites, 4); assert.equal(f.state.disconnects, 2);
  assert.equal(f.state.calls.filter((call) => call === 'POST /api/products').length, 40);
  assert.ok(f.state.calls.every((call) => !/PATCH|PUT|DELETE|orders|stock|reset|ai|email/.test(call)));
  assert.deepEqual((await readdir(f.localDirectory)).filter((name) => name.endsWith('.tmp')), []);
});

test('registration committed before a lost response resumes with its previously saved password', async (t) => {
  const f = await fixture(t); f.state.loseRegistrationResponse = true;
  await assert.rejects(runDemoSeed(f.options), /local API request failed or redirected/);
  await assert.rejects(access(path.join(f.localDirectory, 'demo-seed.lock')), { code: 'ENOENT' });
  assert.equal(f.state.users.size, 2); assert.equal(f.state.suppliers.length, 0);
  const before = f.state.users.get(profiles[0].email).passwordHash;
  const saved = (await f.credentials()).accounts[profiles[0].email];
  assert.equal(hash(saved.password), before); assert.equal(saved.id, undefined);
  const result = await runDemoSeed(f.options);
  assert.equal(result.createdProfiles, 7); assert.equal(result.createdProducts, 40);
  assert.equal(f.state.users.get(profiles[0].email).passwordHash, before);
  assert.equal((await f.credentials()).accounts[profiles[0].email].password, saved.password);
  assert.equal(f.state.disconnects, 2);
});

test('concurrent apply refuses a held lock, preserves its owner, and keeps rerun credentials stable', async (t) => {
  const f = await fixture(t);
  let unblock;
  let entered;
  const held = new Promise((resolve) => { unblock = resolve; });
  const started = new Promise((resolve) => { entered = resolve; });
  f.state.intercept = async ({ endpoint }) => { if (endpoint === '/api/health') { entered(); await held; } };
  const first = runDemoSeed(f.options);
  try {
    await started;
    const filename = path.join(f.localDirectory, 'demo-seed.lock');
    const owner = await readFile(filename, 'utf8');
    await assert.rejects(runDemoSeed(f.options), /Verify no seed process is running/);
    assert.equal(await readFile(filename, 'utf8'), owner);
    assert.equal(f.state.calls.length, 1); assert.equal(f.state.users.size, 1); assert.equal(f.state.dbWrites, 0);
    unblock();
    assert.equal((await first).createdProfiles, 8);
    await assert.rejects(access(filename), { code: 'ENOENT' });
    const before = await f.credentials();
    const repeated = await runDemoSeed(f.options);
    assert.equal(repeated.createdProfiles, 0); assert.equal(repeated.createdProducts, 0);
    assert.deepEqual(await f.credentials(), before);
    await writeFile(filename, 'stale-or-foreign-owner');
    await assert.rejects(runDemoSeed(f.options), /remove demo-seed.lock manually/);
    assert.equal(await readFile(filename, 'utf8'), 'stale-or-foreign-owner');
  } finally { unblock(); await first; }
});

test('interrupted product creation resumes only missing SKUs', async (t) => {
  const f = await fixture(t); f.state.failProductAt = 13;
  await assert.rejects(runDemoSeed(f.options), /local API request failed/);
  assert.equal(f.state.products.length, 13);
  f.state.products[0].quantity = 2; f.state.products[0].price = 1.23;
  const before = structuredClone(f.state.products);
  f.state.failProductAt = undefined;
  const result = await runDemoSeed(f.options);
  assert.equal(result.createdProfiles, 0); assert.equal(result.createdProducts, 27);
  assert.deepEqual(f.state.products.slice(0, 13), before);
  assert.equal(f.state.suppliers.length, 4);
});

test('missing account metadata fails without password reset, role mutation or supplier/product writes', async (t) => {
  const f = await fixture(t);
  f.state.users.set(profiles[0].email, { id: 2, name: profiles[0].name, email: profiles[0].email, role: 'SUPPLIER', passwordHash: hash('unknown-fixture-password') });
  const before = structuredClone([...f.state.users]);
  await assert.rejects(runDemoSeed(f.options), /no saved local credential/);
  assert.deepEqual([...f.state.users], before);
  assert.equal(f.state.dbWrites, 0); assert.equal(f.state.products.length, 0);
  assert.equal(f.state.calls.filter((call) => call === 'POST /api/auth/login').length, 1);
});

test('runtime and container guards reject invalid targets before HTTP, Prisma or database writes', async (t) => {
  const f = await fixture(t);
  for (const runtime of [null, { ...marker, initialized: false }, { ...marker, containerId: undefined }, { ...marker, databaseUrl: marker.databaseUrl.replace('localhost', 'remote.example.test') }, { ...marker, databaseUrl: marker.databaseUrl.replace('stockflow:', 'other:') }]) {
    await f.writeMarker(runtime);
    await assert.rejects(runDemoSeed(f.options));
  }
  await f.writeMarker(marker);
  await assert.rejects(runDemoSeed({ ...f.options, inspectContainer: async () => ({ ...ownedContainer, Id: 'another-container' }) }));
  await assert.rejects(runDemoSeed({ ...f.options, inspectContainer: async () => ({ ...ownedContainer, Mounts: [] }) }));
  for (const apiBase of ['https://remote.example.test/api', 'http://localhost.evil.example.test/api', 'ftp://localhost/api', 'http://user:secret@localhost/api']) await assert.rejects(runDemoSeed({ ...f.options, apiBase }));
  assert.equal(f.state.calls.length, 0); assert.equal(f.state.factories, 0); assert.equal(f.state.dbWrites, 0);
});

test('API and database admin identity guards stop before supplier/product writes', async (t) => {
  for (const changed of [{ role: 'CUSTOMER' }, { email: 'another-admin@example.test' }, { id: 0 }]) {
    const f = await fixture(t);
    f.state.intercept = ({ endpoint }) => endpoint === '/api/auth/login' && response({ token: 'fixture-admin-token', user: { id: 1, email: adminEmail, role: 'ADMIN', ...changed } });
    await assert.rejects(runDemoSeed(f.options), /matching local ADMIN/);
    assert.equal(f.state.factories, 0); assert.equal(f.state.dbWrites, 0);
    assert.equal(f.state.users.size, 1);
  }
  const f = await fixture(t);
  f.state.transformDBUser = (user) => ({ ...user, email: 'different-db-admin@example.test' });
  await assert.rejects(runDemoSeed(f.options), /does not match API admin identity/);
  assert.equal(f.state.users.size, 1); assert.equal(f.state.dbWrites, 0); assert.equal(f.state.disconnects, 1);
});

test('existing user and database supplier identity mismatches stop without supplier/product writes', async (t) => {
  for (const field of ['name', 'email', 'role']) {
    const f = await fixture(t); f.state.loseRegistrationResponse = true;
    await assert.rejects(runDemoSeed(f.options));
    f.state.users.get(profiles[0].email)[field] = field === 'role' ? 'ADMIN' : 'mismatched';
    await assert.rejects(runDemoSeed(f.options), /does not match intended demo profile/);
    assert.equal(f.state.dbWrites, 0); assert.equal(f.state.products.length, 0);
  }
  const f = await fixture(t);
  f.state.transformDBUser = (user) => user?.role === 'SUPPLIER' ? { ...user, email: 'real-user@example.test' } : user;
  await assert.rejects(runDemoSeed(f.options), /matching fictional demo users/);
  assert.equal(f.state.dbWrites, 0); assert.equal(f.state.products.length, 0);
});

test('missing category prevents every product write; remote response text is excluded from errors', async (t) => {
  const f = await fixture(t); f.state.categories = [];
  await assert.rejects(runDemoSeed(f.options), /Required existing category is missing/);
  assert.equal(f.state.products.length, 0);
  assert.equal(f.state.calls.includes('POST /api/products'), false);
  const denied = await fixture(t);
  denied.state.intercept = ({ endpoint }) => endpoint === '/api/auth/register' && response(null, 503);
  await assert.rejects(runDemoSeed(denied.options), (error) => error.message === 'POST /auth/register: HTTP 503');
  assert.equal(denied.state.dbWrites, 0); assert.equal(denied.state.calls.filter((call) => call === 'POST /api/auth/login').length, 1);
});

test('actual fetch rejects a fixture HTTP redirect without contacting its target or using Prisma', async (t) => {
  const f = await fixture(t);
  let targetRequests = 0;
  const target = http.createServer((req, res) => { targetRequests++; res.end('{}'); });
  await new Promise((resolve) => target.listen(0, '127.0.0.1', resolve));
  const redirect = http.createServer((req, res) => { res.writeHead(302, { Location: `http://127.0.0.1:${target.address().port}/escaped` }); res.end(); });
  await new Promise((resolve) => redirect.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    for (const server of [redirect, target]) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
  });
  await assert.rejects(runDemoSeed({ ...f.options, apiBase: `http://127.0.0.1:${redirect.address().port}/api`, fetchImpl: fetch }), /failed or redirected/);
  assert.equal(targetRequests, 0); assert.equal(f.state.factories, 0); assert.equal(f.state.dbWrites, 0);
});
