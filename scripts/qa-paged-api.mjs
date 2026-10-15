import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { cp, lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LABEL = 'stockflow.qa.paged-api';
const IMAGE = 'postgres:16-alpine';
const STAGES = [44, 1_000, 10_000];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Importing this module and invoking it without --run-isolated are inert. In
// particular, this runner never loads .local/runtime.json, dotenv, or server/.env.
export function createPlan(token = randomUUID()) {
  if (!/^[a-f0-9-]{36}$/.test(token)) throw new Error('Invalid isolated run identity.');
  return Object.freeze({ token, name: `stockflow-qa-page-${token}`, image: IMAGE,
    label: LABEL, database: 'stockflow_paged_qa', user: 'paged_qa' });
}

export function isolatedEnvironment(inherited = process.env) {
  const keys = ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'COMSPEC',
    'PATHEXT', 'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE'];
  return Object.fromEntries(keys.filter((key) => inherited[key] !== undefined)
    .map((key) => [key, inherited[key]]));
}

export function verifyLocalDockerEndpoint(endpoint) {
  if (!['npipe:////./pipe/docker_engine', 'npipe:////./pipe/dockerDesktopLinuxEngine',
    'unix:///var/run/docker.sock'].includes(endpoint)) {
    throw new Error('The selected Docker context must address a recognized local Docker engine.');
  }
}

export function isolatedClientSchema(schema) {
  const generators = [...schema.matchAll(/^generator\s+\w+\s*\{[^}]*\}/gm)];
  if (generators.length !== 1 || !/^generator\s+client\s*\{/.test(generators[0][0])
    || !/provider\s*=\s*"prisma-client-js"/.test(generators[0][0])
    || /\boutput\s*=/.test(generators[0][0])) {
    throw new Error('The unchanged schema must have one default Prisma client generator.');
  }
  return schema.replace(generators[0][0], generators[0][0].replace(/}$/, '  output = "./isolated-client"\n}'));
}

