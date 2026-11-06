'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { existsSync } = require('node:fs');
const path = require('node:path');
const { createApp } = require('../src/app');
const { RunManager } = require('../src/run-manager');
const { testRoot } = require('./helpers');

const executable = process.env.NATIVE_TEST_EXECUTABLE || process.env.NATIVE_EXECUTABLE || path.resolve(__dirname, '../../build_phase14/adaptive_io_sim.exe');
const available = existsSync(executable);
const nativeOptions = { skip: available ? false : 'Existing native executable unavailable; set NATIVE_TEST_EXECUTABLE', timeout: 30000 };
function request(strategy = 'fixed', overrides = {}) {
  return { strategy, config: { num_streams: 1, buffer_capacity: 2, global_buffer_budget: 32,
    num_requests: 300, producer_interval_ms: 0, consumer_processing_ms: 5,
    min_payload_bytes: 64, max_payload_bytes: 128, random_seed: 42, ...overrides },
  metrics: { interval_ms: 20, window_ms: 100 } };
}
async function api(t, options = {}) {
  const root = await testRoot();
  const manager = new RunManager({ executablePath: executable, cwd: path.resolve(__dirname, '../..'), tempRoot: root,
    timeoutMs: 15000, maxConcurrent: 2, telemetryLimit: 3, ...options });
  const server = await new Promise(resolve => { const value = createApp({ manager }).listen(0, '127.0.0.1', () => resolve(value)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await manager.close();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
  });
  const call = async (route, method = 'GET', input) => {
    const reply = await fetch(base + route, { method, headers: input === undefined ? {} : { 'content-type': 'application/json' },
      body: input === undefined ? undefined : JSON.stringify(input) });
    return { status: reply.status, data: await reply.json() };
  };
  return { root, manager, call };
}
function noResult(reply) { assert.equal(reply.status, 409); assert.equal(reply.data.error.code, 'RESULT_UNAVAILABLE'); }

test('real concurrent fixed/adaptive runs enforce admission and retain isolated paginated telemetry and results', nativeOptions, async t => {
  const { manager, call, root } = await api(t);
  const replies = await Promise.all(['fixed', 'adaptive'].map(strategy => call('/api/v1/runs', 'POST', request(strategy))));
  assert.ok(replies.every(reply => reply.status === 202));
  const runs = replies.map(reply => reply.data);
  assert.notEqual(runs[0].id, runs[1].id);
  assert.equal((await call('/api/v1/health')).data.activeRuns, 2);
  const rejected = await call('/api/v1/runs', 'POST', request());
  assert.equal(rejected.status, 503); assert.equal(rejected.data.error.code, 'CONCURRENCY_LIMIT');
  assert.equal(manager.runs.size, 2);
  await Promise.all(runs.map(run => manager.runs.get(run.id).done));
  const results = [];
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];
    const summary = (await call(`/api/v1/runs/${run.id}`)).data;
    assert.equal(summary.status, 'completed', JSON.stringify(summary.error));
    assert.equal(summary.configuration.strategy, i === 0 ? 'fixed' : 'adaptive');
    const resultReply = await call(`/api/v1/runs/${run.id}/result`);
    assert.equal(resultReply.status, 200); const result = resultReply.data; results.push(result);
    assert.equal(result.total_produced, 300); assert.equal(result.total_consumed, 300);
    assert.equal(result.success, true); assert.ok(result.total_allocated_capacity <= 32);
    const whole = (await call(`/api/v1/runs/${run.id}/telemetry?after=0&limit=100`)).data;
    assert.equal(whole.truncated, true); assert.ok(whole.records.length <= 3);
    assert.ok(whole.oldestCursor > 1);
    let cursor = 0; const indexes = [];
    while (true) {
      const page = (await call(`/api/v1/runs/${run.id}/telemetry?after=${cursor}&limit=1`)).data;
      assert.ok(page.nextCursor >= cursor);
      if (!page.records.length) break;
      assert.equal(page.records.length, 1);
      assert.ok(page.records[0].index > cursor);
      indexes.push(page.records[0].index); cursor = page.nextCursor;
    }
    assert.deepEqual(indexes, whole.records.map(event => event.index));
    assert.equal(new Set(indexes).size, indexes.length);
    const completion = whole.records.find(event => event.record.type === 'simulation_completed');
    assert.ok(completion); assert.deepEqual(completion.record, result);
    const internal = manager.telemetry(run.id).records;
    internal[0].record.type = 'caller-mutation';
    assert.notEqual(manager.telemetry(run.id).records[0].record.type, 'caller-mutation');
  }
  assert.equal(results[0].total_bytes, results[1].total_bytes, 'Seeded nominal work and measured payload bytes agree');
  assert.equal(results[0].streams[0].buffer_capacity, 2);
  assert.equal((await call('/api/v1/health')).data.activeRuns, 0);
  assert.deepEqual(await fs.readdir(root), []);
});

