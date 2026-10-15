import { randomUUID, createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, readdirSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { validateRuntimeConfig, validateN8nContainer } from '../scripts/runtime-safety.mjs';
import { validateDiscordCredential, assertConfirmedDiscordTest } from './discord-config.mjs';
import { dockerCapture as defaultDockerCapture, exportLocalCredential } from './local-n8n.mjs';
import { WORKFLOW_MODES, assertSafePreviewSource, previewWorkflowFingerprint } from './verify-local.mjs';
import { createNotificationMaintenance } from './notification-maintenance.mjs';

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
class UpdateLocalError extends Error {}
const fail = (message) => { throw new UpdateLocalError(message); };
const canonical = (value) => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
const hash = (value) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const validCredentialId = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);

function acquireUpdateLock(local) {
  const filename = path.join(local, 'notification-update.lock');
  const owner = { pid: process.pid, token: randomUUID() };
  let descriptor;
  try { descriptor = openSync(filename, 'wx', 0o600); }
  catch { fail('Another notification migration or an unresolved prior lock exists. Inspect the private notification-update lock before retrying.'); }
  try { writeFileSync(descriptor, JSON.stringify(owner)); }
  finally { closeSync(descriptor); }
  return () => {
    let current;
    try { current = JSON.parse(readFileSync(filename, 'utf8')); }
    catch { fail('Notification migration lock ownership could not be verified for release. Inspect the private lock before retrying.'); }
    if (current.pid !== owner.pid || current.token !== owner.token) fail('Notification migration lock ownership changed. The replacement lock was preserved.');
    unlinkSync(filename);
  };
}

function publishedVersionMatches(workflow) {
  if (workflow.active !== true || typeof workflow.versionId !== 'string' || !workflow.versionId
    || workflow.activeVersionId !== workflow.versionId) return false;
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

const settingsHash = (settings) => hash({ ...settings, availableInMCP: settings?.availableInMCP === true, errorWorkflow: settings?.errorWorkflow || '' });

function requireManaged(workflows) {
  const selected = Object.keys(WORKFLOW_MODES).map((id) => workflows.find((workflow) => workflow.id === id));
  if (selected.some((workflow) => !workflow)) fail('All five installed notification workflows are required for migration. Use the installer for missing workflows. No workflow was imported.');
  return selected;
}

function preserveSettings(source, previous) {
  const settings = previous.settings;
  const allowed = new Set([...Object.keys(source.settings), 'availableInMCP', 'errorWorkflow']);
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)
    || Object.keys(settings).some((key) => !allowed.has(key)) || settings.availableInMCP === true
    || hash(previewWorkflowFingerprint({ ...source, settings }).settings) !== hash(previewWorkflowFingerprint(source).settings)) {
    fail('Installed notification settings differ from the reviewed settings. No workflow was imported.');
  }
  const pins = previous.pinData;
  if (pins != null && (typeof pins !== 'object' || Array.isArray(pins) || Object.keys(pins).length)) fail('Installed notification pinned data must be reviewed before migration. No workflow was imported.');
  return { settings: structuredClone(settings), pinData: pins === undefined ? {} : structuredClone(pins) };
}

function verifyStored(expectedWorkflows, workflows, { published = true } = {}) {
  const stored = new Map(workflows.map((workflow) => [workflow.id, workflow]));
  for (const expected of expectedWorkflows) {
    const actual = stored.get(expected.id);
    if (!actual || hash(actual.nodes) !== hash(expected.nodes) || hash(actual.connections) !== hash(expected.connections)
      || hash(actual.staticData ?? null) !== hash(expected.staticData ?? null)
      || settingsHash(actual.settings) !== settingsHash(expected.settings)
      || hash(actual.pinData ?? {}) !== hash(expected.pinData ?? {})
      || (published ? !publishedVersionMatches(actual) : actual.active !== false || actual.activeVersionId !== null || typeof actual.versionId !== 'string' || !actual.versionId)) fail('Stored workflow verification failed. Delivery status was not marked enabled.');
  }
}