function contained(directory, target) {
  const relative = path.relative(path.resolve(directory), path.resolve(target));
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

export function verifyGeneratedClientSource(source, directory, clientDirectory) {
  const match = source.match(/\bconst config = (\{[\s\S]*?\n\})\s*\n/);
  let config;
  try { config = JSON.parse(match?.[1]); } catch { throw new Error('Generated Prisma configuration is not the expected plain JSON shape.'); }
  const envPaths = config.relativeEnvPaths;
  if (!contained(directory, clientDirectory) || config.generator?.provider?.value !== 'prisma-client-js'
    || path.resolve(config.generator?.output?.value || '') !== path.resolve(clientDirectory)
    || !contained(directory, config.generator?.sourceFilePath || '')
    || (path.resolve(clientDirectory, config.relativePath || '') !== path.resolve(directory)
      && !contained(directory, path.resolve(clientDirectory, config.relativePath || '')))
    || !envPaths || !Object.hasOwn(envPaths, 'rootEnvPath') || !Object.hasOwn(envPaths, 'schemaEnvPath')
    || !Object.values(envPaths).every((value) => value === null
      || (typeof value === 'string' && contained(directory, path.resolve(clientDirectory, value))))
    || config.activeProvider !== 'postgresql'
    || config.inlineDatasources?.db?.url?.fromEnvVar !== 'DATABASE_URL'
    || config.inlineDatasources?.db?.url?.value !== null
    || config.isBundled === true || !source.includes('config.dirname = __dirname')
    || !source.includes("require('./runtime/library.js')")
    || source.includes("require('@prisma/client/")) {
    throw new Error('Generated Prisma configuration may read outside the isolated workspace.');
  }
  return config;
}

async function generateIsolatedClient(require, directory, schemaText, env, execute) {
  const sourcePackage = path.dirname(require.resolve('@prisma/client/package.json'));
  const targetPackage = path.join(directory, 'node_modules/@prisma/client');
  await mkdir(path.dirname(targetPackage), { recursive: true });
  await cp(sourcePackage, targetPackage, { recursive: true, filter: async (source) => {
    if ((await lstat(source)).isSymbolicLink()) throw new Error('Prisma package symlinks are not accepted by the isolated runner.');
    return !path.basename(source).startsWith('.env');
  } });
  const clientVersion = JSON.parse(await readFile(path.join(targetPackage, 'package.json'), 'utf8')).version;
  await writeFile(path.join(directory, 'package.json'), JSON.stringify({ private: true, name: 'stockflow-isolated-paged-qa',
    dependencies: { '@prisma/client': clientVersion } }), { mode: 0o600 });
  const schema = path.join(directory, 'generate.prisma');
  await writeFile(schema, isolatedClientSchema(schemaText), { mode: 0o600 });
  await execute(process.execPath, [require.resolve('prisma/build/index.js'), 'generate', '--schema', schema, '--generator', 'client'],
    { env: { ...env, PRISMA_GENERATE_SKIP_AUTOINSTALL: '1', CHECKPOINT_DISABLE: '1', PRISMA_HIDE_UPDATE_MESSAGE: '1' }, cwd: directory });
  const clientDirectory = path.join(directory, 'isolated-client');
  const entry = path.join(clientDirectory, 'index.js');
  verifyGeneratedClientSource(await readFile(entry, 'utf8'), directory, clientDirectory);
  // This prevents the generated client's cwd-based fallback from ever running.
  for (const target of [entry, path.join(clientDirectory, 'schema.prisma'), path.join(clientDirectory, 'runtime/library.js')]) {
    if (!contained(directory, await realpath(target))) throw new Error('Generated Prisma files escaped the isolated workspace.');
  }
  return entry;
}

export function verifyDisposableContainer(container, plan, createdId, password) {
  const env = Object.fromEntries((container?.Config?.Env || []).map((entry) => {
    const split = entry.indexOf('=');
    return [entry.slice(0, split), entry.slice(split + 1)];
  }));
  const bindings = container?.NetworkSettings?.Ports?.['5432/tcp'];
  const mounts = container?.Mounts || [];
  const port = bindings?.[0]?.HostPort;
  if (!/^[a-f0-9]{64}$/.test(createdId || '') || container?.Id !== createdId
    || container?.Name !== `/${plan.name}` || container?.Config?.Image !== plan.image
    || container?.Config?.Labels?.[plan.label] !== plan.token
    || env.POSTGRES_DB !== plan.database || env.POSTGRES_USER !== plan.user
    || env.POSTGRES_PASSWORD !== password
    || !Array.isArray(bindings) || bindings.length !== 1 || bindings[0].HostIp !== '127.0.0.1'
    || !/^\d+$/.test(port || '') || Number(port) < 1 || Number(port) > 65535
    || mounts.some((mount) => mount.Type === 'bind' || mount.Type === 'volume')
    || !mounts.some((mount) => mount.Type === 'tmpfs' && mount.Destination === '/var/lib/postgresql/data')) {
    throw new Error('Disposable PostgreSQL ownership could not be verified; no database operation or removal is permitted.');
  }
  return Number(port);
}

export function fixtureRows(count) {
  if (!STAGES.includes(count)) throw new Error('Unsupported fixture stage.');
  const products = Array.from({ length: count }, (_, offset) => {
    const id = offset + 1;
    return { id, name: id === 1 ? 'N'.repeat(300) : id === 3 ? 'Literal % marker' : `QA product ${String(id).padStart(6, '0')}`,
      sku: id === 1 ? 'S'.repeat(140) : `QA-PRODUCT-${String(id).padStart(6, '0')}`,
      description: `Isolated synthetic description ${'x'.repeat(4_000)}`,
      price: id % 17 + 1, quantity: id % 9, lowStockThreshold: id % 5 + 2,
      categoryId: id % 2 + 1, supplierId: id % 2 ? 1 : 2 };
  });
  const orders = Array.from({ length: count }, (_, offset) => {
    const id = offset + 1;
    return { id, customerId: id % 2 ? 2 : 3,
      status: ['PENDING', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED'][(id - 1) % 5],
      createdAt: new Date('2026-01-01T00:00:00.000Z'), updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      totalAmount: id === 1 ? 13 : id === 44 ? 2_500 : products[id - 1].price * 2 };
  });
  const orderItems = orders.flatMap((order) => order.id === 1
    ? [{ id: 1, orderId: 1, productId: 1, quantity: 2, price: 2 },
      { id: 2, orderId: 1, productId: 2, quantity: 3, price: 3 }]
    : order.id === 44 ? Array.from({ length: 1_000 }, (_, index) => ({
      id: 1_000_001 + index, orderId: 44, productId: index % 2 + 1, quantity: 1, price: index % 2 + 2,
    }))
      : [{ id: order.id + 1, orderId: order.id, productId: order.id, quantity: 2, price: products[order.id - 1].price }]);
  return { products, orders, orderItems };
}

export function assertPage(envelope, { total, page = 1, pageSize = 20 }) {
  assert.equal(envelope.success, true);
  assert.ok(Array.isArray(envelope.data));
  assert.deepEqual(envelope.pagination, { page, pageSize, total,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
    hasNext: page < Math.max(1, Math.ceil(total / pageSize)), hasPrevious: page > 1 });
  assert.equal(envelope.data.length, Math.min(pageSize, Math.max(0, total - (page - 1) * pageSize)));
}

function assertNoSecrets(value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    assert.ok(!/password|token|secret|authorization|address|contactNumber/i.test(key), `Unexpected projected field: ${key}`);
    assertNoSecrets(child);
  }
}

export async function runCaptured(executable, args, { env, cwd, timeout = 120_000, signal, spawnImpl = spawn } = {}) {
  return new Promise((resolve, reject) => {
    const commandArgs = executable === 'docker' ? ['--context', 'default', ...args] : args;
    const child = spawnImpl(executable, commandArgs, { env, cwd, signal, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    let timedOut = false; let failedToStart = false; let forceTimer;
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => {
      timedOut = true; child.kill();
      forceTimer = setTimeout(() => child.kill('SIGKILL'), 5_000);
    }, timeout);
    child.once('error', () => { failedToStart = true; });
    child.once('close', (code) => {
      clearTimeout(timer); clearTimeout(forceTimer);
      // Subprocess diagnostics can contain the ephemeral URL/password. Keep them
      // in memory only; neither evidence nor thrown errors include raw output.
      if (timedOut) reject(new Error('Isolated QA subprocess timed out and was closed.'));
      else if (failedToStart) reject(new Error(`Unable to complete isolated QA subprocess (${path.basename(executable)}).`));
      else if (code !== 0) reject(new Error(`Isolated QA subprocess failed (${path.basename(executable)}, exit ${code}, ${stderr.length} diagnostic bytes).`));
      else resolve(stdout.trim());
    });
  });
}
const command = runCaptured;

export async function recoverOwnedContainer({ plan, password, cidFile, env, read = readFile, execute = command, wait = sleep }) {
  for (let attempt = 0; attempt < 5; attempt++) {
    let recorded;
    try { recorded = (await read(cidFile, 'utf8')).trim(); } catch { /* creation may not have written CID yet */ }
    for (const candidate of [...new Set([recorded, plan.name].filter(Boolean))]) {
      try {
        const parsed = JSON.parse(await execute('docker', ['inspect', candidate], { env, timeout: 15_000 }));
        if (parsed.length !== 1) continue;
        const exactId = recorded || parsed[0].Id;
        verifyDisposableContainer(parsed[0], plan, exactId, password);
        return exactId;
      } catch { /* Never remove an unverified candidate. Retry only this run's identity. */ }
    }
    if (attempt < 4) await wait(250);
  }
  throw new Error('A started Docker creation could not be reconciled. A uniquely named owned container may remain; cleanup was not confirmed.');
}

async function inspect(plan, id, password, env, signal) {
  const parsed = JSON.parse(await command('docker', ['inspect', id], { env, signal }));
  assert.equal(parsed.length, 1);
  return verifyDisposableContainer(parsed[0], plan, id, password);
}

async function insertBatches(delegate, rows) {
  for (let index = 0; index < rows.length; index += 500) await delegate.createMany({ data: rows.slice(index, index + 500) });
}

async function seedStage(prisma, previous, count) {
  const rows = fixtureRows(count);
  await insertBatches(prisma.product, rows.products.filter((row) => row.id > previous));
  await insertBatches(prisma.order, rows.orders.filter((row) => row.id > previous));
  await insertBatches(prisma.orderItem, rows.orderItems.filter((row) => row.orderId > previous));
  return rows;
}

async function startApi(env, directory, clientEntry) {
  const preload = path.join(directory, 'loopback-api.cjs');
  // Existing source keeps its normal port behavior. The test child alone gets
  // a dynamic loopback listener, reported over its private parent IPC channel.
  await writeFile(preload, `const Module = require('node:module');\nconst originalLoad = Module._load;\nModule._load = function (request, parent, isMain) {\n  return originalLoad.call(this, request === '@prisma/client' ? ${JSON.stringify(clientEntry)} : request, parent, isMain);\n};\nconst net = require('node:net');\nconst listen = net.Server.prototype.listen;\nnet.Server.prototype.listen = function (...args) {\n  if (args[0] !== '0' && args[0] !== 0) throw new Error('QA requires a dynamic API port');\n  args[0] = { port: 0, host: '127.0.0.1' };\n  this.once('listening', () => process.send?.({ type: 'qa-listening', pid: process.pid, address: this.address() }));\n  return listen.apply(this, args);\n};\n`, { mode: 0o600 });
  const child = spawn(process.execPath, ['--require', preload, path.join(ROOT, 'server/src/index.js')], {
    cwd: directory, env: { ...env, PORT: '0' }, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error('Isolated API did not report its listener.')); }, 30_000);
    child.once('error', () => { clearTimeout(timer); reject(new Error('Isolated API could not start.')); });
    child.once('exit', () => { clearTimeout(timer); reject(new Error('Isolated API exited before reporting its listener.')); });
    child.on('message', (message) => {
      if (message?.type === 'qa-listening' && message.pid === child.pid
        && message.address?.address === '127.0.0.1' && Number.isInteger(message.address.port) && message.address.port > 0) {
        clearTimeout(timer); resolve(message.address.port);
      }
    });
  });
  return { child, base: `http://127.0.0.1:${port}/api` };
}

