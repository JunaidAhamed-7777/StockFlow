import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, openSync, closeSync, unlinkSync, renameSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { validateRuntimeConfig, matchesOwnedProcess, validateDatabaseContainer, validateN8nContainer } from './runtime-safety.mjs';
import { acquireRuntimeLock } from './runtime-lock.mjs';

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function runtimeCommandIdentity(snapshot, { pid = process.pid, script = process.argv[1], cwd = process.cwd() } = {}) {
  const argument = String(snapshot?.commandLine || '').match(/^("[^"]+"|\S+)\s+("[^"]+"|\S+)(?:\s|$)/)?.[2]?.replace(/^"|"$/g, '');
  const expected = script && path.resolve(cwd, script);
  const normalized = argument && { ...snapshot, commandLine: `node "${path.resolve(cwd, argument)}"` };
  if (!snapshot?.startedAt || !expected || !normalized || !matchesOwnedProcess(normalized, { pid }, expected)) {
    throw new Error('Could not verify this runtime command identity. No mutation was attempted.');
  }
  return { pid, startedAt: snapshot.startedAt, script: expected };
}

export function saveRuntimeMarker(filename, config, replace = renameSync) {
  const content = JSON.stringify(config, null, 2);
  if (existsSync(filename) && readFileSync(filename, 'utf8') === content) return;
  const temporary = path.join(path.dirname(filename), `.${path.basename(filename)}.${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, content, { mode: 0o600, flag: 'wx' });
    replace(temporary, filename);
  } finally { if (existsSync(temporary)) unlinkSync(temporary); }
}

export function createLocalRuntime({
  root = defaultRoot, localDirectory = path.join(root, '.local'),
  capture: captureImpl, run: runImpl, processSnapshot: snapshotImpl, listenerPids: listenersImpl,
  background: backgroundImpl, spawnProcess = spawn, ready: readyImpl, kill = (pid, signal) => process.kill(pid, signal),
  wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  replaceMarker = renameSync, exists = existsSync, environment = process.env, execPath = process.execPath,
  identity, log = console.log,
} = {}) {
  const localDir = localDirectory;
  const configPath = path.join(localDir, 'runtime.json');
  const lockPath = path.join(localDir, 'runtime.lock');
  const owner = createHash('sha256').update(root.toLowerCase()).digest('hex').slice(0, 20);
  const definitions = {
    server: { port: 3001, script: path.join(root, 'server/src/index.js'), cwd: path.join(root, 'server'), url: 'http://localhost:3001/api/health', kind: 'api', args: [] },
    client: { port: 5173, script: path.join(root, 'node_modules/vite/bin/vite.js'), cwd: path.join(root, 'client'), url: 'http://localhost:5173', kind: 'client', args: ['--host', '127.0.0.1'] },
  };

  function capture(command, args, options = {}) {
    if (captureImpl) return captureImpl(command, args, options);
    return spawnSync(command, args, { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 20_000, ...options });
  }
  function run(command, args, options = {}) {
    if (runImpl) return runImpl(command, args, options);
    const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', windowsHide: true, ...options });
    if (result.error || result.status !== 0) throw new Error(`${path.basename(command)} failed. Review the command output; existing data was not deleted.`);
  }
  function inspect(type, name) {
    const result = capture('docker', [type, 'inspect', name]);
    if (result.error) throw new Error('Docker is unavailable. Start Docker Desktop and retry.');
    if (result.status !== 0) return null;
    return JSON.parse(result.stdout)[0];
  }
  function save(config) {
    saveRuntimeMarker(configPath, config, replaceMarker);
  }
  function processSnapshot(pid) {
    if (snapshotImpl) return snapshotImpl(pid);
    if (!Number.isSafeInteger(pid) || pid <= 0) return null;
    if (process.platform === 'win32') {
      const command = `$p = Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}'; if ($p) { [pscustomobject]@{pid=[int]$p.ProcessId; commandLine=$p.CommandLine; executable=$p.ExecutablePath; startedAt=$p.CreationDate.ToUniversalTime().ToString('o')} | ConvertTo-Json -Compress }`;
      const result = capture('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command]);
      if (result.error || result.status !== 0) throw new Error('Could not verify a recorded process. No unverified process was stopped.');
      return result.stdout.trim() ? JSON.parse(result.stdout) : null;
    }
    const result = capture('ps', ['-p', String(pid), '-o', 'lstart=', '-o', 'args=']);
    const line = result.stdout?.trimEnd();
    if (result.status !== 0 || !line) return null;
    const commandLine = line.slice(24).trim();
    return { pid, startedAt: line.slice(0, 24).trim(), commandLine, executable: commandLine.match(/^("[^"]+"|\S+)/)?.[0]?.replace(/^"|"$/g, '') };
  }
  function listenerPids(port) {
    if (listenersImpl) return listenersImpl(port);
    if (process.platform === 'win32') {
      const command = `@(Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique) | ConvertTo-Json -Compress`;
      const result = capture('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command]);
      if (result.error || result.status !== 0) throw new Error(`Could not inspect port ${port}; existing services were left untouched.`);
      const output = result.stdout.trim();
      return output ? [].concat(JSON.parse(output)).filter(Number.isSafeInteger) : [];
    }
    const result = capture('lsof', ['-nP', '-t', `-iTCP:${port}`, '-sTCP:LISTEN']);
    if (result.error?.code === 'ENOENT') throw new Error('Install lsof to verify local service ownership on this platform.');
    return [...new Set((result.stdout || '').trim().split(/\s+/).map(Number).filter((pid) => pid > 0))];
  }
  const marker = (config, name) => ({ pid: config?.[`${name}Pid`], startedAt: config?.[`${name}StartedAt`] });
  function ownedSnapshot(config, name) {
    const recorded = marker(config, name);
    const snapshot = processSnapshot(recorded.pid);
    return matchesOwnedProcess(snapshot, recorded, definitions[name].script) ? snapshot : null;
  }
  function verifyAppIdentities(config) {
    for (const name of Object.keys(definitions)) {
      const recorded = marker(config, name);
      const snapshot = processSnapshot(recorded.pid);
      if (snapshot && !matchesOwnedProcess(snapshot, recorded, definitions[name].script)) {
        throw new Error(`The recorded ${name} PID now belongs to a different process. It was not stopped or replaced.`);
      }
    }
  }
  function verifyPorts(config) {
    for (const [name, definition] of Object.entries(definitions)) {
      const listeners = listenerPids(definition.port);
      if (!listeners.length) continue;
      const snapshot = config ? ownedSnapshot(config, name) : null;
      if (!snapshot || listeners.some((pid) => pid !== snapshot.pid)) {
        throw new Error(`Port ${definition.port} belongs to a service not verified by this checkout's runtime marker. It was not reused or stopped.`);
      }
      config[`${name}StartedAt`] = snapshot.startedAt;
    }
  }
  async function ready(url, kind) {
    if (readyImpl) return readyImpl(url, kind);
    try {
      const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(1500) });
      if (!response.ok) return false;
      if (kind === 'client') return (await response.text()).includes('/src/main.jsx');
      const body = await response.json();
      return kind === 'api' ? body.success === true : body.status === 'ok';
    } catch { return false; }
  }
  function ensureN8n(config) {
    let container = inspect('container', 'n8n');
    if (container) {
      const id = validateN8nContainer(container, config.n8nContainerId);
      if (!container.State?.Running) run('docker', ['start', id]);
      config.n8nContainerId = id;
      return;
    }
    if (config.n8nContainerId) throw new Error('The recorded n8n container is missing. Its credential volume was preserved; no replacement was created automatically.');
    if (listenerPids(5678).length) throw new Error('Port 5678 is occupied by an unverified service. It was not stopped or reused.');
    run('docker', ['run', '--detach', '--name', 'n8n', '--restart', 'unless-stopped', '--publish', '127.0.0.1:5678:5678', '--env', 'TZ=Asia/Kolkata', '--env', 'GENERIC_TIMEZONE=Asia/Kolkata', '--volume', 'n8n_data:/home/node/.n8n', 'docker.n8n.io/n8nio/n8n:2.43.6']);
    container = inspect('container', 'n8n');
    config.n8nContainerId = validateN8nContainer(container);
  }
  function ensureDatabase(config) {
    let container = inspect('container', config.containerName);
    if (!container) {
      if (config.containerId) throw new Error('The recorded demo database container is missing. Its volume was preserved; no replacement or schema operation was attempted.');
      if (listenerPids(55432).length) throw new Error('Port 55432 is occupied by an unverified database. It was not reused.');
      const existingVolume = inspect('volume', 'stockflow_demo_pgdata');
      if (existingVolume && existingVolume.Labels?.['stockflow.owner'] !== config.owner) throw new Error('The demo volume already exists without a matching ownership label. It was not attached or modified.');
      if (!existingVolume) run('docker', ['volume', 'create', '--label', `stockflow.owner=${config.owner}`, 'stockflow_demo_pgdata']);
      const password = decodeURIComponent(validateRuntimeConfig(config).password);
      run('docker', ['run', '--detach', '--name', config.containerName, '--label', `stockflow.owner=${config.owner}`, '--publish', '127.0.0.1:55432:5432', '--env', 'POSTGRES_USER=stockflow', '--env', 'POSTGRES_PASSWORD', '--env', 'POSTGRES_DB=stock_management', '--volume', 'stockflow_demo_pgdata:/var/lib/postgresql/data', 'postgres:16-alpine'], { env: { ...environment, POSTGRES_PASSWORD: password } });
      container = inspect('container', config.containerName);
    }
    // Legacy markers are adopted only after checking image, credentials, volume and binding.
    const id = validateDatabaseContainer(container, config);
    config.containerId = id;
    if (!container.State?.Running) run('docker', ['start', id]);
  }
  async function background(name, env) {
    if (backgroundImpl) return backgroundImpl(name, env, definitions[name]);
    const definition = definitions[name];
    const output = openSync(path.join(localDir, `${name}.log`), 'a');
    let child;
    try {
      child = spawnProcess(execPath, [definition.script, ...definition.args], { cwd: definition.cwd, env, detached: true, stdio: ['ignore', output, output], windowsHide: true });
      await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    } finally { closeSync(output); }
    child.unref();
    try {
      const snapshot = processSnapshot(child.pid);
      if (!matchesOwnedProcess(snapshot, { pid: child.pid }, definition.script)) throw new Error('Unverified child');
      return snapshot;
    } catch {
      child.kill();
      throw new Error(`Could not record the new ${name} process identity. Check .local/${name}.log.`);
    }
  }
  async function stopOwnedProcess(name, recorded) {
    const snapshot = processSnapshot(recorded.pid);
    if (snapshot && !matchesOwnedProcess(snapshot, recorded, definitions[name].script)) throw new Error(`The recorded ${name} PID now belongs to a different process. It was not stopped.`);
    if (!snapshot) return;
    kill(snapshot.pid, 'SIGTERM');
    for (let attempt = 0; attempt < 30; attempt++) {
      try { kill(snapshot.pid, 0); } catch { return; }
      if (attempt === 29) throw new Error(`The verified ${name} process did not stop. It was not force-killed.`);
      await wait(100);
    }
  }
  async function stopServices(config) {
    verifyAppIdentities(config);
    for (const name of Object.keys(definitions)) {
      await stopOwnedProcess(name, marker(config, name));
      delete config[`${name}Pid`];
      delete config[`${name}StartedAt`];
      save(config);
    }
  }
  async function start(config) {
    verifyAppIdentities(config);
    verifyPorts(config);
    const docker = capture('docker', ['info', '--format', '{{.ServerVersion}}']);
    if (docker.error || docker.status !== 0) throw new Error('Docker is unavailable. Start Docker Desktop and retry.');
    if (!config) {
      if (inspect('container', 'stockflow-db') || inspect('volume', 'stockflow_demo_pgdata')) throw new Error('A demo database container or volume already exists without this checkout\'s runtime marker. It was not reused.');
      config = { isolatedDemo: true, owner, containerName: 'stockflow-db', databaseUrl: `postgresql://stockflow:${randomBytes(24).toString('hex')}@localhost:55432/stock_management?schema=public`, jwtSecret: randomBytes(48).toString('hex'), initialized: false };
      save(config);
    }
    ensureN8n(config);
    ensureDatabase(config);
    save(config);
    for (let attempt = 0; attempt < 60; attempt++) {
      const ping = capture('docker', ['exec', config.containerId, 'pg_isready', '-U', 'stockflow', '-d', 'stock_management']);
      if (ping.status === 0) break;
      if (attempt === 59) throw new Error('Local PostgreSQL did not become ready. No schema operation was attempted.');
      await wait(500);
    }
    const runtimeEnv = { ...environment, DATABASE_URL: config.databaseUrl, JWT_SECRET: config.jwtSecret, BCRYPT_SALT_ROUNDS: '12', PORT: '3001', CLIENT_URL: 'http://localhost:5173' };
    const prisma = path.join(root, 'node_modules/prisma/build/index.js');
    // Never replace an engine DLL already loaded by a running API on Windows.
    if (!exists(path.join(root, 'node_modules/.prisma/client/index.js'))) run(execPath, [prisma, 'generate', '--schema', 'server/prisma/schema.prisma'], { env: runtimeEnv });
    if (!config.initialized) {
      const tables = capture('docker', ['exec', config.containerId, 'psql', '-U', 'stockflow', '-d', 'stock_management', '-tAc', "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'"]);
      if (tables.status !== 0 || !/^\d+$/.test(tables.stdout.trim()) || Number(tables.stdout.trim()) !== 0) throw new Error('Initial setup requires an empty public schema. The non-empty demo database was not pushed or reseeded.');
      run(execPath, [prisma, 'db', 'push', '--schema', 'server/prisma/schema.prisma', '--skip-generate'], { env: runtimeEnv });
      run(execPath, ['prisma/seed.js'], { cwd: path.join(root, 'server'), env: runtimeEnv });
      config.initialized = true;
      save(config);
    }
    for (const name of Object.keys(definitions)) {
      if (!ownedSnapshot(config, name)) {
        const snapshot = await background(name, name === 'server' ? runtimeEnv : environment);
        config[`${name}Pid`] = snapshot.pid;
        config[`${name}StartedAt`] = snapshot.startedAt;
        try { save(config); }
        catch (error) {
          // A detached child must not remain unrecorded when publishing its
          // identity fails. Recheck its creation time before touching it.
          await stopOwnedProcess(name, snapshot);
          throw error;
        }
      }
    }
    for (let attempt = 0; attempt < 40; attempt++) {
      const health = await Promise.all([ready(definitions.server.url, 'api'), ready(definitions.client.url, 'client'), ready('http://localhost:5678/healthz', 'n8n')]);
      if (health.every(Boolean)) {
        verifyPorts(config);
        save(config);
        log('StockFlow ready: http://localhost:5173 (API :3001, n8n :5678, isolated demo PostgreSQL :55432).');
        return { ready: true };
      }
      if (attempt === 39) throw new Error('A development service failed to become ready. Check .local/client.log and .local/server.log; use restart to retry verified app processes.');
      await wait(500);
    }
  }
  function loadConfig() {
    let config = null;
    if (existsSync(configPath)) {
      try { config = JSON.parse(readFileSync(configPath, 'utf8')); }
      catch { throw new Error('The private runtime marker could not be read. It was not replaced; inspect .local/runtime.json locally.'); }
      validateRuntimeConfig(config);
    }
    return config;
  }
  function lockSnapshot(pid) {
    const snapshot = processSnapshot(pid);
    if (snapshot === null) return null;
    if (!snapshot) return undefined;
    const script = snapshot.script || String(snapshot.commandLine || '').match(/^("[^"]+"|\S+)\s+("[^"]+"|\S+)(?:\s|$)/)?.[2]?.replace(/^"|"$/g, '');
    return { pid: snapshot.pid, startedAt: snapshot.startedAt, script };
  }
  function commandIdentity() {
    if (identity) return identity;
    return runtimeCommandIdentity(processSnapshot(process.pid));
  }
  async function execute(mode = 'start') {
    if (!['start', 'stop', 'restart', 'status'].includes(mode)) throw new Error('Usage: node scripts/local-runtime.mjs [start|stop|restart|status]');
    if (mode === 'status') {
      const config = loadConfig();
      const health = await Promise.all([ready(definitions.server.url, 'api'), ready(definitions.client.url, 'client'), ready('http://localhost:5678/healthz', 'n8n')]);
      const status = { configured: Boolean(config), api: { healthy: health[0], owned: Boolean(config && ownedSnapshot(config, 'server')) }, client: { healthy: health[1], owned: Boolean(config && ownedSnapshot(config, 'client')) }, n8nHealthy: health[2] };
      log(JSON.stringify(status, null, 2));
      return status;
    }
    mkdirSync(localDir, { recursive: true });
    const release = await acquireRuntimeLock({ lockPath, identity: commandIdentity(), processSnapshot: lockSnapshot });
    try {
      // Read and validate only after exclusive acquisition; earlier commands may
      // have refreshed process IDs or credentials while this command was waiting.
      const config = loadConfig();
      if (mode === 'stop' || mode === 'restart') {
        if (config) await stopServices(config);
        if (mode === 'stop') {
          log('Verified StockFlow app processes stopped. The n8n and database containers remain available.');
          return { stopped: true };
        }
      }
      return await start(config);
    } finally { await release(); }
  }
  return { execute, definitions, configPath, lockPath };
}