/** Apply local notification templates; injected boundaries permit offline fixture verification. */
export async function updateLocal({
  root = defaultRoot, args = [], dockerCapture = defaultDockerCapture, exportCredential = exportLocalCredential,
  fetchImpl = globalThis.fetch, wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  maintenanceFactory = createNotificationMaintenance,
  log = console.log,
} = {}) {
  let releaseLock;
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
    if (apply) releaseLock = acquireUpdateLock(local);
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
    requireManaged(current);
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
    const prepare = (workflows) => {
      const managed = new Map(requireManaged(workflows).map((workflow) => [workflow.id, workflow]));
      return sources.map((template) => {
        const source = structuredClone(template);
        const previous = managed.get(source.id);
        Object.assign(source, preserveSettings(source, previous));
        if (previous.staticData != null && (typeof previous.staticData !== 'object' || Array.isArray(previous.staticData))) fail('Installed notification state is invalid. No workflow was imported.');
        source.staticData = structuredClone(previous.staticData ?? null);
        const logins = previous.nodes?.filter((node) => node.name === 'StockFlow login') || [];
        const loginCredential = logins.length === 1 ? logins[0].credentials : null;
        if (!validCredentialId(loginCredential?.httpCustomAuth?.id)) fail('Each installed notification requires its existing API login binding. No workflow was imported.');
        source.nodes.find((node) => node.name === 'StockFlow login').credentials = structuredClone(loginCredential);
        const transports = previous.nodes?.filter((node) => node.name === 'Send Discord notification') || [];
        if (transports.length !== 1) fail('Installed Discord bindings are ambiguous. No workflow was imported.');
        const reference = transports[0].credentials?.discordWebhookApi;
        if (reference && (!discord || reference.id !== discord.id)) fail('Installed Discord bindings differ from the selected credential. No workflow was imported.');
        if (discord) source.nodes.find((node) => node.name === 'Send Discord notification').credentials = reference
          ? structuredClone(transports[0].credentials) : { discordWebhookApi: { id: discord.id, name: discord.name } };
        if (enableLowStock && source.id === 'StockFlowCritical01') {
          const settings = source.nodes.find((node) => node.name === 'Settings').parameters;
          settings.jsCode = settings.jsCode.replace('notificationsEnabled: false', 'notificationsEnabled: true');
        }
        return source;
      });
    };
    let prepared = prepare(current);
    const summary = { apply, provider: 'Discord', destination: 'one configured channel', workflows: prepared.map((workflow) => ({
      id: workflow.id, name: workflow.name, deliveryEnabled: enableLowStock && workflow.id === 'StockFlowCritical01', existingStatePreserved: byId.has(workflow.id),
    })) };
    log(JSON.stringify(summary, null, 2));
    if (!apply) return summary;

    const backup = path.join(local, 'n8n-backups', batch);
    mkdirSync(backup, { recursive: true });
    writeFileSync(path.join(backup, 'previous-workflows.json'), JSON.stringify(current, null, 2), { mode: 0o600 });
    const maintenance = maintenanceFactory({ root, fetchImpl, wait });
    let paused = false;
    let restartAttempted = false;
    let workflowWritesStarted = false;
    const statusPath = path.join(local, 'automation-status.json');
    const writeMaintenanceStatus = (state, enabledWorkflows, reason) => writeFileSync(statusPath, JSON.stringify({
      updatedAt: new Date().toISOString(), workflows: expectedIds, deliveryMode: 'discord', destination: summary.destination,
      maintenanceState: state, enabledWorkflows, deliveryVerified: false, schedulesPaused: paused,
      restartPending: true, discordCredentialId: discord?.id || null, reason, openAiCalls: 0,
    }, null, 2), { mode: 0o600 });
    // Record uncertainty before a helper can remove its first schedule. Never retain a stale enabled claim.
    writeMaintenanceStatus('quiescing', null, 'Notification maintenance started. Delivery is not verified until the migration completes.');
    try {
      await maintenance.quiesce(requireManaged(current));
      paused = true;
      writeMaintenanceStatus('paused', [], 'The five notification schedules are paused while reviewed definitions are migrated.');
      const fresh = await exportWorkflows('quiesced');
      prepared = prepare(fresh);
      writeFileSync(path.join(backup, 'quiesced-workflows.json'), JSON.stringify(fresh, null, 2), { mode: 0o600 });
      for (const workflow of prepared) {
        const filename = `/tmp/stockflow-import-${batch}.json`;
        try {
          await docker(['exec', '-i', 'n8n', 'node', '-e', `require('fs').writeFileSync('${filename}',require('fs').readFileSync(0),{mode:384})`], JSON.stringify(workflow));
          workflowWritesStarted = true;
          await docker(['exec', 'n8n', 'n8n', 'import:workflow', `--input=${filename}`]);
        } finally { await docker(['exec', 'n8n', 'node', '-e', `require('fs').rmSync('${filename}',{force:true})`]); }
      }
      // Verify every imported graph and the drained state before any schedule can resume.
      verifyStored(prepared, await exportWorkflows('verify-unpublished'), { published: false });
      paused = false;
      writeMaintenanceStatus('publishing-unverified', null, 'All five imported definitions were verified. Publication may resume schedules before restart; activation and delivery are not yet verified.');
      for (const workflow of prepared) {
        await docker(['exec', 'n8n', 'n8n', 'publish:workflow', `--id=${workflow.id}`]);
      }
      verifyStored(prepared, await exportWorkflows('verify-update'));
      if (!deferRestart) {
        restartAttempted = true;
        paused = false;
        writeMaintenanceStatus('restarting-unverified', null, 'n8n is restarting with migrated definitions. Schedule and delivery state have not yet been verified.');
        await docker(['restart', 'n8n']);
        let healthy = false;
        for (let attempt = 0; attempt < 40; attempt++) {
          try { healthy = (await fetchImpl('http://localhost:5678/healthz/readiness', { redirect: 'error', signal: AbortSignal.timeout(1500) })).ok === true; }
          catch { /* Wait for readiness without disclosing transport errors. */ }
          if (healthy) break;
          await wait(500);
        }
        if (!healthy) fail('n8n did not become ready after publishing. Notification maintenance did not complete.');
        verifyStored(prepared, await exportWorkflows('verify-restart'));
        await maintenance.verifyActive(expectedIds);
      }
      writeFileSync(statusPath, JSON.stringify({
        installedAt: new Date().toISOString(), workflows: prepared.map((workflow) => workflow.id), deliveryMode: 'discord', destination: summary.destination,
        enabledWorkflows: enableLowStock ? ['StockFlowCritical01'] : [], restartPending: deferRestart,
        maintenanceState: deferRestart ? 'published-pending-restart' : 'complete', schedulesPaused: paused, deliveryVerified: !deferRestart,
        discordCredentialId: discord?.id || null, channelId: confirmation?.channelId || null, gmailCanceled: true,
        reason: deferRestart ? 'Preview definitions are published and schedules may be active. A controlled restart and verification are still required.'
          : enableLowStock ? 'Critical-stock alerts enabled for the confirmed Discord channel. All other workflows remain previews.' : 'Discord workflows installed with delivery disabled.', openAiCalls: 0,
      }, null, 2), { mode: 0o600 });
    } catch (error) {
      if (restartAttempted || workflowWritesStarted) {
        try { await maintenance.quiesce(requireManaged(await exportWorkflows('pause-failed-update'))); paused = true; }
        catch (pauseError) { paused = pauseError?.paused === true; }
      } else if (error?.paused === true) paused = true;
      writeMaintenanceStatus(paused ? 'paused-after-failure' : 'failed-unverified', paused ? [] : null,
        paused ? 'Migration failed. The notification schedules remain paused; inspect the backup before retrying. No definitions were restored automatically.'
          : 'Migration failed and schedule state could not be verified. Inspect the five notification workflows before retrying. No definitions were restored automatically.');
      if (error instanceof UpdateLocalError) throw error;
      fail(paused ? 'Notification migration failed. The five schedules remain paused; inspect the private backup before retrying.'
        : 'Notification migration failed. Schedule state is unverified; inspect the five notification workflows before retrying. Sensitive output was withheld.');
    }
    log('Local workflow update complete. Existing delivery markers and order baselines were preserved.');
    return summary;
  } catch (error) {
    if (error instanceof UpdateLocalError) throw error;
    throw new UpdateLocalError('Local n8n update failed. Sensitive local data and subprocess output were withheld.');
  } finally {
    releaseLock?.();
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
