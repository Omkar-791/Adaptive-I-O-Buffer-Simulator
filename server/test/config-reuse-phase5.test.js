'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createApp } = require('../src/app');
const { RunManager } = require('../src/run-manager');
const { validateRequest } = require('../src/validation');
const { fixtureSpawner, testRoot } = require('./helpers');

const bytes = value => Buffer.byteLength(JSON.stringify(value), 'utf8');
function maximumShape() {
  return { strategy: 'adaptive', metrics: { interval_ms: 1000, window_ms: 60000 }, config: {
    global_buffer_budget: 1024,
    streams: Array.from({ length: 16 }, (_, i) => ({
      stream_id: 4294967280 + i, name: 'S'.repeat(64), buffer_capacity: 64,
      num_requests: i < 9 ? 10000 : i === 15 ? 1432 : 1428,
      producer_interval_ms: 1000, consumer_processing_ms: 1000,
      min_payload_bytes: 1048576, max_payload_bytes: 1048576, random_seed: 4294967295,
      workload: { type: 'STOCHASTIC', base_interval_ms: 1000, burst_interval_ms: 1000,
        burst_length: 10000, normal_length: 10000, period_length: 10000,
        amplitude_pct: 0.0000010000000000000002, lambda: 0.0000010000000000000002,
        min_payload_bytes: 1048576, max_payload_bytes: 1048576, seed: 4294967295,
        stream_id: 4294967280 + i,
        phases: Array.from({ length: 32 }, (_, n) => ({
          name: String(n).padStart(2, '0') + 'P'.repeat(62), interval_ms: 1000,
          request_count: 10000, min_payload_bytes: 1048576, max_payload_bytes: 1048576,
        })),
      },
    })),
  } };
}
function canonical(body) {
  const normalized = validateRequest(body);
  return { strategy: normalized.adaptive ? 'adaptive' : 'fixed', config: normalized.config,
    metrics: { interval_ms: normalized.metricsIntervalMs, window_ms: normalized.metricsWindowMs } };
}
async function setup(t) {
  const root = await testRoot(), fake = fixtureSpawner('pending');
  const manager = new RunManager({ executablePath: process.execPath,
    cwd: path.resolve(__dirname, '../..'), tempRoot: root, spawn: fake.spawn, timeoutMs: 30000 });
  const server = await new Promise(resolve => {
    const listener = createApp({ manager }).listen(0, '127.0.0.1', () => resolve(listener));
  });
  t.after(async () => {
    await manager.close();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
  });
  async function send(body, raw = false) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/runs`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: raw ? body : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  }
  return { manager, fake, send };
}

test('canonical maximum shape and a conservative serialization bound fit within finite 128 KiB', () => {
  const shape = canonical(maximumShape());
  assert.equal(bytes(shape), 98452);
  // All permitted names are ASCII without JSON escaping. Every key and array
  // slot is present. Reserve 32 bytes per finite double and 5 digits for every
  // stream request count, even though 16 * 10000 would exceed total admission.
  const doubles = shape.config.streams.flatMap(stream => [stream.workload.amplitude_pct, stream.workload.lambda]);
  const doubleMargin = doubles.reduce((sum, value) => sum + 32 - JSON.stringify(value).length, 0);
  const requestMargin = shape.config.streams.reduce((sum, stream) => sum + 5 - String(stream.num_requests).length, 0);
  const upperBound = bytes(shape) + doubleMargin + requestMargin;
  assert.equal(upperBound, 98715);
  assert.ok(upperBound < 131072);
  assert.equal(131072 - upperBound, 32357);
});

test('below-old-limit source and above-old-limit canonical reuse preserve exact returned configuration and independent state', async t => {
  const { send, manager, fake } = await setup(t);
  const source = maximumShape();
  // Defaults omitted by a legitimate caller are expanded in returned metadata.
  for (const stream of source.config.streams) {
    stream.workload = { type: 'MIXED', phases: stream.workload.phases.map(phase => ({ name: phase.name, request_count: 10000 })) };
  }
  assert.ok(bytes(source) < 65536);
  const created = await send(source);
  assert.equal(created.status, 202);
  assert.deepEqual(created.body.configuration, canonical(source));
  const before = structuredClone(manager.get(created.body.id));
  assert.ok(bytes(before.configuration) > 65536);
  const reused = await send(before.configuration);
  assert.equal(reused.status, 202);
  assert.notEqual(reused.body.id, before.id);
  assert.deepEqual(reused.body.configuration, before.configuration);
  assert.deepEqual(manager.get(before.id).configuration, before.configuration);
  assert.equal(reused.body.progress, null);
  assert.equal(reused.body.cancellationRequested, false);
  assert.equal(reused.body.endedAt, null);
  assert.equal(manager.telemetry(reused.body.id).records.length, 0);
  assert.throws(() => manager.result(reused.body.id), { code: 'RESULT_UNAVAILABLE' });
  assert.equal(fake.calls.length, 2);
  // Pending children intentionally emit no fabricated results for this shape.
});

test('maximum supported canonical request is accepted unchanged over HTTP', async t => {
  const { send, manager, fake } = await setup(t);
  const body = canonical(maximumShape());
  const reply = await send(body);
  assert.equal(reply.status, 202);
  assert.deepEqual(reply.body.configuration, body);
  assert.deepEqual(manager.get(reply.body.id).configuration, body);
  assert.equal(fake.calls.length, 1);
});

test('all workload types retain canonical configuration through HTTP reuse', async t => {
  const { send, manager } = await setup(t);
  for (const type of ['STEADY', 'BURST', 'PERIODIC', 'STOCHASTIC', 'MIXED']) {
    const body = maximumShape(); body.config.streams = body.config.streams.slice(0, 1);
    body.config.streams[0].workload.type = type;
    const original = await send(body);
    assert.equal(original.status, 202);
    const reused = await send(original.body.configuration);
    assert.equal(reused.status, 202);
    assert.notEqual(reused.body.id, original.body.id);
    assert.deepEqual(reused.body.configuration, original.body.configuration);
    await manager.cancel(original.body.id); await manager.cancel(reused.body.id);
    await Promise.all([manager.runs.get(original.body.id).done, manager.runs.get(reused.body.id).done]);
  }
});

test('oversized, malformed, unsupported and resource-exhausting large bodies never launch or reserve runs', async t => {
  const { send, manager, fake } = await setup(t);
  const oversized = JSON.stringify({ config: { name: 'x'.repeat(131072) } });
  const malformed = JSON.stringify(maximumShape()).slice(0, -1);
  assert.ok(Buffer.byteLength(malformed) > 65536);
  const unsupported = maximumShape(); unsupported.executablePath = 'private/native.exe';
  const exhausting = maximumShape(); exhausting.config.streams.forEach(stream => { stream.num_requests = 10000; });
  for (const [body, raw, status, code] of [
    [oversized, true, 413, 'BODY_TOO_LARGE'],
    [malformed, true, 400, 'INVALID_JSON'],
    [unsupported, false, 422, 'INVALID_CONFIGURATION'],
    [exhausting, false, 422, 'INVALID_CONFIGURATION'],
  ]) {
    const reply = await send(body, raw);
    assert.equal(reply.status, status);
    assert.equal(reply.body.error.code, code);
    assert.deepEqual(Object.keys(reply.body.error).sort(), ['code', 'message']);
    assert.doesNotMatch(reply.body.error.message, /private|stack|native\.exe/);
    if (status === 413) assert.equal(reply.body.error.message, 'JSON body exceeds 128 KiB.');
    assert.equal(fake.calls.length, 0);
    assert.equal(manager.active, 0);
    assert.equal(manager.runs.size, 0);
  }
});
