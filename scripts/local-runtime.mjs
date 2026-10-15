import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, openSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const localDir = path.join(root, '.local');
mkdirSync(localDir, { recursive: true });
const configPath = path.join(localDir, 'runtime.json');
let config = existsSync(configPath) ? JSON.parse(readFileSync(configPath, 'utf8')) : null;
const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', ...options });
  if (result.status !== 0) throw new Error(`${command} failed. No existing database was modified.`);
};
const ready = async (url) => {
  try { return (await fetch(url, { signal: AbortSignal.timeout(1500) })).ok; } catch { return false; }
};

// Reuse the user's existing local n8n and encrypted credential volume.
if (!(await ready('http://localhost:5678/healthz'))) {
  const existingN8n = spawnSync('docker', ['inspect', 'n8n'], { stdio: 'ignore' });
  if (existingN8n.status === 0) run('docker', ['start', 'n8n']);
  else run('docker', ['run', '--detach', '--name', 'n8n', '--publish', '127.0.0.1:5678:5678', '--env', 'TZ=Asia/Kolkata', '--env', 'GENERIC_TIMEZONE=Asia/Kolkata', '--volume', 'n8n_data:/home/node/.n8n', 'docker.n8n.io/n8nio/n8n:2.43.6']);
}

if (!config) {
  const check = spawnSync('docker', ['inspect', 'stockflow-db'], { stdio: 'ignore' });
  if (check.status === 0) throw new Error('stockflow-db already exists without this checkout\'s runtime marker. Refusing to reuse it.');
  const password = randomBytes(24).toString('hex');
  config = {
    isolatedDemo: true,
    containerName: 'stockflow-db',
    databaseUrl: `postgresql://stockflow:${password}@localhost:55432/stock_management?schema=public`,
    jwtSecret: randomBytes(48).toString('hex'),
    initialized: false,
  };
  writeFileSync(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
  // Supply the password through the child environment, never a command argument.
  run('docker', ['run', '--detach', '--name', config.containerName, '--publish', '127.0.0.1:55432:5432', '--env', 'POSTGRES_USER=stockflow', '--env', 'POSTGRES_PASSWORD', '--env', 'POSTGRES_DB=stock_management', '--volume', 'stockflow_demo_pgdata:/var/lib/postgresql/data', 'postgres:16-alpine'], { env: { ...process.env, POSTGRES_PASSWORD: password } });
} else {
  if (!config.isolatedDemo || config.containerName !== 'stockflow-db' || new URL(config.databaseUrl).port !== '55432') throw new Error('Unexpected local runtime configuration.');
  run('docker', ['start', config.containerName]);
}

for (let attempt = 0; attempt < 60; attempt++) {
  const ping = spawnSync('docker', ['exec', config.containerName, 'pg_isready', '-U', 'stockflow', '-d', 'stock_management'], { stdio: 'ignore' });
  if (ping.status === 0) break;
  if (attempt === 59) throw new Error('Local PostgreSQL did not become ready.');
  await new Promise((resolve) => setTimeout(resolve, 500));
}
const runtimeEnv = { ...process.env, DATABASE_URL: config.databaseUrl, JWT_SECRET: config.jwtSecret, BCRYPT_SALT_ROUNDS: '12', PORT: '3001', CLIENT_URL: 'http://localhost:5173' };
const prisma = path.join(root, 'node_modules/prisma/build/index.js');
run(process.execPath, [prisma, 'generate', '--schema', 'server/prisma/schema.prisma'], { env: runtimeEnv });
if (!config.initialized) {
  // Bootstrap only our freshly created, isolated demo database using the unchanged schema.
  run(process.execPath, [prisma, 'db', 'push', '--schema', 'server/prisma/schema.prisma', '--skip-generate'], { env: runtimeEnv });
  run(process.execPath, ['prisma/seed.js'], { cwd: path.join(root, 'server'), env: runtimeEnv });
  config.initialized = true;
  writeFileSync(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
}

function background(script, cwd, env, name, args = []) {
  const out = openSync(path.join(localDir, `${name}.log`), 'a');
  const child = spawn(process.execPath, [script, ...args], { cwd, env, detached: true, stdio: ['ignore', out, out], windowsHide: true });
  child.unref();
  return child.pid;
}
if (!(await ready('http://localhost:3001/api/health'))) config.serverPid = background(path.join(root, 'server/src/index.js'), path.join(root, 'server'), runtimeEnv, 'server');
if (!(await ready('http://localhost:5173'))) config.clientPid = background(path.join(root, 'node_modules/vite/bin/vite.js'), path.join(root, 'client'), process.env, 'client', ['--host', '127.0.0.1']);
writeFileSync(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
for (let attempt = 0; attempt < 30; attempt++) {
  if (await ready('http://localhost:3001/api/health') && await ready('http://localhost:5173') && await ready('http://localhost:5678/healthz')) {
    console.log('StockFlow ready: http://localhost:5173 (API :3001, local n8n :5678, isolated demo PostgreSQL :55432).');
    process.exit(0);
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
}
throw new Error('A development service failed to start. Check .local/client.log and .local/server.log.');
