import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rm } from 'node:fs/promises';
import path from 'node:path';

const validPid = (value) => Number.isSafeInteger(value) && value > 0;
const nonempty = (value) => typeof value === 'string' && value.trim().length > 0;
const fullIdentity = (value) => value && validPid(value.pid) && nonempty(value.startedAt) && nonempty(value.script);

function inspectionError(filename, reason) {
  return new Error(`${reason} Inspect ${filename} and verify its owner has stopped before removing it manually.`);
}

async function createRecord(filename, record) {
  let handle;
  let created = false;
  try {
    handle = await open(filename, 'wx', 0o600);
    created = true;
    await handle.writeFile(`${JSON.stringify(record)}\n`);
    await handle.close();
    handle = undefined;
  } catch (error) {
    try { await handle?.close(); }
    finally { if (created) await rm(filename, { force: true }); }
    throw error;
  }
}

async function removeOwnedRecord(filename, token) {
  let record;
  try { record = JSON.parse(await readFile(filename, 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return;
    throw error;
  }
  if (record?.token === token) await rm(filename, { force: true });
}

/** Snapshots return null for a proven absent PID, or { pid, startedAt, script }. */
export async function acquireRuntimeLock({ lockPath, processSnapshot, identity } = {}) {
  if (!nonempty(lockPath) || typeof processSnapshot !== 'function' || !fullIdentity(identity)) {
    throw new Error('Runtime lock requires a path, process snapshot function, and verified PID, creation time and script.');
  }
  await mkdir(path.dirname(lockPath), { recursive: true });
  const guardPath = `${lockPath}.guard`;
  const guardToken = randomUUID();
  try { await createRecord(guardPath, { ...identity, token: guardToken }); }
  catch (error) {
    if (error.code === 'EEXIST') throw inspectionError(guardPath, 'Runtime lock guard already exists.');
    throw error;
  }

  const token = randomUUID();
  let ownsPrimary = false;
  try {
    try {
      let existing;
      try { existing = JSON.parse(await readFile(lockPath, 'utf8')); }
      catch (error) {
        if (error instanceof SyntaxError) throw inspectionError(lockPath, 'Runtime lock is incomplete or malformed.');
        if (error.code !== 'ENOENT') throw error;
      }
      if (existing !== undefined) {
        if (!fullIdentity(existing) || !nonempty(existing.token)) {
          throw inspectionError(lockPath, 'Runtime lock has incomplete or legacy owner metadata.');
        }
        let snapshot;
        try { snapshot = await processSnapshot(existing.pid); }
        catch { throw inspectionError(lockPath, 'Runtime lock owner identity could not be verified.'); }
        if (snapshot !== null) {
          if (!snapshot || snapshot.pid !== existing.pid || !nonempty(snapshot.startedAt)) {
            throw inspectionError(lockPath, 'Runtime lock owner identity is unknown.');
          }
          if (snapshot.startedAt === existing.startedAt) {
            throw inspectionError(lockPath, nonempty(snapshot.script) && snapshot.script === existing.script
              ? 'Runtime lock is held by a live owner.'
              : 'Runtime lock owner script identity could not be verified.');
          }
        }
        // Only proven absence or a different process creation time permits recovery.
        // The guard prevents another acquisition from replacing this stale record.
        await rm(lockPath);
      }
      await createRecord(lockPath, { pid: identity.pid, startedAt: identity.startedAt, script: identity.script, token });
      ownsPrimary = true;
    } finally { await removeOwnedRecord(guardPath, guardToken); }
  } catch (error) {
    if (ownsPrimary) await removeOwnedRecord(lockPath, token);
    throw error;
  }
  return async () => { await removeOwnedRecord(lockPath, token); };
}
