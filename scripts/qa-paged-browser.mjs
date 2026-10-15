// Production frontend + the disposable API from qa-paged-api. No retained API.
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, realpath, stat, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { runIsolated } from './qa-paged-api.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };

export function browserApiTarget(base) {
  const target = new URL(base);
  if (target.protocol !== 'http:' || target.hostname !== '127.0.0.1' || !target.port
    || target.pathname !== '/api' || target.username || target.password || target.search || target.hash) throw new Error('An isolated loopback API is required.');
  return target;
}

export async function createBrowserBridge({ base, distRoot = path.join(ROOT, 'client/dist') }) {
  const api = browserApiTarget(base);
  const root = await realpath(distRoot);
  const report = { isolated: true, requests: {}, responseBytes: 0, failuresInjected: 0 };
  let failProducts = false;
  const server = http.createServer(async (req, res) => {
    const send = (status, body, type = 'application/json') => {
      res.writeHead(status, { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' });
      res.end(req.method === 'HEAD' ? undefined : typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
    };
    try {
      const origin = `http://127.0.0.1:${server.address().port}`;
      if (req.headers.host !== new URL(origin).host || (req.headers.origin && req.headers.origin !== origin) || !req.url.startsWith('/') || req.url.startsWith('//')) return send(403, { message: 'Local QA origin required.' });
      const url = new URL(req.url, origin);
      if (url.pathname === '/__qa') return send(200, { ...report, failProducts });
      if (url.pathname === '/__qa/product-availability' && req.method === 'POST') {
        failProducts = url.searchParams.get('fail') === 'true';
        return send(200, { failProducts });
      }
      if (url.pathname.startsWith('/api/')) {
        // AI/model/automation routes are deliberately absent from this bridge.
        if (!/^\/api\/(?:auth\/(?:login|me)|users\/me|products(?:\/\d+)?|orders(?:\/\d+(?:\/status)?)?|discovery\/(?:categories|suppliers(?:\/\d+)?)|dashboard|stock\/(?:low-stock|transactions|add|remove))$/.test(url.pathname)) return send(404, { message: 'No isolated browser route.' });
        if (failProducts && url.pathname === '/api/products') { report.failuresInjected++; return send(503, { message: 'Injected isolated QA product outage.' }); }
        let bytes = 0;
        const chunks = [];
        for await (const chunk of req) { bytes += chunk.length; if (bytes > 32_768) return send(413, { message: 'QA request too large.' }); chunks.push(chunk); }
        const target = new URL(`${url.pathname}${url.search}`, api.origin);
        const response = await fetch(target, { method: req.method, redirect: 'error', signal: AbortSignal.timeout(15_000),
          headers: { ...(req.headers.authorization ? { authorization: req.headers.authorization } : {}), ...(req.headers['content-type'] ? { 'content-type': req.headers['content-type'] } : {}) },
          body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) });
        const body = Buffer.from(await response.arrayBuffer());
        report.requests[url.pathname] = (report.requests[url.pathname] || 0) + 1;
        report.responseBytes += body.length;
        return send(response.status, body, response.headers.get('content-type')?.split(';')[0] || 'application/json');
      }
      if (!['GET', 'HEAD'].includes(req.method)) return send(405, { message: 'Read-only static assets.' });
      let target = path.resolve(root, `.${decodeURIComponent(url.pathname)}`);
      if (!target.startsWith(`${root}${path.sep}`)) return send(400, { message: 'Invalid asset path.' });
      try { if (!(await stat(target)).isFile()) target = path.join(root, 'index.html'); }
      catch { if (path.extname(target)) return send(404, { message: 'Asset not found.' }); target = path.join(root, 'index.html'); }
      if (!(await realpath(target)).startsWith(`${root}${path.sep}`)) return send(403, { message: 'Asset outside build.' });
      return send(200, await readFile(target), types[path.extname(target)] || 'application/octet-stream');
    } catch { return send(502, { message: 'The isolated QA service is unavailable.' }); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { server, url: `http://127.0.0.1:${server.address().port}`, report };
}

async function main() {
  if (process.argv.length !== 3 || process.argv[2] !== '--run-isolated') throw new Error('Usage: node scripts/qa-paged-browser.mjs --run-isolated');
  await runIsolated({ evidencePath: path.join(ROOT, 'artifacts/qa/paged-api.json'), onReady: async ({ base, accounts, signal }) => {
    const bridge = await createBrowserBridge({ base });
    const directory = await mkdtemp(path.join(tmpdir(), 'stockflow-paged-browser-'));
    try {
      const privateLoginFile = path.join(directory, 'accounts.json');
      await writeFile(privateLoginFile, JSON.stringify(accounts), { mode: 0o600 });
      console.log(JSON.stringify({ browserUrl: bridge.url, privateLoginFile, isolated: true, stop: 'Ctrl+C cleans up only this disposable run.' }));
      await new Promise((resolve) => { if (signal.aborted) resolve(); else signal.addEventListener('abort', resolve, { once: true }); });
    } finally {
      bridge.server.closeAllConnections();
      await new Promise((resolve) => bridge.server.close(resolve));
      const resolved = path.resolve(directory);
      if (!resolved.startsWith(`${path.resolve(tmpdir())}${path.sep}`) || !path.basename(resolved).startsWith('stockflow-paged-browser-')) throw new Error('Unexpected private QA directory.');
      await rm(resolved, { recursive: true, force: true });
    }
  } });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
