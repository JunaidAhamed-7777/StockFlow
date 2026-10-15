// Lifecycle contract fixtures only: no Docker, application process, API or private marker is accessed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, rmSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createLocalRuntime, saveRuntimeMarker, runtimeCommandIdentity, hasGeneratedPrismaClient } from './local-runtime-core.mjs';

function fixture(t) {
  const prefix = path.join(tmpdir(), 'stockflow-runtime-');
  const root = mkdtempSync(prefix);
  t.after(() => { assert.ok(root.startsWith(prefix)); rmSync(root, { recursive: true, force: true }); });
  const state = { containers: new Map(), volume: null, processes: new Map(), ports: new Map(), mutations: [], captures: [], tables: 0, seedCount: 0, nextPid: 100, replacements: 0, healthy: true, clientReady: true };
  const result = (stdout = '', status = 0) => ({ status, stdout });
  const capture = (command, args) => {
    assert.equal(command, 'docker'); state.captures.push([...args]);
    if (args[0] === 'info') return result('fixture-docker', state.dockerUnavailable ? 1 : 0);
    if (args[1] === 'inspect') {
      const object = args[0] === 'container' ? state.containers.get(args[2]) : state.volume;
      return object ? result(JSON.stringify([object])) : result('', 1);
    }
    if (args.includes('pg_isready')) return result('', state.databaseUnready ? 1 : 0);
    if (args.includes('psql')) return result(state.tableOutput ?? String(state.tables));
    assert.fail(`Unexpected capture: ${command} ${args.join(' ')}`);
  };
  const run = (command, args, options = {}) => {
    state.mutations.push({ kind: 'run', command, args: [...args] });
    if (command === 'docker') {
      if (args[0] === 'start') {
        const container = [...state.containers.values()].find((entry) => entry.Id === args[1]);
        assert.ok(container); container.State.Running = true; return;
      }
      if (args[0] === 'volume') { state.volume = { Labels: { 'stockflow.owner': args[3].split('=')[1] } }; return; }
      assert.equal(args[0], 'run');
      const name = args[args.indexOf('--name') + 1];
      const database = name === 'stockflow-db';
      state.containers.set(name, {
        Id: `${name}-fixture-id`, State: { Running: true },
        Config: { Image: args.at(-1), Env: database ? ['POSTGRES_USER=stockflow', 'POSTGRES_DB=stock_management', `POSTGRES_PASSWORD=${options.env.POSTGRES_PASSWORD}`] : [] },
        HostConfig: { PortBindings: { [database ? '5432/tcp' : '5678/tcp']: [{ HostIp: '127.0.0.1', HostPort: database ? '55432' : '5678' }] } },
        Mounts: [{ Destination: database ? '/var/lib/postgresql/data' : '/home/node/.n8n', Type: 'volume', Name: database ? 'stockflow_demo_pgdata' : 'n8n_data', Source: database ? '/volumes/stockflow_demo_pgdata' : '/volumes/n8n_data' }],
      }); return;
    }
    assert.equal(command, 'fixture-node');
    if (args.includes('push')) { state.tables = 8; return; }
    if (args[0] === 'prisma/seed.js') { if (state.failSeed) throw new Error('Fixture seed failed'); state.seedCount++; return; }
    if (args.includes('generate')) { state.clientReady = true; return; }
    assert.fail(`Unexpected run: ${command} ${args.join(' ')}`);
  };
  const options = {
    root, environment: { FIXTURE: 'true' }, execPath: 'fixture-node', identity: { pid: 991, startedAt: 'fixture-command-start', script: path.join(root, 'scripts/local-runtime.mjs') },
    capture, run, processSnapshot: (pid) => state.processes.get(pid) || null,
    listenerPids: (port) => state.ports.get(port) || [], ready: async () => state.healthy, wait: async () => {}, log: () => {}, generatedClientReady: () => state.clientReady,
    background: async (name, env, definition) => {
      const pid = ++state.nextPid;
      const snapshot = { pid, startedAt: `fixture-${pid}`, executable: 'node.exe', commandLine: `node "${definition.script}"` };
      state.mutations.push({ kind: 'launch', name, pid }); state.processes.set(pid, snapshot); state.ports.set(definition.port, [pid]);
      return snapshot;
    },
    kill: (pid, signal) => {
      if (signal === 0) { if (!state.processes.has(pid)) throw new Error('Fixture process absent'); return; }
      assert.equal(signal, 'SIGTERM'); assert.ok(state.processes.has(pid));
      state.mutations.push({ kind: 'kill', pid }); state.processes.delete(pid);
      for (const [port, pids] of state.ports) state.ports.set(port, pids.filter((entry) => entry !== pid));
    },
    replaceMarker: (temporary, filename) => { state.replacements++; renameSync(temporary, filename); },
  };
  const runtime = createLocalRuntime(options);
  return { root, state, options, runtime, read: () => JSON.parse(readFileSync(runtime.configPath, 'utf8')), bytes: () => readFileSync(runtime.configPath, 'utf8') };
}

