'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { RunManager } = require('../src/run-manager');
const { normalized, testRoot } = require('./helpers');
const { controlledSpawner } = require('./fixtures/phase3-controlled');

async function setup(t, options = {}) {
  const root = await testRoot(), controlled = controlledSpawner();
  const manager = new RunManager({ executablePath: process.execPath, cwd: path.resolve(__dirname, '../..'),
    tempRoot: root, spawn: controlled.spawn, timeoutMs: 1000, killGraceMs: 20, ...options });
  t.after(async () => {
    for (const child of controlled.children) if (child.listenerCount('close')) child.finish(null, 'SIGKILL');
    await manager.close().catch(() => {});
    await fs.rm(root, { recursive: true, force: true });
  });
  const summary = await manager.create(normalized());
  const child = controlled.children[0], run = manager.runs.get(summary.id);
  child.start();
  return { manager, child, run, id: summary.id, root };
}
async function clean(manager, run, root) {
  await run.done;
  assert.equal(manager.active, 0);
  assert.equal(run.child, null);
  assert.equal(run.request, null);
  assert.equal(run.parser, null);
  assert.equal(run.timer, null);
  assert.equal(run.closeTimer, null);
  assert.deepEqual(await fs.readdir(root), []);
}

test('natural completion wins before later cancel and repeated close cannot overwrite it', async t => {
  const { manager, child, run, id, root } = await setup(t);
  child.output(); child.finish();
  await clean(manager, run, root);
  assert.equal(manager.get(id).status, 'completed');
  assert.throws(() => manager.cancel(id), error => error.code === 'RUN_TERMINAL');
  child.emit('close', null, 'SIGTERM');
  await manager.close(); await manager.close();
  assert.equal(manager.get(id).status, 'completed');
  assert.equal(manager.result(id).total_consumed, 3);
});

test('cancel claim wins against natural close without duplicate termination operations', async t => {
  const { manager, child, run, id, root } = await setup(t);
  manager.cancel(id); manager.cancel(id); manager.cancel(id);
  assert.equal(manager.get(id).status, 'running');
  assert.equal(manager.get(id).cancellationRequested, true);
  assert.deepEqual(child.signals, ['SIGTERM']);
  child.output(); child.finish(0);
  await clean(manager, run, root);
  assert.equal(manager.get(id).status, 'cancelled');
  assert.throws(() => manager.result(id), error => error.status === 409);
});

test('timeout claim then cancellation preserves timeout and verifies close before terminal state', async t => {
  const { manager, child, run, id, root } = await setup(t);
  manager._stop(run, 'timed_out', 'NATIVE_TIMEOUT', 'Native timeout fixture');
  manager.cancel(id);
  assert.equal(manager.get(id).status, 'running');
  assert.deepEqual(child.signals, ['SIGTERM']);
  child.finish(null, 'SIGTERM');
  await clean(manager, run, root);
  assert.equal(manager.get(id).status, 'timed_out');
});

test('cancellation then timeout and shutdown retains first cancellation claim', async t => {
  const { manager, child, run, id, root } = await setup(t);
  manager.cancel(id);
  manager._stop(run, 'timed_out', 'NATIVE_TIMEOUT', 'Native timeout fixture');
  const closing = manager.close();
  child.finish(null, 'SIGTERM');
  await closing; await clean(manager, run, root);
  assert.equal(manager.get(id).status, 'cancelled');
  assert.deepEqual(child.signals, ['SIGTERM']);
});

test('process close before timeout claim cannot overwrite successful completion', async t => {
  const { manager, child, run, id, root } = await setup(t);
  child.output(); child.finish();
  manager._stop(run, 'timed_out', 'NATIVE_TIMEOUT', 'Native timeout fixture');
  await clean(manager, run, root);
  assert.equal(manager.get(id).status, 'completed');
  assert.deepEqual(child.signals, []);
});