async function request(base, pathname, token, body) {
  const { url, signal } = typeof base === 'string' ? { url: base } : base;
  const response = await fetch(`${url}${pathname}`, { redirect: 'error', signal: signal
    ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
    method: body ? 'POST' : 'GET', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await response.text();
  let json;
  try { json = JSON.parse(text); } catch { throw new Error(`Isolated API returned non-JSON (${response.status}).`); }
  return { status: response.status, bytes: Buffer.byteLength(text), json };
}

async function verifyStage(base, tokens, rows, count) {
  const product = await request(base, '/products?page=1&pageSize=20');
  assert.equal(product.status, 200); assertPage(product.json, { total: count });
  assert.deepEqual(product.json.data.map((row) => row.id), Array.from({ length: 20 }, (_, index) => index + 1));
  for (const row of product.json.data) {
    for (const key of ['id', 'name', 'sku', 'price', 'quantity', 'lowStockThreshold', 'categoryId', 'supplierId']) assert.ok(key in row);
    for (const key of ['description', 'supplier', 'category']) assert.ok(!(key in row));
    assert.ok(row.name.length <= 256 && row.sku.length <= 128);
  }
  assert.deepEqual([...product.json.data[0].truncatedFields].sort(), ['name', 'sku']);
  assert.deepEqual(product.json.summary, {
    productCount: count, totalQuantity: rows.products.reduce((sum, row) => sum + row.quantity, 0),
    lowStockCount: rows.products.filter((row) => row.quantity <= row.lowStockThreshold).length,
    criticalStockCount: rows.products.filter((row) => row.quantity <= Math.floor(row.lowStockThreshold * 0.5)).length,
    outOfStockCount: rows.products.filter((row) => row.quantity === 0).length,
    inventoryValue: rows.products.reduce((sum, row) => sum + row.price * row.quantity, 0),
  });
  assertNoSecrets(product.json);
  const second = await request(base, '/products?page=2&pageSize=20');
  assertPage(second.json, { total: count, page: 2 });
  assert.deepEqual(second.json.data.map((row) => row.id), Array.from({ length: 20 }, (_, index) => index + 21));
  const lastPage = Math.ceil(count / 20);
  const clamped = await request(base, '/products?page=999999&pageSize=20');
  assertPage(clamped.json, { total: count, page: lastPage });
  const empty = await request(base, '/products?page=4&pageSize=20&search=will-never-match-isolated-fixture');
  assertPage(empty.json, { total: 0 });
  const filtered = await request(base, '/products?page=1&pageSize=20&supplier=1&stock=low');
  const matching = rows.products.filter((row) => row.supplierId === 1 && row.quantity <= row.lowStockThreshold);
  assertPage(filtered.json, { total: matching.length });
  assert.deepEqual(filtered.json.data.map((row) => row.id), matching.slice(0, 20).map((row) => row.id));
  const literal = await request(base, '/products?page=1&search=%25');
  assertPage(literal.json, { total: 1 }); assert.equal(literal.json.data[0].id, 3);
  for (const stock of ['critical', 'out', 'in']) {
    const result = await request(base, `/products?page=1&stock=${stock}`);
    const total = rows.products.filter((row) => stock === 'critical'
      ? row.quantity <= Math.floor(row.lowStockThreshold * 0.5) : stock === 'out' ? row.quantity === 0 : row.quantity > row.lowStockThreshold).length;
    assertPage(result.json, { total });
  }
  const sorted = await request(base, '/products?page=1&sortBy=price&sortOrder=asc');
  const sortedAgain = await request(base, '/products?page=1&sortBy=price&sortOrder=asc');
  assert.deepEqual(sorted.json.data.map((row) => row.id), sortedAgain.json.data.map((row) => row.id));
  assert.ok(sorted.json.data.every((row, index, data) => index === 0 || data[index - 1].price <= row.price));
  const order = await request(base, '/orders?page=1&pageSize=20', tokens.admin);
  assert.equal(order.status, 200); assertPage(order.json, { total: count });
  assert.deepEqual(order.json.data.map((row) => row.id), Array.from({ length: 20 }, (_, index) => count - index));
  for (const row of order.json.data) {
    assert.equal(row.amountScope, 'ORDER'); assert.ok(!('orderItems' in row)); assert.ok(!('product' in row));
    assert.ok(Number.isInteger(row.visibleLineCount) && row.visibleLineCount > 0);
    assert.ok(Number.isInteger(row.visibleUnits) && row.visibleUnits > 0);
    assert.equal(row.visibleAmount, rows.orders.find((candidate) => candidate.id === row.id).totalAmount);
  }
  assertNoSecrets(order.json);
  const customer = await request(base, '/orders?page=1&pageSize=20', tokens.customerA);
  assertPage(customer.json, { total: count / 2 });
  assert.ok(customer.json.data.every((row) => row.customerId === 2));
  const supplier = await request(base, '/orders?page=1&pageSize=20', tokens.supplierA);
  assertPage(supplier.json, { total: count / 2 + 1 });
  for (const row of supplier.json.data) {
    assert.equal(row.amountScope, 'SUPPLIER_ITEMS'); assert.ok(row.id % 2 || row.id === 44); assert.ok(!('totalAmount' in row));
    const ownLines = rows.orderItems.filter((line) => line.orderId === row.id && rows.products[line.productId - 1].supplierId === 1);
    assert.equal(row.visibleAmount, ownLines.reduce((sum, line) => sum + line.quantity * line.price, 0));
    assert.equal(row.visibleLineCount, ownLines.length);
    assert.equal(row.hasOtherSuppliers, row.id === 1 || row.id === 44);
  }
  assertNoSecrets(supplier.json);
  const pending = await request(base, '/orders?page=1&pageSize=20&status=PENDING', tokens.admin);
  assertPage(pending.json, { total: rows.orders.filter((row) => row.status === 'PENDING').length });
  assert.ok(pending.json.data.every((row) => row.status === 'PENDING'));
  const searched = await request(base, '/orders?page=1&search=%231', tokens.admin);
  assertPage(searched.json, { total: rows.orders.filter((row) => String(row.id).includes('1')).length });
  assert.ok(searched.json.data.every((row) => String(row.id).includes('1')));
  for (const [result, orders, supplierId] of [[order, rows.orders],
    [customer, rows.orders.filter((row) => row.customerId === 2)],
    [supplier, rows.orders.filter((row) => row.id % 2 || row.id === 44), 1]]) {
    const ids = new Set(orders.map((row) => row.id));
    const lines = rows.orderItems.filter((line) => ids.has(line.orderId)
      && (!supplierId || rows.products[line.productId - 1].supplierId === supplierId));
    assert.equal(result.json.summary.orderCount, orders.length);
    assert.deepEqual(result.json.summary.statusCounts, Object.fromEntries(
      ['PENDING', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED'].map((status) => [status, orders.filter((row) => row.status === status).length])));
    assert.equal(result.json.summary.visibleLineCount, lines.length);
    assert.equal(result.json.summary.visibleUnits, lines.reduce((sum, line) => sum + line.quantity, 0));
    assert.equal(result.json.summary.visibleAmount, lines.reduce((sum, line) => sum + line.quantity * line.price, 0));
  }
  const directory = await request(base, '/orders?page=1&pageSize=20&view=customers', tokens.admin);
  assert.equal(directory.status, 200); assertPage(directory.json, { total: 2 });
  assert.equal(directory.json.summary.customerCount, 2);
  assert.equal(directory.json.summary.totalSpending, rows.orders.reduce((sum, row) => sum + row.totalAmount, 0));
  assertNoSecrets(directory.json);
  const discovery = await request(base, '/discovery/suppliers?page=1&pageSize=20&includeProductCounts=true');
  assert.equal(discovery.status, 200);
  assertPage(discovery.json, { total: 2 });
  assert.deepEqual(discovery.json.data.map((row) => row.productCount), [count / 2, count / 2]);
  return { records: count, products: { pageRows: product.json.data.length, responseBytes: product.bytes },
    orders: { pageRows: order.json.data.length, responseBytes: order.bytes },
    customerRows: customer.json.data.length, supplierRows: supplier.json.data.length };
}

async function verifyBoundary(base, tokens) {
  for (const query of ['page=0', 'page=-1', 'page=1.5', 'page=NaN', 'page=9007199254740992',
    'page=1&page=2', 'page[]=1', 'page[x]=1', 'pageSize=20', 'page=1&pageSize=0',
    'page=1&pageSize=101', 'page=1&pageSize=Infinity', 'page=1&pageSize=2&pageSize=3',
    `page=1&search=${'x'.repeat(201)}`, 'page=1&sortBy=unrecognized', 'page=1&sortOrder=sideways',
    'page=1&sortBy=id&sortBy=id', 'page=1&sortBy=', 'page=1&sortOrder=']) {
    for (const endpoint of ['products', 'orders']) {
      assert.equal((await request(base, `/${endpoint}?${query}`, tokens.admin)).status, 400, `${endpoint}: ${query}`);
    }
  }
  for (const query of ['page=1&supplier=0', 'page=1&supplier=2147483648', 'page=1&category=-2', 'page=1&stock=unknown',
    'page=1&stock=low&lowStock=true', 'page=1&stock=low&lowStockThreshold=10']) {
    assert.equal((await request(base, `/products?${query}`)).status, 400, query);
  }
  assert.equal((await request(base, '/orders?page=1&status=UNKNOWN', tokens.admin)).status, 400);
  for (const [query, token] of [['page=1&customerId=3', tokens.customerA], ['page=1&supplierId=2', tokens.supplierA]]) {
    const result = await request(base, `/orders?${query}`, token);
    assert.equal(result.status, 400);
  }
  for (const token of [tokens.customerA, tokens.supplierA]) {
    assert.ok([400, 403].includes((await request(base, '/orders?page=1&view=customers', token)).status));
  }
  assert.equal((await request(base, '/orders?view=customers', tokens.admin)).status, 400);
  assert.equal((await request(base, '/orders?page=1&view=customers&status=PENDING', tokens.admin)).status, 400);
  assert.equal((await request(base, '/orders?page=1')).status, 401);
  assert.ok([403, 404].includes((await request(base, '/orders?page=1', tokens.unresolvedSupplier)).status));
  assert.equal((await request(base, '/orders/2', tokens.customerA)).status, 403);
  assert.equal((await request(base, '/orders/2', tokens.supplierA)).status, 403);
  const mixed = await request(base, '/orders/1', tokens.supplierA);
  assert.equal(mixed.status, 200); assert.equal(mixed.json.data.hasOtherSuppliers, true);
  assert.equal(mixed.json.data.orderItems.length, 1);
  assert.ok(mixed.json.data.orderItems.every((line) => line.product.supplierId === 1));
  assert.equal(mixed.json.data.totalAmount, 4);
  assertNoSecrets(mixed.json);
  const ownCustomer = await request(base, '/orders/1', tokens.customerA);
  assert.equal(ownCustomer.status, 200); assert.equal(ownCustomer.json.data.orderItems.length, 2);
  assertNoSecrets(ownCustomer.json);
}

async function verifyLegacy(base, tokens, count) {
  const products = await request(base, '/products');
  assert.equal(products.status, 200); assert.equal(products.json.data.length, count);
  assert.ok(!('pagination' in products.json)); assert.ok(products.json.data.every((row) => typeof row.description === 'string'));
  const orders = await request(base, '/orders', tokens.admin);
  assert.equal(orders.status, 200); assert.equal(orders.json.data.length, count);
  assert.ok(!('pagination' in orders.json));
  assert.ok(orders.json.data.every((row) => Array.isArray(row.orderItems) && typeof row.totalAmount === 'number'));
  const customer = await request(base, '/orders', tokens.customerA);
  assert.equal(customer.json.data.length, count / 2);
  assert.ok(customer.json.data.every((row) => row.customerId === 2));
  const supplier = await request(base, '/orders', tokens.supplierA);
  assert.equal(supplier.json.data.length, count / 2 + 1);
  assert.ok(supplier.json.data.every((row) => row.orderItems.every((line) => line.product.supplierId === 1)));
  return { productsBytes: products.bytes, ordersBytes: orders.bytes, products: count, orders: count };
}

export async function runIsolated({ evidencePath, onReady } = {}) {
  const plan = createPlan();
  const directory = await mkdtemp(path.join(tmpdir(), 'stockflow-paged-qa-'));
  const env = isolatedEnvironment();
  const password = randomBytes(32).toString('hex');
  const loginPassword = randomBytes(24).toString('hex');
  const cidFile = path.join(directory, 'postgres.cid');
  const report = { kind: 'isolated-postgresql-api', schemaChanged: false,
    schemaMeaning: 'No datamodel or checked-in schema changes; only a temporary generation-copy output path is overridden.',
    stages: [], checks: [], cleanup: false };
  let createdId; let creationStarted = false; let prisma; let api; let failure;
  const cancellation = new AbortController();
  const interrupt = () => { cancellation.abort(); api?.child?.kill(); };
  process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
  const execute = (executable, args, options = {}) => command(executable, args, { ...options, signal: cancellation.signal });
  try {
    const context = await execute('docker', ['context', 'show'], { env });
    if (!/^[A-Za-z0-9_.-]{1,128}$/.test(context)) throw new Error('Invalid selected Docker context.');
    const endpoint = JSON.parse(await execute('docker', ['context', 'inspect', context, '--format', '{{json .Endpoints.docker.Host}}'], { env }));
    verifyLocalDockerEndpoint(endpoint);
    // Pin every subsequent Docker call to the inspected local endpoint, even if
    // another process changes the user's selected context during this run.
    env.DOCKER_HOST = endpoint;
    creationStarted = true;
    await execute('docker', ['run', '--detach', '--pull=never', '--name', plan.name,
      '--cidfile', cidFile, '--label', `${plan.label}=${plan.token}`,
      '--publish', '127.0.0.1::5432', '--tmpfs', '/var/lib/postgresql/data:rw,nosuid,nodev,size=1g',
      '--env', `POSTGRES_USER=${plan.user}`, '--env', `POSTGRES_DB=${plan.database}`,
      '--env', 'POSTGRES_PASSWORD', plan.image], { env: { ...env, POSTGRES_PASSWORD: password } });
    createdId = (await readFile(cidFile, 'utf8')).trim();
    const port = await inspect(plan, createdId, password, env, cancellation.signal);
    const databaseUrl = `postgresql://${plan.user}:${password}@127.0.0.1:${port}/${plan.database}?schema=public`;
    const childEnv = { ...env, DATABASE_URL: databaseUrl, JWT_SECRET: randomBytes(48).toString('hex'),
      CLIENT_URL: 'http://127.0.0.1', NODE_ENV: 'test', BCRYPT_SALT_ROUNDS: '4' };
    for (let attempt = 0; ; attempt++) {
      try { await execute('docker', ['exec', createdId, 'pg_isready', '-U', plan.user, '-d', plan.database], { env }); break; }
      catch { if (cancellation.signal.aborted || attempt >= 59) throw new Error('Disposable PostgreSQL did not become ready or the run was interrupted.'); await sleep(500); }
    }
    await inspect(plan, createdId, password, env, cancellation.signal);
    const require = createRequire(path.join(ROOT, 'server/package.json'));
    const prismaCli = require.resolve('prisma/build/index.js');
    const schema = path.join(directory, 'schema.prisma');
    // Copy bytes verbatim: Prisma's CLI otherwise discovers .env relative to
    // the checked-in schema even when launched from an empty working directory.
    const schemaBytes = await readFile(path.join(ROOT, 'server/prisma/schema.prisma'));
    await writeFile(schema, schemaBytes, { mode: 0o600 });
    await execute(process.execPath, [prismaCli, 'db', 'push', '--schema', schema, '--skip-generate'],
      { env: childEnv, cwd: directory });
    const clientEntry = await generateIsolatedClient(require, directory, schemaBytes.toString('utf8'), childEnv, execute);
    const { PrismaClient } = require(clientEntry);
    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const bcrypt = require('bcryptjs');
    const hashed = bcrypt.hashSync(loginPassword, 4);
    const users = [
      { id: 1, name: 'QA admin', email: 'admin@paged-qa.invalid', role: 'ADMIN' },
      { id: 2, name: 'QA customer A', email: 'customer-a@paged-qa.invalid', role: 'CUSTOMER' },
      { id: 3, name: 'QA customer B', email: 'customer-b@paged-qa.invalid', role: 'CUSTOMER' },
      { id: 4, name: 'QA supplier A', email: 'supplier-a@paged-qa.invalid', role: 'SUPPLIER' },
      { id: 5, name: 'QA supplier B', email: 'supplier-b@paged-qa.invalid', role: 'SUPPLIER' },
      { id: 6, name: 'QA unresolved supplier', email: 'supplier-missing@paged-qa.invalid', role: 'SUPPLIER' },
    ];
    await prisma.user.createMany({ data: users.map((row) => ({ ...row, password: hashed })) });
    await prisma.supplier.createMany({ data: [1, 2].map((id) => ({ id, userId: id + 3, companyName: `QA supplier ${id}`, contactNumber: 'synthetic', address: 'DO NOT PROJECT' })) });
    await prisma.category.createMany({ data: [{ id: 1, name: 'QA category 1' }, { id: 2, name: 'QA category 2' }] });
    cancellation.signal.throwIfAborted();
    api = await startApi(childEnv, directory, clientEntry);
    api.base = { url: api.base, signal: cancellation.signal };
    const tokens = {};
    for (const [key, index] of [['admin', 0], ['customerA', 1], ['customerB', 2], ['supplierA', 3], ['supplierB', 4], ['unresolvedSupplier', 5]]) {
      const login = await request(api.base, '/auth/login', undefined, { email: users[index].email, password: loginPassword });
      assert.equal(login.status, 200);
      tokens[key] = login.json.data?.token ?? login.json.token;
      assert.equal(typeof tokens[key], 'string');
    }
    let previous = 0;
    for (const count of STAGES) {
      await inspect(plan, createdId, password, env, cancellation.signal);
      const rows = await seedStage(prisma, previous, count);
      report.stages.push(await verifyStage(api.base, tokens, rows, count));
      if (count === 44) {
        await verifyBoundary(api.base, tokens);
        report.checks.push('strict query parsing', 'customer and supplier ownership', 'mixed-supplier detail projection', 'unresolved identity denial');
      }
      previous = count;
    }
    report.legacy = await verifyLegacy(api.base, tokens, 10_000);
    report.checks.push('complete legacy arrays retained', 'exact product summaries', 'literal search', 'filter before page', 'deterministic ties', 'empty and clamped pages');
    // Fixed page fields may gain a few digit bytes in totals as history grows.
    for (const kind of ['products', 'orders']) {
      assert.ok(report.stages.every((stage) => stage[kind].responseBytes < 30_000), `${kind} page exceeded compact response budget`);
      assert.ok(report.stages[2][kind].responseBytes < report.stages[0][kind].responseBytes * 1.5, `${kind} page grew with total history`);
    }
    if (onReady) await onReady({ base: api.base.url, signal: cancellation.signal,
      accounts: users.map(({ email, role }) => ({ email, role, password: loginPassword })), report });
  } catch (error) { failure = error; }
  finally {
    if (api?.child && api.child.exitCode === null && api.child.signalCode === null) {
      await new Promise((resolve) => { api.child.once('exit', resolve); api.child.kill(); });
    }
    if (prisma) {
      try { await prisma.$disconnect(); } catch { failure ??= new Error('Isolated Prisma disconnect failed.'); }
    }
    // A failed docker command can still have created the container. Only its
    // exact cidfile identity, verified label and expected configuration qualify.
    if (!createdId && creationStarted) {
      try { createdId = await recoverOwnedContainer({ plan, password, cidFile, env }); }
      catch (error) { failure = error; }
    }
    if (createdId) {
      try {
        await inspect(plan, createdId, password, env);
        await command('docker', ['rm', '--force', '--volumes', createdId], { env });
        report.cleanup = true;
      } catch { failure = new Error('Disposable container cleanup could not verify ownership. Inspect the uniquely named stockflow-qa-page container manually; no unknown container was removed.'); }
    }
    const resolved = path.resolve(directory);
    if (resolved.startsWith(`${path.resolve(tmpdir())}${path.sep}`) && path.basename(resolved).startsWith('stockflow-paged-qa-')) {
      await rm(resolved, { recursive: true, force: true });
    }
    process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt);
  }
  if (failure) throw failure;
  if (evidencePath) await writeFile(path.resolve(evidencePath), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length === 0 || (args.length === 1 && args[0] === '--plan')) {
    console.log('Plan only. --run-isolated provisions and removes a uniquely owned disposable PostgreSQL container, applies the unchanged schema and runs synthetic API checks. No retained runtime, n8n, model or delivery endpoint is used.');
  } else if (args[0] === '--run-isolated' && (args.length === 1 || (args.length === 3 && args[1] === '--evidence'))) {
    runIsolated({ evidencePath: args[2] }).then((report) => console.log(JSON.stringify(report, null, 2)))
      .catch((error) => { console.error(error.message); process.exitCode = 1; });
  } else { console.error('Usage: node scripts/qa-paged-api.mjs [--plan | --run-isolated [--evidence PATH]]'); process.exitCode = 1; }
}
