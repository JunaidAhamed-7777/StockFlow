import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { acquireRuntimeLock } from './runtime-lock.mjs';

const identity = { pid: 101, startedAt: 'fixture-current-creation', script: 'C:\\fixture\\runtime.mjs' };
const previous = { pid: 202, startedAt: 'fixture-old-creation', script: identity.script, token: 'fixture-old-token' };

async function fixture(t) {
  const prefix = path.join(tmpdir(), 'stockflow-runtime-lock-');
  const directory = await mkdtemp(prefix);
  t.after(async () => {
    assert.ok(directory.startsWith(prefix));
    await rm(directory, { recursive: true, force: true });
  });
  const lockPath = path.join(directory, 'runtime.lock');
  return {
    lockPath, guardPath: `${lockPath}.guard`,
    options: { lockPath, identity, processSnapshot: () => null },
    writePrimary: (value) => writeFile(lockPath, typeof value === 'string' ? value : JSON.stringify(value)),
  };
}

const absent = (filename) => assert.rejects(access(filename), { code: 'ENOENT' });

test('fresh lock publishes complete owner metadata and releases idempotently', async (t) => {
  const f = await fixture(t);
  const release = await acquireRuntimeLock(f.options);
  const record = JSON.parse(await readFile(f.lockPath, 'utf8'));
  assert.deepEqual({ pid: record.pid, startedAt: record.startedAt, script: record.script }, identity);
  assert.ok(record.token);
  await absent(f.guardPath);
  await release(); await release();
  await absent(f.lockPath);
});

test('live owners are preserved and the acquisition guard is released', async (t) => {
  const f = await fixture(t); await f.writePrimary(previous);
  await assert.rejects(acquireRuntimeLock({ ...f.options, processSnapshot: () => previous }), /live owner.*Inspect/);
  assert.deepEqual(JSON.parse(await readFile(f.lockPath, 'utf8')), previous);
  await absent(f.guardPath);
});

test('legacy, partial and malformed primary locks are preserved without guessing ownership', async (t) => {
  for (const record of [{ pid: previous.pid }, { ...previous, token: undefined }, { ...previous, startedAt: undefined }, '{"pid":']) {
    const f = await fixture(t); await f.writePrimary(record);
    const before = await readFile(f.lockPath, 'utf8');
    await assert.rejects(acquireRuntimeLock({ ...f.options, processSnapshot: () => assert.fail('Incomplete locks must not be recovered') }), /Inspect.*manually/);
    assert.equal(await readFile(f.lockPath, 'utf8'), before);
    await absent(f.guardPath);
  }
});

test('unknown process identities and matching creation times with uncertain scripts fail closed', async (t) => {
  for (const snapshot of [undefined, {}, { pid: 999, startedAt: previous.startedAt }, { pid: previous.pid }, { pid: previous.pid, startedAt: previous.startedAt }, { ...previous, script: 'C:\\fixture\\other.mjs' }]) {
    const f = await fixture(t); await f.writePrimary(previous);
    await assert.rejects(acquireRuntimeLock({ ...f.options, processSnapshot: async () => snapshot }), /Inspect.*manually/);
    assert.deepEqual(JSON.parse(await readFile(f.lockPath, 'utf8')), previous);
    await absent(f.guardPath);
  }
});

test('every existing guard is preserved, including stale, unknown and partial guard metadata', async (t) => {
  for (const guard of [JSON.stringify(previous), '{}', '{"token":', '']) {
    const f = await fixture(t); await writeFile(f.guardPath, guard);
    await assert.rejects(acquireRuntimeLock({ ...f.options, processSnapshot: () => assert.fail('A held guard must not inspect processes') }), /guard already exists.*Inspect/);
    assert.equal(await readFile(f.guardPath, 'utf8'), guard);
    await absent(f.lockPath);
  }
});

test('proven absent primary owners are recovered', async (t) => {
  const f = await fixture(t); await f.writePrimary(previous);
  let snapshots = 0;
  const release = await acquireRuntimeLock({ ...f.options, processSnapshot: async (pid) => { assert.equal(pid, previous.pid); snapshots++; return null; } });
  const record = JSON.parse(await readFile(f.lockPath, 'utf8'));
  assert.equal(record.pid, identity.pid); assert.notEqual(record.token, previous.token);
  assert.equal(snapshots, 1);
  await absent(f.guardPath); await release(); await absent(f.lockPath);
});

test('PID reuse recovers only the stale record and takes no action against its new process', async (t) => {
  const f = await fixture(t); await f.writePrimary(previous);
  const observed = { pid: previous.pid, startedAt: 'fixture-reused-pid-creation' };
  const release = await acquireRuntimeLock({ ...f.options, processSnapshot: () => observed });
  assert.deepEqual(observed, { pid: previous.pid, startedAt: 'fixture-reused-pid-creation' });
  assert.equal(JSON.parse(await readFile(f.lockPath, 'utf8')).pid, identity.pid);
  await release();
});

test('release preserves foreign owner tokens and malformed replacements', async (t) => {
  for (const replacement of [{ ...previous, token: 'another-owner' }, '{"token":']) {
    const f = await fixture(t); const release = await acquireRuntimeLock(f.options);
    await f.writePrimary(replacement); const before = await readFile(f.lockPath, 'utf8');
    await release(); assert.equal(await readFile(f.lockPath, 'utf8'), before);
  }
});

test('concurrent stale contenders have exactly one winner with no overlapping ownership', async (t) => {
  const f = await fixture(t); await f.writePrimary(previous);
  let unblock; let entered;
  const held = new Promise((resolve) => { unblock = resolve; });
  const started = new Promise((resolve) => { entered = resolve; });
  const first = acquireRuntimeLock({ ...f.options, processSnapshot: async () => { entered(); await held; return null; } });
  try {
    await started;
    const guard = await readFile(f.guardPath, 'utf8');
    await assert.rejects(acquireRuntimeLock({ ...f.options, identity: { ...identity, pid: 303 } }), /guard already exists/);
    assert.equal(await readFile(f.guardPath, 'utf8'), guard);
    assert.deepEqual(JSON.parse(await readFile(f.lockPath, 'utf8')), previous);
    unblock();
    const release = await first;
    const owner = JSON.parse(await readFile(f.lockPath, 'utf8'));
    await assert.rejects(acquireRuntimeLock({ ...f.options, identity: { ...identity, pid: 303 }, processSnapshot: () => owner }), /live owner/);
    assert.deepEqual(JSON.parse(await readFile(f.lockPath, 'utf8')), owner);
    await release(); await absent(f.lockPath); await absent(f.guardPath);
  } finally { unblock(); await first; }
});

test('snapshot failures clean up only the owned guard and allow a later safe recovery', async (t) => {
  const f = await fixture(t); await f.writePrimary(previous);
  await assert.rejects(acquireRuntimeLock({ ...f.options, processSnapshot: () => { throw new Error('fixture snapshot failed'); } }), /could not be verified/);
  await absent(f.guardPath);
  assert.deepEqual(JSON.parse(await readFile(f.lockPath, 'utf8')), previous);
  const release = await acquireRuntimeLock(f.options); await release();
  await absent(f.lockPath); await absent(f.guardPath);
});

test('invalid caller identity fails before acquiring a guard or primary', async (t) => {
  const f = await fixture(t);
  await assert.rejects(acquireRuntimeLock({ ...f.options, identity: { pid: identity.pid } }), /verified PID/);
  await absent(f.lockPath); await absent(f.guardPath);
});
