import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { createPlan, isolatedEnvironment, isolatedClientSchema, verifyGeneratedClientSource,
  verifyLocalDockerEndpoint, verifyDisposableContainer, fixtureRows, assertPage, runCaptured, recoverOwnedContainer } from './qa-paged-api.mjs';

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
});

test('subprocess timeout waits for close before a caller can enter CID cleanup', async () => {
  const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
  let killed = false; let settled = false;
  child.kill = () => { killed = true; };
  const task = runCaptured('docker', ['run'], { timeout: 1, spawnImpl: (_executable, args) => {
    assert.deepEqual(args, ['--context', 'default', 'run']); return child;
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
