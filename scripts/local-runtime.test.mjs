import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRuntimeConfig, matchesOwnedProcess, validateDatabaseContainer, validateN8nContainer } from './runtime-safety.mjs';

const config = { isolatedDemo: true, containerName: 'stockflow-db', databaseUrl: 'postgresql://stockflow:demo-test-password@localhost:55432/stock_management?schema=public', jwtSecret: 'x'.repeat(48), initialized: true };
const db = { Id: 'owned-db-id', Config: { Image: 'postgres:16-alpine', Env: ['POSTGRES_USER=stockflow', 'POSTGRES_DB=stock_management', 'POSTGRES_PASSWORD=demo-test-password'] }, HostConfig: { PortBindings: { '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: '55432' }] } }, Mounts: [{ Destination: '/var/lib/postgresql/data', Type: 'volume', Name: 'stockflow_demo_pgdata' }] };

test('runtime refuses remote or mismatched database configuration before any database operation', () => {
  assert.equal(validateRuntimeConfig(config).hostname, 'localhost');
  for (const databaseUrl of [config.databaseUrl.replace('localhost', 'production.example.com'), config.databaseUrl.replace(':55432', ':5432'), config.databaseUrl.replace('/stock_management', '/other_database')]) {
    assert.throws(() => validateRuntimeConfig({ ...config, databaseUrl }));
  }
});

test('stopping requires matching PID, script argument, executable, and process creation time', () => {
  const snapshot = { pid: 123, startedAt: 'exact-start', executable: 'C:\\Program Files\\nodejs\\node.exe', commandLine: '"C:\\Program Files\\nodejs\\node.exe" C:\\Github\\StockFlow\\server\\src\\index.js' };
  const marker = { pid: 123, startedAt: 'exact-start' };
  const script = 'C:\\Github\\StockFlow\\server\\src\\index.js';
  assert.equal(matchesOwnedProcess(snapshot, marker, script), true);
  assert.equal(matchesOwnedProcess({ ...snapshot, startedAt: 'reused-pid' }, marker, script), false);
  assert.equal(matchesOwnedProcess({ ...snapshot, commandLine: snapshot.commandLine.replace('StockFlow', 'AnotherApp') }, marker, script), false);
  assert.equal(matchesOwnedProcess({ ...snapshot, commandLine: `node --eval "${script}"` }, marker, script), false);
  assert.equal(matchesOwnedProcess({ ...snapshot, executable: 'C:\\unrelated.exe' }, marker, script), false);
});

test('database identity includes saved container ID, volume, loopback binding, and credentials', () => {
  assert.equal(validateDatabaseContainer(db, config), 'owned-db-id');
  assert.throws(() => validateDatabaseContainer(db, { ...config, containerId: 'replacement-db' }));
  assert.throws(() => validateDatabaseContainer({ ...db, Mounts: [{ ...db.Mounts[0], Name: 'unrelated-volume' }] }, config));
  assert.throws(() => validateDatabaseContainer({ ...db, Config: { ...db.Config, Env: ['POSTGRES_PASSWORD=wrong'] } }, config));
});

test('n8n reuse verifies official image, persistent storage, port, and saved identity', () => {
  const n8n = { Id: 'user-n8n', Config: { Image: 'docker.n8n.io/n8nio/n8n:2.43.6' }, HostConfig: { PortBindings: { '5678/tcp': [{ HostIp: '', HostPort: '5678' }] } }, Mounts: [{ Destination: '/home/node/.n8n', Name: 'n8n_data' }] };
  assert.equal(validateN8nContainer(n8n), 'user-n8n');
  assert.throws(() => validateN8nContainer(n8n, 'different-container'));
  assert.throws(() => validateN8nContainer({ ...n8n, Config: { Image: 'unrelated/server:latest' } }));
  assert.throws(() => validateN8nContainer({ ...n8n, Mounts: [] }));
});
