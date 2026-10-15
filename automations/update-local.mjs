import { randomUUID, createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { validateRuntimeConfig, validateN8nContainer } from '../scripts/runtime-safety.mjs';
import { validateDiscordCredential, assertConfirmedDiscordTest } from './discord-config.mjs';
import { dockerCapture as defaultDockerCapture, exportLocalCredential } from './local-n8n.mjs';
import { WORKFLOW_MODES, assertSafePreviewSource, previewWorkflowFingerprint } from './verify-local.mjs';

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
class UpdateLocalError extends Error {}
const fail = (message) => { throw new UpdateLocalError(message); };
const canonical = (value) => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
const hash = (value) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const validCredentialId = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);

function publishedVersionMatches(workflow) {
  if (workflow.active !== true) return false;
  if (Object.hasOwn(workflow, 'activeVersionId')) {
    if (typeof workflow.activeVersionId !== 'string' || !workflow.activeVersionId) return false;
    if (Object.hasOwn(workflow, 'versionId') && workflow.versionId !== workflow.activeVersionId) return false;
  }
  if (Object.hasOwn(workflow, 'activeVersion')) {
    const version = workflow.activeVersion;
    if (!version || typeof version !== 'object' || Array.isArray(version) || !Array.isArray(version.nodes)
      || !version.connections || typeof version.connections !== 'object' || Array.isArray(version.connections)) return false;
    if (Object.hasOwn(version, 'versionId') && workflow.activeVersionId && version.versionId !== workflow.activeVersionId) return false;
    if (Object.hasOwn(version, 'nodes') && hash(version.nodes) !== hash(workflow.nodes)) return false;
    if (Object.hasOwn(version, 'connections') && hash(version.connections) !== hash(workflow.connections)) return false;
  }
  return true;
}