test('real byte-only telemetry eviction preserves final metrics and advances the empty cursor', nativeOptions, async t => {
  const { manager, call } = await api(t, { maxTelemetryBytes: 1 });
  const created = await call('/api/v1/runs', 'POST', request('fixed', { num_requests: 0 }));
  assert.equal(created.status, 202); const id = created.data.id;
  await manager.runs.get(id).done;
  assert.equal((await call(`/api/v1/runs/${id}`)).data.status, 'completed');
  const telemetry = (await call(`/api/v1/runs/${id}/telemetry?after=0&limit=1`)).data;
  assert.deepEqual(telemetry.records, []); assert.equal(telemetry.truncated, true);
  assert.ok(telemetry.nextCursor > 0); assert.equal(telemetry.oldestCursor, telemetry.nextCursor + 1);
  const result = await call(`/api/v1/runs/${id}/result`);
  assert.equal(result.status, 200); assert.equal(result.data.total_consumed, 0); assert.equal(result.data.success, true);
});

test('real native cancellation, configured timeout and active shutdown release reservations without successful results', nativeOptions, async t => {
  const { manager, call, root } = await api(t, { timeoutMs: 2000 });
  let observed;
  const retain = manager._retain.bind(manager);
  manager._retain = (run, record) => { retain(run, record); observed?.(run.id); };
  async function startObserved() {
    let ready;
    const observation = new Promise(resolve => { ready = resolve; });
    observed = ready;
    const reply = await call('/api/v1/runs', 'POST', request('fixed', { num_requests: 1000, consumer_processing_ms: 1000 }));
    assert.equal(reply.status, 202); const id = reply.data.id;
    // A native baseline, rather than an arbitrary sleep, establishes that a real child is running.
    assert.equal(await Promise.race([observation, manager.runs.get(id).done.then(() => { throw new Error('Native run ended before a baseline was observed'); })]), id); observed = undefined;
    return id;
  }
  const cancelled = await startObserved();
  assert.equal((await call(`/api/v1/runs/${cancelled}/cancel`, 'POST')).status, 202);
  await manager.runs.get(cancelled).done;
  assert.equal((await call(`/api/v1/runs/${cancelled}`)).data.status, 'cancelled');
  noResult(await call(`/api/v1/runs/${cancelled}/result`));
  const timed = await startObserved();
  await manager.runs.get(timed).done;
  assert.equal((await call(`/api/v1/runs/${timed}`)).data.status, 'timed_out');
  noResult(await call(`/api/v1/runs/${timed}/result`));
  const stopped = await startObserved();
  await manager.close();
  assert.equal((await call(`/api/v1/runs/${stopped}`)).data.status, 'cancelled');
  noResult(await call(`/api/v1/runs/${stopped}/result`));
  const rejected = await call('/api/v1/runs', 'POST', request());
  assert.equal(rejected.status, 503); assert.equal(rejected.data.error.code, 'SERVER_STOPPING');
  assert.equal((await call('/api/v1/health')).data.activeRuns, 0);
  assert.ok([...manager.runs.values()].every(run => run.child === null && run.timer === null && !run.active));
  assert.deepEqual(await fs.readdir(root), []);
});
