import { createLocalRuntime } from './local-runtime-core.mjs';

async function main() {
  const mode = process.argv[2] || 'start';
  if (!['start', 'stop', 'restart', 'status'].includes(mode) || process.argv.length > 3) {
    throw new Error('Usage: node scripts/local-runtime.mjs [start|stop|restart|status]');
  }
  await createLocalRuntime().execute(mode);
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