/** Apply local notification templates; injected boundaries permit offline fixture verification. */
export async function updateLocal({
  root = defaultRoot, args = [], dockerCapture = defaultDockerCapture, exportCredential = exportLocalCredential,
  fetchImpl = globalThis.fetch, wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  log = console.log,
} = {}) {
  try {
    const local = path.join(root, '.local');
    const flags = ['--apply', '--enable-low-stock', '--defer-restart'];
    if (!Array.isArray(args) || args.some((value) => typeof value !== 'string' || (!flags.includes(value) && !value.startsWith('--discord-credential-id=')))) {
      fail('Usage: node automations/update-local.mjs [--apply] [--enable-low-stock] [--discord-credential-id=ID] [--defer-restart]');
    }
    const idOptions = args.filter((value) => value.startsWith('--discord-credential-id='));
    if (idOptions.length > 1 || (idOptions.length && !validCredentialId(idOptions[0].slice('--discord-credential-id='.length)))) fail('A single valid Discord credential ID is required.');
    const enableLowStock = args.includes('--enable-low-stock');
    const apply = args.includes('--apply');
    const deferRestart = args.includes('--defer-restart');
    if (enableLowStock && deferRestart) fail('Live activation must include a restart and verification.');

    const sourceDirectory = path.join(root, 'automations/workflows');
    const files = readdirSync(sourceDirectory).filter((filename) => /^stockflow-[a-z-]+\.json$/.test(filename));
    const sources = files.map((filename) => JSON.parse(readFileSync(path.join(sourceDirectory, filename), 'utf8')));
    const expectedIds = Object.keys(WORKFLOW_MODES);
    if (sources.length !== expectedIds.length || new Set(sources.map((source) => source?.id)).size !== expectedIds.length
      || sources.some((source) => typeof source?.id !== 'string' || !Object.hasOwn(WORKFLOW_MODES, source.id))) fail('Exactly five unique, known StockFlow notification source IDs are required.');
    for (const source of sources) {
      try { assertSafePreviewSource(source, WORKFLOW_MODES[source.id]); }
      catch { fail('A notification source is not a safe disabled-delivery preview template. No workflow was imported.'); }
    }

    const runtime = JSON.parse(readFileSync(path.join(local, 'runtime.json'), 'utf8'));
    validateRuntimeConfig(runtime);
    const docker = async (command, input) => {
      try { return await dockerCapture(command, input); }
      catch { fail('Local n8n operation failed. Sensitive subprocess output was withheld.'); }
    };
    validateN8nContainer(JSON.parse(await docker(['inspect', 'n8n']))[0], runtime.n8nContainerId);
    const batch = randomUUID();
    async function exportWorkflows(label) {
      const filename = `/tmp/stockflow-${label}-${batch}.json`;
      try {
        await docker(['exec', 'n8n', 'n8n', 'export:workflow', '--all', `--output=${filename}`]);
        const workflows = JSON.parse(await docker(['exec', 'n8n', 'node', '-e', `process.stdout.write(require('fs').readFileSync('${filename}','utf8'))`]));
        if (!Array.isArray(workflows) || workflows.some((workflow) => !workflow || typeof workflow.id !== 'string' || !workflow.id)
          || new Set(workflows.map((workflow) => workflow.id)).size !== workflows.length) fail('The local workflow export has invalid or ambiguous workflow IDs.');
        return workflows;
      } finally { await docker(['exec', 'n8n', 'node', '-e', `require('fs').rmSync('${filename}',{force:true})`]); }
    }
    const current = await exportWorkflows('update');
    const byId = new Map(current.map((workflow) => [workflow.id, workflow]));
    const credentialId = idOptions[0]?.slice('--discord-credential-id='.length)
      || byId.get('StockFlowCritical01')?.nodes?.find((node) => node.name === 'Send Discord notification')?.credentials?.discordWebhookApi?.id;
    let discord;
    let confirmation;
    if (credentialId !== undefined) {
      if (!validCredentialId(credentialId)) fail('A valid local Discord credential ID is required.');
      try { discord = validateDiscordCredential(await exportCredential(credentialId), credentialId); }
      catch { fail('The local Discord credential could not be verified. Credential secrets were withheld.'); }
    }
    if (enableLowStock) {
      if (!discord) fail('Configure and test the Discord webhook before enabling delivery.');
      try { confirmation = assertConfirmedDiscordTest(JSON.parse(readFileSync(path.join(local, 'discord-connection-test.json'), 'utf8')), discord); }
      catch { fail('A confirmed Discord test for this exact webhook, with message and channel IDs, is required before activation.'); }
    }
    const prepared = sources.map((source) => {
      const previous = byId.get(source.id);
      source.staticData = previous?.staticData ?? null;
      const loginCredential = previous?.nodes?.find((node) => node.name === 'StockFlow login')?.credentials;
      if (loginCredential) source.nodes.find((node) => node.name === 'StockFlow login').credentials = loginCredential;
      if (discord) source.nodes.find((node) => node.name === 'Send Discord notification').credentials = { discordWebhookApi: { id: discord.id, name: discord.name } };
      if (enableLowStock && source.id === 'StockFlowCritical01') {
        const settings = source.nodes.find((node) => node.name === 'Settings').parameters;
        settings.jsCode = settings.jsCode.replace('notificationsEnabled: false', 'notificationsEnabled: true');
      }
      return source;
    });
    const summary = { apply, provider: 'Discord', destination: 'one configured channel', workflows: prepared.map((workflow) => ({
      id: workflow.id, name: workflow.name, deliveryEnabled: enableLowStock && workflow.id === 'StockFlowCritical01', existingStatePreserved: byId.has(workflow.id),
    })) };
    log(JSON.stringify(summary, null, 2));
    if (!apply) return summary;

    const backup = path.join(local, 'n8n-backups', batch);
    mkdirSync(backup, { recursive: true });
    writeFileSync(path.join(backup, 'previous-workflows.json'), JSON.stringify(current, null, 2), { mode: 0o600 });
    for (const workflow of prepared) {
      const filename = `/tmp/stockflow-import-${batch}.json`;
      try {
        await docker(['exec', '-i', 'n8n', 'node', '-e', `require('fs').writeFileSync('${filename}',require('fs').readFileSync(0),{mode:384})`], JSON.stringify(workflow));
        await docker(['exec', 'n8n', 'n8n', 'import:workflow', `--input=${filename}`]);
        await docker(['exec', 'n8n', 'n8n', 'publish:workflow', `--id=${workflow.id}`]);
      } finally { await docker(['exec', 'n8n', 'node', '-e', `require('fs').rmSync('${filename}',{force:true})`]); }
    }
    const stored = new Map((await exportWorkflows('verify-update')).map((workflow) => [workflow.id, workflow]));
    for (const expected of prepared) {
      const actual = stored.get(expected.id);
      if (!actual || hash(actual.nodes) !== hash(expected.nodes) || hash(actual.connections) !== hash(expected.connections)
        || hash(actual.staticData ?? null) !== hash(expected.staticData ?? null)
        || hash(previewWorkflowFingerprint(actual).settings) !== hash(previewWorkflowFingerprint(expected).settings)
        || hash(actual.pinData ?? {}) !== hash(expected.pinData ?? {}) || !publishedVersionMatches(actual)) fail('Stored workflow verification failed. Delivery status was not marked enabled.');
    }
    if (!deferRestart) {
      await docker(['restart', 'n8n']);
      let healthy = false;
      for (let attempt = 0; attempt < 40; attempt++) {
        try { healthy = (await fetchImpl('http://localhost:5678/healthz', { redirect: 'error', signal: AbortSignal.timeout(1500) })).ok === true; }
        catch { /* Wait for the restarted instance without disclosing transport errors. */ }
        if (healthy) break;
        await wait(500);
      }
      if (!healthy) fail('n8n did not become healthy after publishing. Check local Docker logs.');
    }
    writeFileSync(path.join(local, 'automation-status.json'), JSON.stringify({
      installedAt: new Date().toISOString(), workflows: prepared.map((workflow) => workflow.id), deliveryMode: 'discord', destination: summary.destination,
      enabledWorkflows: enableLowStock ? ['StockFlowCritical01'] : [], restartPending: deferRestart,
      discordCredentialId: discord?.id || null, channelId: confirmation?.channelId || null, gmailCanceled: true,
      reason: enableLowStock ? 'Critical-stock alerts enabled for the confirmed Discord channel. All other workflows remain previews.' : 'Discord workflows installed with delivery disabled.', openAiCalls: 0,
    }, null, 2), { mode: 0o600 });
    log('Local workflow update complete. Existing delivery markers and order baselines were preserved.');
    return summary;
  } catch (error) {
    if (error instanceof UpdateLocalError) throw error;
    throw new UpdateLocalError('Local n8n update failed. Sensitive local data and subprocess output were withheld.');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    // Generation belongs to the CLI; importing updateLocal has no filesystem or Docker side effects.
    await import('./build-workflows.mjs');
    await updateLocal({ args: process.argv.slice(2) });
  } catch (error) {
    console.error(error instanceof UpdateLocalError ? error.message : 'Local n8n update failed. Sensitive local data and subprocess output were withheld.');
    process.exitCode = 1;
  }
}
