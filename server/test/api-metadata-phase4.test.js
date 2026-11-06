'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createApp } = require('../src/app');
const { RunManager } = require('../src/run-manager');
const { fixtureSpawner, testRoot, waitTerminal } = require('./helpers');
const { controlledSpawner } = require('./fixtures/phase3-controlled');

const body = () => ({ config: { num_requests: 3, producer_interval_ms: 0, consumer_processing_ms: 0 }, metrics: { interval_ms: 10, window_ms: 20 } });
async function setup(t, options = {}) {
  const root = await testRoot();
  const fake = options.controlled ? controlledSpawner() : fixtureSpawner(options.scenario || 'success');
  const manager = new RunManager({ executablePath: process.execPath, cwd: path.resolve(__dirname, '../..'),
    tempRoot: root, spawn: fake.spawn, timeoutMs: 5000, ...options.manager });
  const server = await new Promise(resolve => { const value = createApp({ manager }).listen(0, '127.0.0.1', () => resolve(value)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    for (const child of fake.children || []) child.finish(null, 'SIGTERM');
    await manager.close();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
  });
  const call = async (route, method = 'GET', input) => {
    const response = await fetch(base + route, { method, headers: input === undefined ? {} : { 'content-type': 'application/json' },
      body: input === undefined ? undefined : JSON.stringify(input) });
    return { status: response.status, data: await response.json() };
  };
  return { root, manager, fake, base, call };
}
function safeError(reply, status, code) {
  assert.equal(reply.status, status);
  assert.deepEqual(Object.keys(reply.data), ['error']);
  assert.deepEqual(Object.keys(reply.data.error).sort(), ['code', 'message']);
  assert.equal(typeof reply.data.error.message, 'string');
  if (code) assert.equal(reply.data.error.code, code);
  assert.doesNotMatch(JSON.stringify(reply.data), /secret-token|private-path|node_modules|Error:|[A-Z]:\\/);
}
function dates(run, started) {
  assert.ok(Number.isFinite(Date.parse(run.createdAt)));
  if (started) {
    assert.ok(Number.isFinite(Date.parse(run.startedAt)));
    assert.ok(Date.parse(run.startedAt) >= Date.parse(run.createdAt));
  }
  assert.ok(Number.isFinite(Date.parse(run.endedAt)));
  assert.ok(Date.parse(run.endedAt) >= Date.parse(run.startedAt || run.createdAt));
}

test('canonical effective configuration and successful metadata remain immutable across endpoints', async t => {
  const { call, manager } = await setup(t);
  const requested = body();
  const reply = await call('/api/v1/runs', 'POST', requested);
  assert.equal(reply.status, 202);
  const created = reply.data;
  assert.match(created.id, /^[0-9a-f-]{36}$/);
  assert.equal(created.statusUrl, `/api/v1/runs/${created.id}`);
  assert.equal(created.progress, null);
  assert.equal(created.cancellationMode, 'terminate');
  assert.equal(requested.config.streams, undefined);
  assert.equal(created.configuration.strategy, 'fixed');
  assert.equal(created.configuration.config.streams[0].stream_id, 0);
  assert.equal(created.configuration.config.streams[0].random_seed, 42);
  const expected = structuredClone(created.configuration);
  created.configuration.config.streams[0].name = 'client-mutation';
  requested.config.num_requests = 999;
  await waitTerminal(manager, created.id);
  const final = (await call(`/api/v1/runs/${created.id}`)).data;
  assert.equal(final.status, 'completed'); dates(final, true);
  assert.deepEqual(final.configuration, expected);
  const result = (await call(`/api/v1/runs/${created.id}/result`)).data;
  assert.equal(result.total_consumed, 3);
  result.streams[0].name = 'mutated-result';
  const direct = manager.result(created.id); direct.total_consumed = 999;
  assert.equal((await call(`/api/v1/runs/${created.id}/result`)).data.total_consumed, 3);
  assert.equal((await call(`/api/v1/runs/${created.id}/result`)).data.streams[0].name, expected.config.streams[0].name);
  assert.deepEqual((await call('/api/v1/runs')).data.runs[0], final);
  safeError(await call(`/api/v1/runs/${created.id}/cancel`, 'POST'), 409, 'RUN_TERMINAL');
});

test('cancelled, timed-out and failed metadata agree with public lifecycle and result availability', async t => {
  for (const outcome of ['cancelled', 'timed_out', 'failed']) {
    const { call, manager, fake } = await setup(t, { controlled: true });
    const created = (await call('/api/v1/runs', 'POST', body())).data;
    const child = fake.children[0]; child.start();
    const config = structuredClone(created.configuration);
    safeError(await call(`/api/v1/runs/${created.id}/result`), 409, 'RESULT_UNAVAILABLE');
    if (outcome === 'cancelled') {
      const first = await call(`/api/v1/runs/${created.id}/cancel`, 'POST');
      const second = await call(`/api/v1/runs/${created.id}/cancel`, 'POST');
      assert.equal(first.status, 202); assert.equal(second.status, 202);
      assert.equal(first.data.status, 'running'); assert.equal(first.data.cancellationRequested, true);
      assert.deepEqual(child.signals, ['SIGTERM']);
      child.finish(null, 'SIGTERM');
    } else if (outcome === 'timed_out') {
      // Deterministically trigger the same timeout callback path; real timer/native coverage is separate.
      manager._stop(manager.runs.get(created.id), 'timed_out', 'NATIVE_TIMEOUT', 'Native run exceeded the configured duration.');
      child.finish(null, 'SIGTERM');
    } else child.finish(7);
    await manager.runs.get(created.id).done;
    const final = (await call(`/api/v1/runs/${created.id}`)).data;
    assert.equal(final.status, outcome); dates(final, true);
    assert.deepEqual(final.configuration, config);
    assert.equal(final.progress, null);
    safeError(await call(`/api/v1/runs/${created.id}/result`), 409, 'RESULT_UNAVAILABLE');
    assert.deepEqual((await call('/api/v1/runs')).data.runs[0], final);
    safeError(await call(`/api/v1/runs/${created.id}/cancel`, 'POST'), 409, 'RUN_TERMINAL');
  }
});

test('unique run IDs and bounded history evict all endpoints consistently without losing retained metadata', async t => {
  const { manager, call } = await setup(t, { manager: { maxHistory: 3 } });
  const ids = [];
  for (let i = 0; i < 6; i++) {
    const reply = await call('/api/v1/runs', 'POST', body()); assert.equal(reply.status, 202);
    ids.push(reply.data.id); await waitTerminal(manager, reply.data.id);
  }
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual((await call('/api/v1/runs?limit=100')).data.runs.map(run => run.id), ids.slice(-3).reverse());
  for (const id of ids.slice(0, 3)) for (const suffix of ['', '/telemetry', '/result', '/cancel']) {
    safeError(await call(`/api/v1/runs/${id}${suffix}`, suffix === '/cancel' ? 'POST' : 'GET'), 404, 'RUN_NOT_FOUND');
  }
  for (const id of ids.slice(-3)) assert.equal((await call(`/api/v1/runs/${id}`)).data.configuration.config.streams[0].num_requests, 3);
  assert.equal((await manager.health()).activeRuns, 0);
});

test('malformed requests, encodings and query errors use safe JSON without consuming reservations', async t => {
  const { manager, fake, call, base } = await setup(t);
  const bad = [
    { ...body(), unsupported: true },
    { ...body(), config: { num_streams: 17 } },
    { ...body(), config: { num_streams: 16, num_requests: 10000 } },
    { ...body(), config: { buffer_capacity: 65 } },
    { ...body(), metrics: { interval_ms: 10, window_ms: 5 } },
    { ...body(), config: { streams: [{ stream_id: 3 }, { stream_id: 3 }] } },
    { ...body(), config: { workload: { type: 'UNSUPPORTED' } } },
  ];
  for (const input of bad) safeError(await call('/api/v1/runs', 'POST', input), 422, 'INVALID_CONFIGURATION');
  for (const [input, headers, status] of [
    ['{"config":', { 'content-type': 'application/json' }, 400],
    ['{}', { 'content-type': 'text/plain' }, 415],
    ['{}', { 'content-type': 'application/json; charset=iso-8859-1' }, 415],
    ['{}', { 'content-type': 'application/json', 'content-encoding': 'gzip' }, 415],
  ]) {
    const response = await fetch(base + '/api/v1/runs', { method: 'POST', headers, body: input });
    safeError({ status: response.status, data: await response.json() }, status);
  }
  for (const route of ['/api/v1/runs?limit=0', '/api/v1/runs?unknown=1', '/api/v1/runs?limit=1&limit=2', '/api/v1/runs?limit=9007199254740992']) safeError(await call(route), 400);
  safeError(await call('/api/v1/runs/missing'), 404, 'RUN_NOT_FOUND');
  safeError(await call('/api/v1/runs/missing/cancel', 'POST'), 404, 'RUN_NOT_FOUND');
  assert.equal(fake.calls.length, 0); assert.equal((await manager.health()).activeRuns, 0);
  assert.equal(manager.runs.size, 0);
});

test('invalid telemetry queries and an unexpected internal error never leak diagnostics', async t => {
  const { manager, call } = await setup(t);
  const created = (await call('/api/v1/runs', 'POST', body())).data;
  await waitTerminal(manager, created.id);
  for (const query of ['after=-1', 'after=NaN', 'after=1.5', 'after=1&after=2', 'after=9007199254740991', 'limit=0', 'limit=10001', 'after=9007199254740992', 'unknown=1']) {
    safeError(await call(`/api/v1/runs/${created.id}/telemetry?${query}`), 400);
  }
  t.mock.method(manager, 'get', () => { throw new Error('private-path C:\\private\\secret-token native.exe'); });
  const reply = await call(`/api/v1/runs/${created.id}`);
  safeError(reply, 500, 'INTERNAL_ERROR');
  assert.equal(reply.data.error.message, 'Backend operation failed.');
});