test('configured timeout fires deterministically, clears its timer and awaits process close', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { manager, child, run, id, root } = await setup(t, { timeoutMs: 100 });
  t.mock.timers.tick(100);
  assert.deepEqual(child.signals, ['SIGTERM']);
  assert.equal(manager.get(id).status, 'running');
  child.finish(null, 'SIGTERM');
  await clean(manager, run, root);
  const final = manager.get(id);
  assert.equal(final.status, 'timed_out');
  assert.ok(!run.timer || run.timer._destroyed);
  t.mock.timers.tick(10000);
  assert.deepEqual(child.signals, ['SIGTERM']);
  assert.equal(manager.get(id).status, 'timed_out');
});

test('shutdown rejects new runs and repeated calls share termination work', async t => {
  const { manager, child, run, id, root } = await setup(t);
  const first = manager.close(), second = manager.close();
  await assert.rejects(manager.create(normalized()), error => error.code === 'SERVER_STOPPING');
  assert.deepEqual(child.signals, ['SIGTERM']);
  child.finish(null, 'SIGTERM');
  await Promise.all([first, second]); await clean(manager, run, root);
  assert.equal(manager.get(id).status, 'cancelled');
  assert.equal(manager.list()[0].id, id);
  assert.equal(manager.list()[0].status, 'cancelled');
});

test('unexpected exit and runtime error yield one failed history entry with cleared listeners', async t => {
  for (const scenario of ['nonzero', 'missing-output', 'error']) {
    const fixture = await setup(t);
    const { manager, child, run, id, root } = fixture;
    if (scenario === 'error') child.emit('error', new Error('fixture process error'));
    child.finish(scenario === 'nonzero' ? 7 : 0);
    await clean(manager, run, root);
    assert.equal(manager.get(id).status, 'failed', scenario);
    assert.equal(manager.list().length, 1);
    for (const event of ['spawn', 'exit', 'close']) assert.equal(child.listenerCount(event), 0, event);
    assert.equal(child.stdout.listenerCount('data'), 0);
    assert.equal(child.stderr.listenerCount('data'), 0);
  }
});

test('unknown cancellation preserves existing error semantics and empty shutdown is idempotent', async () => {
  const manager = new RunManager();
  assert.throws(() => manager.cancel('missing'), error => error.status === 404 && error.code === 'RUN_NOT_FOUND');
  await manager.close(); await manager.close();
  assert.equal((await manager.health()).activeRuns, 0);
});

test('unconfirmed forced termination is bounded, failed rather than cancelled, and poisons admission', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { manager, child, run, id, root } = await setup(t, { killGraceMs: 20, forceWaitMs: 30 });
  manager.cancel(id);
  await new Promise(setImmediate);
  t.mock.timers.tick(20);
  await new Promise(setImmediate);
  assert.deepEqual(child.signals, ['SIGTERM', 'SIGKILL']);
  t.mock.timers.tick(30);
  await clean(manager, run, root);
  assert.equal(manager.get(id).status, 'failed');
  assert.equal(manager.get(id).error.code, 'NATIVE_TERMINATION_UNCONFIRMED');
  await assert.rejects(manager.create(normalized()), error => error.code === 'SERVER_STOPPING');
  await assert.rejects(manager.close(), error => error.code === 'SHUTDOWN_INCOMPLETE');
  await assert.rejects(manager.close(), error => error.code === 'SHUTDOWN_INCOMPLETE');
  const terminal = manager.get(id);
  child.finish(0);
  assert.deepEqual(manager.get(id), terminal);
});

test('exit without stdio close is bounded and cannot claim successful completion', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { manager, child, run, id, root } = await setup(t, { killGraceMs: 20, forceWaitMs: 30 });
  child.output(); child.emit('exit', 0, null);
  assert.equal(manager.get(id).status, 'running');
  assert.throws(() => manager.cancel(id), error => error.code === 'RUN_TERMINAL');
  t.mock.timers.tick(30);
  await new Promise(setImmediate);
  assert.deepEqual(child.signals, ['SIGTERM']);
  t.mock.timers.tick(20);
  await new Promise(setImmediate);
  assert.deepEqual(child.signals, ['SIGTERM', 'SIGKILL']);
  t.mock.timers.tick(30);
  await clean(manager, run, root);
  assert.equal(manager.get(id).status, 'failed');
  assert.equal(manager.get(id).error.code, 'NATIVE_TERMINATION_UNCONFIRMED');
  assert.throws(() => manager.result(id), error => error.status === 409);
});

