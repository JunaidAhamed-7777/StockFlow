import path from 'node:path';

export function validateRuntimeConfig(config) {
  let url;
  try { url = new URL(config?.databaseUrl); } catch { throw new Error('Invalid local runtime marker.'); }
  if (config?.isolatedDemo !== true || config.containerName !== 'stockflow-db'
    || url.protocol !== 'postgresql:' || !['localhost', '127.0.0.1'].includes(url.hostname)
    || url.port !== '55432' || url.username !== 'stockflow' || url.pathname !== '/stock_management'
    || !url.password || url.searchParams.get('schema') !== 'public'
    || typeof config.jwtSecret !== 'string' || config.jwtSecret.length < 32
    || typeof config.initialized !== 'boolean') {
    throw new Error('Unexpected runtime marker. Only this checkout’s isolated loopback demo database is supported.');
  }
  return url;
}

const canonical = (value) => String(value || '').replaceAll('/', '\\').toLowerCase();

export function matchesOwnedProcess(snapshot, marker, expectedScript) {
  if (!snapshot || !Number.isSafeInteger(marker?.pid) || marker.pid <= 0 || snapshot.pid !== marker.pid) return false;
  if (marker.startedAt && marker.startedAt !== snapshot.startedAt) return false;
  const executable = path.win32.basename(snapshot.executable || '').toLowerCase();
  if (!['node.exe', 'node'].includes(executable)) return false;
  // Require the actual script argument, rather than a path mentioned in eval text.
  const args = String(snapshot.commandLine || '').match(/^("[^"]+"|\S+)\s+("[^"]+"|\S+)(?:\s|$)/);
  const script = args?.[2]?.replace(/^"|"$/g, '');
  return Boolean(script && canonical(script) === canonical(expectedScript));
}

export function validateDatabaseContainer(container, config) {
  const url = validateRuntimeConfig(config);
  const env = Object.fromEntries((container?.Config?.Env || []).map((entry) => {
    const split = entry.indexOf('=');
    return [entry.slice(0, split), entry.slice(split + 1)];
  }));
  const bindings = container?.HostConfig?.PortBindings?.['5432/tcp'] || [];
  const volume = container?.Mounts?.find((mount) => mount.Destination === '/var/lib/postgresql/data');
  if (!container?.Id || (config.containerId && config.containerId !== container.Id)
    || container.Config?.Image !== 'postgres:16-alpine'
    || bindings.length !== 1 || bindings[0].HostIp !== '127.0.0.1' || bindings[0].HostPort !== '55432'
    || volume?.Name !== 'stockflow_demo_pgdata' || volume.Type !== 'volume'
    || env.POSTGRES_USER !== 'stockflow' || env.POSTGRES_DB !== 'stock_management'
    || env.POSTGRES_PASSWORD !== decodeURIComponent(url.password)) {
    throw new Error('The database container does not match this checkout’s isolated runtime marker. No schema or seed operation was attempted.');
  }
  return container.Id;
}

export function validateN8nContainer(container, expectedId) {
  const image = String(container?.Config?.Image || '');
  const bindings = container?.HostConfig?.PortBindings?.['5678/tcp'] || [];
  const persistent = container?.Mounts?.some((mount) => mount.Destination === '/home/node/.n8n'
    && ((mount.Type === 'volume' && typeof mount.Name === 'string' && mount.Name.trim())
      || (mount.Type === 'bind' && typeof mount.Source === 'string' && mount.Source.trim())));
  if (!container?.Id || (expectedId && expectedId !== container.Id)
    || !/^(docker\.n8n\.io\/)?n8nio\/n8n(?::|@|$)/.test(image)
    || !bindings.some((binding) => binding.HostPort === '5678') || !persistent) {
    throw new Error('The n8n container identity or persistent credential volume could not be verified. Existing containers were left untouched.');
  }
  return container.Id;
}
