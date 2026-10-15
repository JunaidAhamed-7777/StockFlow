import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { validateRuntimeConfig, validateN8nContainer } from '../scripts/runtime-safety.mjs';

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const localDirectory = path.join(projectRoot, '.local');

/** CLI output may include credentials: return it only to the caller, never to logs/errors. */
export function dockerCapture(args, input) {
  const result = spawnSync('docker', args, { input, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, timeout: 120000, windowsHide: true });
  if (result.status !== 0) throw new Error('Local n8n operation failed. Sensitive subprocess output was withheld.');
  return result.stdout;
}

export function assertLocalN8n() {
  const runtime = JSON.parse(readFileSync(path.join(localDirectory, 'runtime.json'), 'utf8'));
  validateRuntimeConfig(runtime);
  validateN8nContainer(JSON.parse(dockerCapture(['inspect', 'n8n']))[0], runtime.n8nContainerId);
}

export function parseCliJson(raw, accepts) {
  for (let start = 0; typeof raw === 'string' && start < raw.length; start++) {
    if (raw[start] !== '[' && raw[start] !== '{') continue;
    const stack = [];
    let quoted = false, escaped = false;
    for (let end = start; end < raw.length; end++) {
      const char = raw[end];
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') quoted = false;
      } else if (char === '"') quoted = true;
      else if (char === '[' || char === '{') stack.push(char);
      else if (char === ']' || char === '}') {
        if (stack.pop() !== (char === ']' ? '[' : '{')) break;
        if (!stack.length) {
          try { const value = JSON.parse(raw.slice(start, end + 1)); if (accepts(value)) return value; } catch { /* Skip CLI notices. */ }
          break;
        }
      }
    }
  }
  throw new Error('Expected n8n result was not found. Sensitive subprocess output was withheld.');
}

export function exportLocalWorkflows() {
  const file = `/tmp/stockflow-inspect-${randomUUID()}.json`;
  try {
    dockerCapture(['exec', 'n8n', 'n8n', 'export:workflow', '--all', `--output=${file}`]);
    return JSON.parse(dockerCapture(['exec', 'n8n', 'node', '-e', `process.stdout.write(require('fs').readFileSync('${file}','utf8'))`]));
  } finally { dockerCapture(['exec', 'n8n', 'node', '-e', `require('fs').rmSync('${file}',{force:true})`]); }
}

export function exportLocalCredential(id) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id || '')) throw new Error('Invalid local credential ID.');
  const raw = dockerCapture(['exec', 'n8n', 'n8n', 'export:credentials', `--id=${id}`, '--decrypted']);
  return parseCliJson(raw, Array.isArray).find(value => value.id === id);
}

export function importLocalObject(kind, value) {
  if (!['workflow', 'credentials'].includes(kind)) throw new Error('Invalid n8n import type.');
  const file = `/tmp/stockflow-import-${randomUUID()}.json`;
  try {
    dockerCapture(['exec', '-i', 'n8n', 'node', '-e', `require('fs').writeFileSync('${file}',require('fs').readFileSync(0),{mode:384})`], JSON.stringify(value));
    dockerCapture(['exec', 'n8n', 'n8n', `import:${kind}`, `--input=${file}`]);
  } finally { dockerCapture(['exec', 'n8n', 'node', '-e', `require('fs').rmSync('${file}',{force:true})`]); }
}
