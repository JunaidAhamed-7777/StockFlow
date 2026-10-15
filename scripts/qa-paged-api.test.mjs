import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import vm from 'node:vm';
import path from 'node:path';
import { createPlan, isolatedEnvironment, isolatedClientSchema, verifyGeneratedClientSource,
  verifyLocalDockerEndpoint, verifyDisposableContainer, fixtureRows, assertPage, runCaptured, recoverOwnedContainer,
  validateSeedMessage, seedWorkerSource, createSeedWorkerClient, alignSeedSequences } from './qa-paged-api.mjs';

const plan = createPlan('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
const id = 'a'.repeat(64);
const password = 'ephemeral-unit-test-secret';
const validContainer = () => ({ Id: id, Name: `/${plan.name}`,
  Config: { Image: 'postgres:16-alpine', Labels: { [plan.label]: plan.token },
    Env: ['POSTGRES_USER=paged_qa', 'POSTGRES_DB=stockflow_paged_qa', `POSTGRES_PASSWORD=${password}`] },
  NetworkSettings: { Ports: { '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: '55321' }] } },
  Mounts: [{ Type: 'tmpfs', Destination: '/var/lib/postgresql/data' }] });

test('a plan is inert, unique and strictly identifies the disposable namespace', () => {
  assert.match(createPlan().name, /^stockflow-qa-page-[a-f0-9-]{36}$/);
  assert.notEqual(createPlan().token, createPlan().token);
  assert.ok(Object.isFrozen(plan));
  assert.throws(() => createPlan('../stockflow-db'));
});

test('child environment excludes retained database, auth, notifications and Node preload configuration', () => {
  assert.deepEqual(isolatedEnvironment({ PATH: 'synthetic-path', SystemRoot: 'synthetic-system',
    DATABASE_URL: 'must-not-reach-child', JWT_SECRET: 'must-not-reach-child',
    NODE_OPTIONS: '--require untrusted', OPENAI_API_KEY: 'must-not-reach-child',
    N8N_API_KEY: 'must-not-reach-child', DISCORD_WEBHOOK_URL: 'must-not-reach-child',
    DOCKER_HOST: 'tcp://untrusted.invalid:2375', HTTP_PROXY: 'http://untrusted.invalid' }),
  { PATH: 'synthetic-path', SystemRoot: 'synthetic-system' });
});

test('Docker operations reject remote and unfamiliar engine endpoints', () => {
  assert.doesNotThrow(() => verifyLocalDockerEndpoint('npipe:////./pipe/docker_engine'));
  assert.doesNotThrow(() => verifyLocalDockerEndpoint('unix:///var/run/docker.sock'));
  for (const endpoint of ['tcp://production.invalid:2375', 'ssh://production.invalid', undefined,
    'unix:///some/other/socket', 'npipe:////./pipe/unfamiliar']) assert.throws(() => verifyLocalDockerEndpoint(endpoint));
});

test('client generation overrides only temporary generator output and retains every datamodel byte', () => {
  const schema = 'datasource db {\n provider = "postgresql"\n url = env("DATABASE_URL")\n}\n\ngenerator client {\n provider = "prisma-client-js"\n}\n\nmodel Product {\n id Int @id\n}\n';
  const generated = isolatedClientSchema(schema);
  assert.equal(generated.replace('  output = "./isolated-client"\n', ''), schema);
  assert.throws(() => isolatedClientSchema(schema.replace('generator client', 'generator other')));
  assert.throws(() => isolatedClientSchema(generated));
});

test('generated client guard rejects checkout env paths, external runtime imports and source/output escapes before import', () => {
  const directory = path.resolve('isolated-unit-workspace');
  const output = path.join(directory, 'isolated-client');
  const config = { generator: { provider: { value: 'prisma-client-js' }, output: { value: output },
    sourceFilePath: path.join(directory, 'generate.prisma') },
  relativeEnvPaths: { rootEnvPath: null, schemaEnvPath: '../.env' }, relativePath: '..',
  activeProvider: 'postgresql', inlineDatasources: { db: { url: { fromEnvVar: 'DATABASE_URL', value: null } } } };
  const source = (value) => `const config = ${JSON.stringify(value, null, 2)}\nconfig.dirname = __dirname\nrequire('./runtime/library.js')\n`;
  assert.doesNotThrow(() => verifyGeneratedClientSource(source(config), directory, output));
  assert.doesNotThrow(() => verifyGeneratedClientSource(source({ ...config, relativeEnvPaths: {} }), directory, output));
  assert.doesNotThrow(() => verifyGeneratedClientSource(source({ ...config, relativeEnvPaths: { rootEnvPath: null } }), directory, output));
  for (const edit of [
    (copy) => { copy.relativeEnvPaths.schemaEnvPath = '../../.env'; },
    (copy) => { copy.relativeEnvPaths.rootEnvPath = path.resolve('server/.env'); },
    (copy) => { copy.generator.sourceFilePath = path.resolve('server/prisma/schema.prisma'); },
    (copy) => { copy.generator.output.value = path.resolve('node_modules/.prisma/client'); },
    (copy) => { copy.relativePath = '../../server/prisma'; },
    (copy) => { copy.inlineDatasources.db.url.value = 'postgresql://retained.invalid/database'; },
    (copy) => { copy.isBundled = true; },
  ]) {
    const copy = structuredClone(config); edit(copy);
    assert.throws(() => verifyGeneratedClientSource(source(copy), directory, output));
  }
  assert.throws(() => verifyGeneratedClientSource(source(config).replace('./runtime/library.js', '@prisma/client/runtime/library.js'), directory, output));
  assert.throws(() => verifyGeneratedClientSource('throw new Error("configuration is not evaluated")', directory, output));
  const malformed = structuredClone(config);
  malformed.inlineDatasources.db.url.value = 'do-not-print-sensitive-literal';
  malformed.relativeEnvPaths.unrecognized = null;
  assert.throws(() => verifyGeneratedClientSource(source(malformed), directory, output), (error) => {
    assert.match(error.message, /Failed checks: env_paths_shape, datasource_literal_absent\./);
    assert.ok(!error.message.includes('do-not-print-sensitive-literal'));
    assert.ok(!error.message.includes(directory));
    return true;
  });
});

test('subprocess timeout waits for close before a caller can enter CID cleanup', async () => {
  const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
  let killed = false; let settled = false;
  child.kill = () => { killed = true; };
  const task = runCaptured('docker', ['run'], { timeout: 1, env: { DOCKER_HOST: 'npipe:////./pipe/dockerDesktopLinuxEngine' }, spawnImpl: (_executable, args) => {
    assert.deepEqual(args, ['--host', 'npipe:////./pipe/dockerDesktopLinuxEngine', 'run']); return child;
  } }).finally(() => { settled = true; });
  const rejection = assert.rejects(task, /timed out and was closed/);
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(killed, true); assert.equal(settled, false);
  child.emit('close', null);
  await rejection; assert.equal(settled, true);
});

test('late CID and uniquely named recovery require the full random ownership proof', async () => {
  let attempts = 0;
  const execute = async (_executable, args) => {
    assert.equal(args[0], 'inspect');
    if (attempts === 0) throw new Error('Container not visible yet.');
    return JSON.stringify([validContainer()]);
  };
  const recovered = await recoverOwnedContainer({ plan, password, cidFile: 'unit-only', env: {},
    read: async () => { if (attempts === 0) throw new Error('CID not written yet.'); return id; },
    execute, wait: async () => { attempts++; } });
  assert.equal(recovered, id); assert.equal(attempts, 1);
  assert.equal(await recoverOwnedContainer({ plan, password, cidFile: 'unit-only', env: {},
    read: async () => { throw new Error('Missing CID'); }, execute, wait: async () => {} }), id);
  await assert.rejects(recoverOwnedContainer({ plan, password, cidFile: 'unit-only', env: {},
    read: async () => { throw new Error('Missing CID'); },
    execute: async () => { const container = validContainer(); container.Config.Labels[plan.label] = 'foreign'; return JSON.stringify([container]); },
    wait: async () => {} }), /cleanup was not confirmed/);
});

test('seed worker messages expose only bounded scalar fixture createMany and disconnect operations', () => {
  assert.doesNotThrow(() => validateSeedMessage({ id: 1, action: 'createMany', model: 'product', data: fixtureRows(44).products }));
  assert.doesNotThrow(() => validateSeedMessage({ id: 2, action: 'disconnect' }));
  assert.doesNotThrow(() => validateSeedMessage({ id: 3, action: 'alignSequences' }));
  for (const message of [
    { id: 1, action: '$executeRaw', model: 'product', data: ['DELETE'] },
    { id: 1, action: 'createMany', model: 'stockTransaction', data: [{ id: 1 }] },
    { id: 1, action: 'createMany', model: 'product', data: [{ id: 1, supplier: { create: {} } }] },
    { id: 1, action: 'createMany', model: 'product', data: Array.from({ length: 501 }, () => ({ id: 1 })) },
    { id: 1, action: 'createMany', model: 'product', data: [{ description: 'x'.repeat(8_193) }] },
    { id: 1, action: 'createMany', model: 'product', data: [{ price: Infinity }] },
    { id: 1, action: 'disconnect', data: [] },
    { id: 1, action: 'alignSequences', table: 'User' },
    { id: 1, action: 'alignSequences', sql: 'DELETE FROM "User"' },
    { id: 1, action: 'alignSequences', data: ['User'] },
  ]) assert.throws(() => validateSeedMessage(message));
});

test('sequence alignment binds only six fixed table names and typed identifier fragments', async () => {
  const queries = [];
  const Prisma = { sql: (strings, ...values) => ({ strings: [...strings], values }) };
  const count = await alignSeedSequences({ $executeRaw: async (query) => { queries.push(query); return 1; } }, Prisma);
  assert.equal(count, 6);
  assert.deepEqual(queries.map((query) => query.values[0]), ['"User"', '"Supplier"', '"Category"', '"Product"', '"Order"', '"OrderItem"']);
  for (const query of queries) {
    assert.equal(query.values.length, 2);
    assert.match(query.strings.join('?'), /SELECT setval\(pg_get_serial_sequence\(\?, 'id'\)::regclass/);
    assert.match(query.strings.join('?'), /MAX\(id\)::bigint FROM \?/);
    assert.match(query.strings.join('?'), /\+ 1, false\)/);
    assert.deepEqual(query.values[1], { strings: [query.values[0]], values: [] });
  }
});

test('seed worker owns Prisma loading and returns a redacted code rather than database diagnostics', async () => {
  const processStub = new EventEmitter(); processStub.pid = 27;
  processStub.env = { DATABASE_URL: 'synthetic-ephemeral-url' };
  const sent = []; const inserted = []; let disconnected = false; let exited;
  processStub.send = (message, callback) => { sent.push(message); callback?.(); };
  processStub.exit = (code) => { exited = code; };
  class FakePrisma {
    constructor(options) {
      assert.equal(options.datasources.db.url, 'synthetic-ephemeral-url');
      this.user = { createMany: async ({ data }) => { inserted.push(data); return { count: data.length }; } };
      this.product = { createMany: async () => { throw Object.assign(new Error('private password must not be sent'), { code: 'P2002' }); } };
    }
    async $disconnect() { disconnected = true; }
  }
  vm.runInNewContext(seedWorkerSource('isolated-client-entry'), { Buffer, process: processStub,
    require: (entry) => { assert.equal(entry, 'isolated-client-entry'); return { PrismaClient: FakePrisma }; } });
  processStub.emit('message', { id: 1, action: 'createMany', model: 'user', data: [{ id: 1, name: 'Synthetic' }] });
  await new Promise(setImmediate);
  assert.equal(inserted.length, 1);
  processStub.emit('message', { id: 2, action: 'createMany', model: 'product', data: [{ id: 1 }] });
  await new Promise(setImmediate);
  assert.deepEqual(JSON.parse(JSON.stringify(sent.at(-1))), { type: 'seed-result', id: 2, ok: false, code: 'P2002' });
  assert.ok(!JSON.stringify(sent).includes('private password'));
  processStub.emit('message', { id: 3, action: 'disconnect' });
  await new Promise(setImmediate);
  assert.equal(disconnected, true); assert.equal(exited, 0);
});

test('parent seed proxy waits for worker process close after disconnect acknowledgement', async () => {
  const child = new EventEmitter(); child.pid = 36;
  const messages = []; child.send = (message, callback) => { messages.push(message); callback?.(); };
  child.kill = () => { child.emit('close'); };
  const client = createSeedWorkerClient(child);
  child.emit('message', { type: 'seed-ready', pid: child.pid });
  await client.ready;
  const inserted = client.user.createMany({ data: [{ id: 1, name: 'Synthetic' }] });
  await new Promise(setImmediate);
  child.emit('message', { type: 'seed-result', id: messages[0].id, ok: true, count: 1 });
  assert.deepEqual(await inserted, { count: 1 });
  const aligned = client.$alignSequences();
  await new Promise(setImmediate);
  assert.deepEqual(messages[1], { id: 2, action: 'alignSequences' });
  child.emit('message', { type: 'seed-result', id: messages[1].id, ok: true, count: 6 });
  assert.deepEqual(await aligned, { count: 6 });
  let finished = false;
  const disconnect = client.$disconnect().then(() => { finished = true; });
  await new Promise(setImmediate);
  child.emit('message', { type: 'seed-result', id: messages[2].id, ok: true });
  await new Promise(setImmediate);
  assert.equal(finished, false);
  child.emit('close'); await disconnect;
  assert.equal(finished, true);
});

test('database operations and deletion require exact CID, random label and private loopback configuration', () => {
  assert.equal(verifyDisposableContainer(validContainer(), plan, id, password), 55321);
  const desktop = validContainer();
  desktop.Mounts = [];
  desktop.HostConfig = { Tmpfs: { '/var/lib/postgresql/data': 'rw,nosuid,nodev,size=1g' }, Binds: null };
  assert.equal(verifyDisposableContainer(desktop, plan, id, password), 55321);
  assert.throws(() => verifyDisposableContainer({ ...desktop, HostConfig: { ...desktop.HostConfig, Binds: ['private:/other'] } }, plan, id, password));
  assert.throws(() => verifyDisposableContainer({ ...desktop, HostConfig: { Tmpfs: { '/var/lib/postgresql/data': 'rw' } } }, plan, id, password));
  const edits = [
    (container) => { container.Id = 'b'.repeat(64); },
    (container) => { container.Name = '/stockflow-db'; },
    (container) => { container.Config.Image = 'postgres:latest'; },
    (container) => { container.Config.Labels[plan.label] = 'another-run'; },
    (container) => { container.Config.Env[0] = 'POSTGRES_USER=stockflow'; },
    (container) => { container.Config.Env[1] = 'POSTGRES_DB=stock_management'; },
    (container) => { container.Config.Env[2] = 'POSTGRES_PASSWORD=another-secret'; },
    (container) => { container.NetworkSettings.Ports['5432/tcp'][0].HostIp = '0.0.0.0'; },
    (container) => { container.NetworkSettings.Ports['5432/tcp'][0].HostPort = '0'; },
    (container) => { container.NetworkSettings.Ports['5432/tcp'].push({ HostIp: '127.0.0.1', HostPort: '55322' }); },
    (container) => { container.Mounts = [{ Type: 'volume', Name: 'stockflow_demo_pgdata', Destination: '/var/lib/postgresql/data' }]; },
    (container) => { container.Mounts.push({ Type: 'bind', Source: 'C:/Github/StockFlow', Destination: '/workspace' }); },
    (container) => { container.Mounts = []; },
  ];
  for (const edit of edits) { const container = validContainer(); edit(container); assert.throws(() => verifyDisposableContainer(container, plan, id, password)); }
  assert.throws(() => verifyDisposableContainer(validContainer(), plan, 'name-not-an-exact-cid', password));
});

test('growth fixtures retain IDs and create cross-role, mixed-owner, long-label and stock boundaries', () => {
  for (const count of [44, 1_000, 10_000]) {
    const rows = fixtureRows(count);
    assert.equal(rows.products.length, count);
    assert.equal(rows.orders.length, count);
    assert.equal(rows.orderItems.length, count + 1_000);
    assert.equal(rows.products.filter((row) => row.supplierId === 1).length, count / 2);
    assert.equal(rows.orders.filter((row) => row.customerId === 2).length, count / 2);
    assert.deepEqual(rows.orderItems.filter((line) => line.orderId === 1).map((line) => line.productId), [1, 2]);
    assert.equal(rows.orders[0].totalAmount, 13);
    assert.equal(rows.orderItems.filter((line) => line.orderId === 44).length, 1_000);
    assert.equal(rows.orders[43].totalAmount, 2_500);
    assert.ok(rows.products[0].name.length > 256 && rows.products[0].sku.length > 128);
    assert.ok(rows.products.some((row) => row.quantity === 0));
    assert.equal(rows.products[2].name, 'Literal % marker');
  }
  assert.deepEqual(fixtureRows(1_000).products.slice(0, 44), fixtureRows(44).products);
  assert.throws(() => fixtureRows(45));
});

test('page assertions reject incorrect counts, metadata, double slicing and empty page zero', () => {
  const page = { success: true, data: Array.from({ length: 4 }, () => ({})),
    pagination: { page: 3, pageSize: 20, total: 44, pageCount: 3, hasNext: false, hasPrevious: true } };
  assert.doesNotThrow(() => assertPage(page, { total: 44, page: 3 }));
  assert.throws(() => assertPage({ ...page, data: [] }, { total: 44, page: 3 }));
  assert.throws(() => assertPage({ ...page, pagination: { ...page.pagination, total: 43 } }, { total: 44, page: 3 }));
  assert.doesNotThrow(() => assertPage({ success: true, data: [],
    pagination: { page: 1, pageSize: 20, total: 0, pageCount: 1, hasNext: false, hasPrevious: false } }, { total: 0 }));
  assert.throws(() => assertPage({ success: true, data: [],
    pagination: { page: 0, pageSize: 20, total: 0, pageCount: 0, hasNext: false, hasPrevious: false } }, { total: 0 }));
});