function clientArtifacts(root) {
  const schema = readFileSync(new URL('../server/prisma/schema.prisma', import.meta.url), 'utf8');
  const generated = path.join(root, 'node_modules/.prisma/client');
  mkdirSync(path.join(root, 'server/prisma'), { recursive: true }); mkdirSync(generated, { recursive: true });
  writeFileSync(path.join(root, 'server/prisma/schema.prisma'), schema);
  writeFileSync(path.join(generated, 'schema.prisma'), `// Prisma-formatted schema copy\r\n${schema.replaceAll('\n', '\r\n')}`);
  const models = Object.fromEntries([...schema.matchAll(/^\s*model\s+(\w+)\s*\{/gm)].map((match) => [match[1], { fields: [] }]));
  const index = path.join(generated, 'index.js');
  const validIndex = `const config = {}; config.runtimeDataModel = JSON.parse(${JSON.stringify(JSON.stringify({ models }))});`;
  // Same public artifact/failure mode as @prisma/client's npm postinstall placeholder.
  const stub = `module.exports.PrismaClient = class { constructor() { throw new Error('@prisma/client did not initialize yet'); } };`;
  writeFileSync(index, stub);
  return { schema, generated, index, validIndex, stub };
}

test('generated-client guard rejects the postinstall index stub, incomplete metadata and stale schema', (t) => {
  const f = fixture(t); assert.equal(hasGeneratedPrismaClient(f.root), false);
  const artifacts = clientArtifacts(f.root);
  assert.equal(hasGeneratedPrismaClient(f.root), false); // index.js and copied schema alone are insufficient.
  writeFileSync(artifacts.index, artifacts.validIndex);
  assert.equal(hasGeneratedPrismaClient(f.root), true); // Formatting and comments do not force regeneration.
  writeFileSync(path.join(artifacts.generated, 'schema.prisma'), artifacts.schema.replace('env("DATABASE_URL")', 'env("OTHER_DATABASE")'));
  assert.equal(hasGeneratedPrismaClient(f.root), false);
  writeFileSync(path.join(artifacts.generated, 'schema.prisma'), artifacts.schema);
  for (const metadata of ['{broken', JSON.stringify({ models: { Other: {} } }), JSON.stringify({})]) {
    writeFileSync(artifacts.index, `config.runtimeDataModel = JSON.parse(${JSON.stringify(metadata)});`);
    assert.equal(hasGeneratedPrismaClient(f.root), false);
  }
});

test('postinstall stub generates before schema/seed; a verified client is reused on repeated start', async (t) => {
  const f = fixture(t), artifacts = clientArtifacts(f.root);
  const runtime = createLocalRuntime({ ...f.options, generatedClientReady: () => hasGeneratedPrismaClient(f.root), run: (command, args, options) => {
    f.options.run(command, args, options);
    if (args.includes('generate')) writeFileSync(artifacts.index, artifacts.validIndex);
  } });
  await runtime.execute('start');
  const commands = f.state.mutations.filter((entry) => entry.command === 'fixture-node').map((entry) => entry.args);
  assert.equal(commands.length, 3); assert.ok(commands[0].includes('generate')); assert.ok(commands[1].includes('push')); assert.equal(commands[2][0], 'prisma/seed.js');
  const mutations = f.state.mutations.length, marker = f.bytes();
  await runtime.execute('start');
  assert.equal(f.state.mutations.length, mutations); assert.equal(f.bytes(), marker); assert.equal(f.state.seedCount, 1);
});

test('failed client generation stops before schema mutation and never replaces a running API client', async (t) => {
  const fresh = fixture(t); clientArtifacts(fresh.root);
  const runtime = createLocalRuntime({ ...fresh.options, generatedClientReady: () => hasGeneratedPrismaClient(fresh.root) });
  await assert.rejects(runtime.execute('start'), /did not produce a verified client/);
  assert.equal(fresh.state.tables, 0); assert.equal(fresh.state.seedCount, 0); assert.equal(fresh.state.processes.size, 0);
  assert.equal(fresh.state.mutations.some((entry) => entry.args?.includes('push')), false);
  assert.equal(existsSync(runtime.lockPath), false); assert.equal(existsSync(`${runtime.lockPath}.guard`), false);
  const running = fixture(t); await running.runtime.execute('start');
  running.state.clientReady = false;
  const mutations = running.state.mutations.length, marker = running.bytes();
  await assert.rejects(running.runtime.execute('start'), /Stop the verified app processes/);
  assert.equal(running.state.mutations.length, mutations); assert.equal(running.bytes(), marker);
  assert.equal(existsSync(running.runtime.lockPath), false);
});

test('fresh empty setup initializes schema and seed once; repeated start preserves credentials, IDs and all existing data', async (t) => {
  const f = fixture(t); await f.runtime.execute('start');
  assert.equal(f.state.seedCount, 1);
  assert.equal(f.state.mutations.filter((entry) => entry.args?.includes('push')).length, 1);
  assert.equal(f.state.mutations.filter((entry) => entry.args?.[0] === 'run').length, 2);
  assert.equal(f.state.mutations.filter((entry) => entry.kind === 'launch').length, 2);
  const marker = f.bytes(); const mutations = f.state.mutations.length; const replacements = f.state.replacements;
  await f.runtime.execute('start');
  assert.equal(f.bytes(), marker); assert.equal(f.state.seedCount, 1);
  assert.equal(f.state.mutations.length, mutations); assert.equal(f.state.replacements, replacements);
  assert.equal(existsSync(f.runtime.lockPath), false);
});

test('current CLI identity resolves its relative script argument without weakening app process guards', (t) => {
  const f = fixture(t);
  const script = path.join(f.root, 'scripts/local-runtime.mjs');
  const snapshot = { pid: 123, startedAt: 'fixture-start', executable: 'node.exe', commandLine: 'node scripts/local-runtime.mjs start' };
  assert.deepEqual(runtimeCommandIdentity(snapshot, { pid: 123, script, cwd: f.root }), { pid: 123, startedAt: 'fixture-start', script });
  for (const changed of [{ pid: 124 }, { executable: 'unrelated.exe' }, { commandLine: 'node another-script.mjs' }, { startedAt: '' }]) {
    assert.throws(() => runtimeCommandIdentity({ ...snapshot, ...changed }, { pid: 123, script, cwd: f.root }), /verify this runtime command identity/);
  }
});

test('status is read-only even when an unknown runtime lock is held; fresh status creates no files', async (t) => {
  const fresh = fixture(t);
  assert.equal((await fresh.runtime.execute('status')).configured, false);
  assert.deepEqual(readdirSync(fresh.root), []);
  const f = fixture(t); await f.runtime.execute('start');
  writeFileSync(f.runtime.lockPath, 'partial-unknown-lock');
  const before = f.bytes(); const files = readdirSync(path.dirname(f.runtime.configPath)); const count = f.state.mutations.length; const captures = f.state.captures.length;
  assert.equal((await f.runtime.execute('status')).api.owned, true);
  assert.equal(f.bytes(), before); assert.equal(f.state.mutations.length, count); assert.equal(f.state.captures.length, captures);
  assert.deepEqual(readdirSync(path.dirname(f.runtime.configPath)), files);
  assert.equal(readFileSync(f.runtime.lockPath, 'utf8'), 'partial-unknown-lock');
});

test('stop/restart kills only verified app processes and preserves database, n8n, secrets and initialized data', async (t) => {
  const f = fixture(t); await f.runtime.execute('start');
  const before = f.read(); const count = f.state.mutations.length;
  await f.runtime.execute('stop');
  assert.deepEqual(f.state.mutations.slice(count), [{ kind: 'kill', pid: before.serverPid }, { kind: 'kill', pid: before.clientPid }]);
  assert.equal(f.state.containers.size, 2); assert.ok([...f.state.containers.values()].every((container) => container.State.Running));
  await f.runtime.execute('start');
  const restarted = f.read();
  for (const key of ['databaseUrl', 'jwtSecret', 'containerId', 'n8nContainerId', 'initialized']) assert.equal(restarted[key], before[key]);
  const priorPid = restarted.serverPid; await f.runtime.execute('restart');
  assert.notEqual(f.read().serverPid, priorPid); assert.equal(f.state.seedCount, 1);
  assert.equal(f.state.mutations.filter((entry) => entry.args?.includes('push')).length, 1);
});

test('unrelated ports and reused PIDs refuse before replacements or stopping any other app', async (t) => {
  const fresh = fixture(t); fresh.state.ports.set(3001, [1234]);
  await assert.rejects(fresh.runtime.execute('start'), /not verified/);
  assert.deepEqual(fresh.state.mutations, []);
  const f = fixture(t); await f.runtime.execute('start');
  const before = f.bytes(); const count = f.state.mutations.length; const pid = f.read().clientPid;
  f.state.processes.set(pid, { ...f.state.processes.get(pid), startedAt: 'reused-pid-time' });
  f.state.ports.delete(5173);
  await assert.rejects(f.runtime.execute('start'), /different process/);
  await assert.rejects(f.runtime.execute('stop'), /different process/);
  assert.equal(f.state.mutations.length, count); assert.equal(f.bytes(), before);
});

for (const port of [5173, 55432, 5678]) {
  test(`unrelated port ${port} is refused without touching its service or attempting schema changes`, async (t) => {
    const f = fixture(t); f.state.ports.set(port, [1234]);
    await assert.rejects(f.runtime.execute('start'), new RegExp(`Port ${port}`));
    assert.deepEqual(f.state.ports.get(port), [1234]);
    assert.equal(f.state.mutations.some((entry) => entry.kind === 'kill' || entry.kind === 'launch'), false);
    assert.equal(f.state.mutations.some((entry) => entry.command === 'fixture-node'), false);
    assert.equal(f.state.containers.has('stockflow-db'), false); assert.equal(f.state.volume, null);
    assert.equal(f.state.tables, 0); assert.equal(f.state.seedCount, 0);
    // Database-port validation follows n8n setup; that separate container may
    // already have been created, while the occupied service remains untouched.
    if (port !== 55432) assert.deepEqual(f.state.mutations, []);
    assert.equal(existsSync(f.runtime.lockPath), false); assert.equal(existsSync(`${f.runtime.lockPath}.guard`), false);
  });
}

for (const resource of ['container', 'volume']) {
  test(`an existing unowned database ${resource} without a runtime marker is preserved and not adopted`, async (t) => {
    const f = fixture(t);
    const existing = { Id: 'unowned-fixture-resource', Labels: { 'stockflow.owner': 'another-checkout' } };
    if (resource === 'container') f.state.containers.set('stockflow-db', existing); else f.state.volume = existing;
    await assert.rejects(f.runtime.execute('start'), /already exists without this checkout's runtime marker/);
    assert.equal(existsSync(f.runtime.configPath), false);
    assert.equal(resource === 'container' ? f.state.containers.get('stockflow-db') : f.state.volume, existing);
    assert.deepEqual(f.state.mutations, []); assert.equal(f.state.seedCount, 0);
    assert.equal(existsSync(f.runtime.lockPath), false); assert.equal(existsSync(`${f.runtime.lockPath}.guard`), false);
  });
}

test('missing or replaced saved containers are preserved without automatic replacements', async (t) => {
  for (const name of ['stockflow-db', 'n8n']) for (const replaced of [false, true]) {
    const f = fixture(t); await f.runtime.execute('start');
    if (replaced) f.state.containers.get(name).Id = 'replacement-fixture-id'; else f.state.containers.delete(name);
    const count = f.state.mutations.length; const before = f.bytes();
    await assert.rejects(f.runtime.execute('start'), /missing|identity|does not match/);
    assert.equal(f.state.mutations.length, count); assert.equal(f.bytes(), before);
  }
});

test('Docker unavailable fails cleanly; stopped verified containers restart by saved ID without recreating volumes or schema', async (t) => {
  const fresh = fixture(t); fresh.state.dockerUnavailable = true;
  await assert.rejects(fresh.runtime.execute('start'), /Docker is unavailable/);
  assert.equal(existsSync(fresh.runtime.configPath), false); assert.equal(existsSync(fresh.runtime.lockPath), false); assert.deepEqual(fresh.state.mutations, []);
  const f = fixture(t); await f.runtime.execute('start');
  const before = f.read(); const count = f.state.mutations.length;
  for (const container of f.state.containers.values()) container.State.Running = false;
  await f.runtime.execute('start');
  assert.deepEqual(f.state.mutations.slice(count).map((entry) => entry.args), [['start', before.n8nContainerId], ['start', before.containerId]]);
  assert.equal(f.state.seedCount, 1);
});

test('PostgreSQL never ready exhausts the bounded health wait before schema or app launch, then recovers safely', async (t) => {
  const f = fixture(t); f.state.databaseUnready = true;
  await assert.rejects(f.runtime.execute('start'), /Local PostgreSQL did not become ready/);
  assert.equal(f.state.captures.filter((args) => args.includes('pg_isready')).length, 60);
  assert.equal(f.state.captures.some((args) => args.includes('psql')), false);
  assert.equal(f.state.mutations.some((entry) => entry.command === 'fixture-node' || entry.kind === 'launch'), false);
  assert.equal(f.state.tables, 0); assert.equal(f.state.seedCount, 0);
  const before = f.read(); assert.equal(before.initialized, false);
  assert.equal(existsSync(f.runtime.lockPath), false); assert.equal(existsSync(`${f.runtime.lockPath}.guard`), false);
  f.state.databaseUnready = false;
  await f.runtime.execute('start');
  for (const key of ['databaseUrl', 'jwtSecret', 'containerId', 'n8nContainerId']) assert.equal(f.read()[key], before[key]);
  assert.equal(f.state.seedCount, 1);
  assert.equal(f.state.mutations.filter((entry) => entry.args?.[0] === 'run').length, 2);
});

test('seed failure after schema push leaves initialized false and refuses a nonempty schema on retry', async (t) => {
  const f = fixture(t); f.state.failSeed = true;
  await assert.rejects(f.runtime.execute('start'), /Fixture seed failed/);
  assert.equal(f.read().initialized, false); assert.equal(f.state.tables, 8); assert.equal(f.state.seedCount, 0);
  const before = f.bytes(); const count = f.state.mutations.length;
  f.state.failSeed = false;
  await assert.rejects(f.runtime.execute('start'), /non-empty demo database/);
  assert.equal(f.state.mutations.length, count); assert.equal(f.bytes(), before); assert.equal(existsSync(f.runtime.lockPath), false);
});

test('unknown table counts refuse initialization and atomic marker replacement failure preserves original bytes', async (t) => {
  const f = fixture(t); f.state.tableOutput = '';
  await assert.rejects(f.runtime.execute('start'), /empty public schema/);
  assert.equal(f.state.mutations.some((entry) => entry.args?.includes('push')), false);
  const original = f.bytes();
  assert.throws(() => saveRuntimeMarker(f.runtime.configPath, { ...f.read(), initialized: true }, () => { throw new Error('Fixture rename failed'); }), /rename failed/);
  assert.equal(f.bytes(), original);
  assert.deepEqual(readdirSync(path.dirname(f.runtime.configPath)).filter((name) => name.endsWith('.tmp')), []);
});

test('malformed or null runtime markers refuse without replacement and release both locks', async (t) => {
  const f = fixture(t); await f.runtime.execute('start');
  const count = f.state.mutations.length;
  for (const content of ['{unfinished', 'null', 'false', '0', '[]']) {
    writeFileSync(f.runtime.configPath, content);
    await assert.rejects(f.runtime.execute('start'), /marker/);
    assert.equal(readFileSync(f.runtime.configPath, 'utf8'), content);
    assert.equal(f.state.mutations.length, count);
    assert.equal(existsSync(f.runtime.lockPath), false); assert.equal(existsSync(`${f.runtime.lockPath}.guard`), false);
  }
});

test('marker save failure after launch cleans up only that verified new process and permits recovery', async (t) => {
  const f = fixture(t);
  let failed = false;
  const runtime = createLocalRuntime({ ...f.options, replaceMarker: (temporary, filename) => {
    if (!failed && JSON.parse(readFileSync(temporary, 'utf8')).serverPid) { failed = true; throw new Error('Fixture launch marker failed'); }
    renameSync(temporary, filename);
  } });
  await assert.rejects(runtime.execute('start'), /Fixture launch marker failed/);
  assert.equal(f.read().initialized, true); assert.equal(f.read().serverPid, undefined);
  assert.equal(f.state.processes.size, 0); assert.deepEqual(f.state.ports.get(3001), []);
  assert.deepEqual(f.state.mutations.filter((entry) => entry.kind === 'kill'), [{ kind: 'kill', pid: 101 }]);
  assert.equal(existsSync(runtime.lockPath), false);
  await f.runtime.execute('start');
  assert.equal(f.state.processes.size, 2); assert.equal(f.state.seedCount, 1);
});

test('default background boundary cleans up its own child when post-spawn inspection fails', async (t) => {
  const f = fixture(t); let killed = 0;
  const runtime = createLocalRuntime({ ...f.options, background: undefined,
    spawnProcess: () => {
      const child = new EventEmitter(); child.pid = 701; child.unref = () => {}; child.kill = () => { killed++; };
      queueMicrotask(() => child.emit('spawn')); return child;
    },
    processSnapshot: (pid) => { if (pid === 701) throw new Error('Fixture inspection failed'); return f.options.processSnapshot(pid); },
  });
  await assert.rejects(runtime.execute('start'), /Could not record the new server process identity/);
  assert.equal(killed, 1); assert.equal(f.read().serverPid, undefined);
  assert.equal(existsSync(runtime.lockPath), false);
});