test('shutdown deadline never turns direct-child close into unverified tree cancellation', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { manager, child, run, id, root } = await setup(t, { shutdownTimeoutMs: 25 });
  run.termination.dispose();
  let disposed = 0;
  run.termination = { stop: () => new Promise(() => {}), dispose: () => { disposed++; } };
  const closing = manager.close();
  const rejected = assert.rejects(closing, error => error.code === 'SHUTDOWN_INCOMPLETE');
  child.finish(null, 'SIGTERM');
  assert.equal(run.processClosed, true);
  assert.equal(manager.get(id).status, 'running');
  t.mock.timers.tick(25);
  await rejected; await clean(manager, run, root);
  assert.equal(manager.get(id).status, 'failed');
  assert.equal(manager.get(id).error.code, 'NATIVE_TERMINATION_UNCONFIRMED');
  assert.equal(disposed, 1);
});

async function setupFilesystemGate(t, method, mockTimers = false) {
  const root = await testRoot(), controlled = controlledSpawner();
  let release, signalEntered;
  const gate = new Promise(resolve => { release = resolve; });
  const entered = new Promise(resolve => { signalEntered = resolve; });
  const original = fs[method];
  t.mock.method(fs, method, async (...args) => {
    const value = await original(...args);
    if (String(args[0]).startsWith(root + path.sep)) {
      signalEntered();
      await gate;
    }
    return value;
  });
  const manager = new RunManager({ executablePath: process.execPath, tempRoot: root,
    spawn: controlled.spawn, timeoutMs: 1000, cleanupTimeoutMs: 50, shutdownTimeoutMs: 200 });
  if (mockTimers) t.mock.timers.enable({ apis: ['setTimeout'] });
  const creating = manager.create(normalized());
  t.after(async () => {
    release();
    await creating.catch(() => {});
    await manager.close().catch(() => {});
    await fs.rm(root, { recursive: true, force: true });
  });
  await entered;
  const run = [...manager.runs.values()][0];
  assert.equal(controlled.children.length, 0);
  assert.equal((await fs.readdir(root)).length, 1, 'The gate holds a genuinely created resource');
  return { root, manager, run, creating, release, controlled };
}

for (const method of ['mkdtemp', 'writeFile']) {
  test(`shutdown waits for in-flight ${method} setup and removes resources before success`, async t => {
    const { root, manager, run, creating, release, controlled } = await setupFilesystemGate(t, method);
    let closed = false;
    const closing = manager.close().then(() => { closed = true; });
    await new Promise(setImmediate);
    assert.equal(closed, false, 'Shutdown must not claim cleanup while setup is held');
    assert.equal(manager.get(run.id).status, 'starting');
    release(); await creating; await closing;
    await clean(manager, run, root);
    assert.equal(manager.get(run.id).status, 'cancelled');
    assert.equal(controlled.children.length, 0);
  });

  test(`bounded ${method} setup failure is immutable and late completion is cleaned up`, async t => {
    const { root, manager, run, creating, release, controlled } = await setupFilesystemGate(t, method, true);
    const closing = manager.close();
    const rejected = assert.rejects(closing, error => error.code === 'SHUTDOWN_INCOMPLETE');
    t.mock.timers.tick(50);
    await rejected; await run.done;
    const failed = manager.get(run.id);
    assert.equal(failed.status, 'failed');
    assert.equal(failed.error.code, 'ARTIFACT_SETUP_UNCONFIRMED');
    assert.equal(run.child, null); assert.equal(run.parser, null); assert.equal(run.request, null);
    assert.equal(run.active, false); assert.equal(manager.active, 0);
    await assert.rejects(manager.create(normalized()), error => error.code === 'SERVER_STOPPING');
    release(); await creating;
    assert.deepEqual(await fs.readdir(root), []);
    assert.deepEqual(manager.get(run.id), failed, 'Late setup completion must not rewrite terminal history');
    assert.equal(controlled.children.length, 0);
  });
}
