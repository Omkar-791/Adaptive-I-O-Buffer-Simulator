'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { setTimeout: delay } = require('node:timers/promises');
const nativeText = fs.readFileSync(path.join(__dirname, 'fixtures/native-short.ndjson'), 'utf8');
const nativeRecords = nativeText.trim().split(/\r?\n/).map(JSON.parse);
const terminal = new Set(['completed', 'failed', 'cancelled', 'timed_out']);
function normalized() {
  return { adaptive: false, metricsIntervalMs: 10, metricsWindowMs: 20,
    config: { global_buffer_budget: 8, streams: [{ stream_id: 0, name: 'Stream-0', buffer_capacity: 8,
      num_requests: 3, producer_interval_ms: 0, consumer_processing_ms: 0, min_payload_bytes: 512,
      max_payload_bytes: 4096, random_seed: 42, workload: { type: 'STEADY', base_interval_ms: 0, min_payload_bytes: 512, max_payload_bytes: 4096, seed: 42, stream_id: 0 } }] } };
}
function fixtureSpawner(scenario = 'success') {
  const calls = [];
  function spawn(executable, args, options) {
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.pid = 12345;
    let closed = false;
    const finish = (code = 0, signal = null) => {
      if (closed) return; closed = true; child.stdout.end(); child.stderr.end(); child.emit('close', code, signal);
    };
    child.kill = signal => { child.lastSignal = signal; setImmediate(() => finish(null, signal)); return true; };
    calls.push({ executable, args, options, child, finish });
    setImmediate(() => {
      if (scenario === 'launch-error') {
        child.pid=undefined;
        const error = new Error('ENOENT /private/fixture/native.exe'); error.code = 'ENOENT'; child.emit('error', error); finish(-1); return;
      }
      child.emit('spawn');
      if (scenario === 'pending') return;
      if (scenario === 'nonzero') { child.stderr.write('private-path /not/public secret-token\n'); finish(7); return; }
      if (scenario === 'malformed') { child.stdout.write('{broken}\n'); finish(0); return; }
      if (scenario === 'missing-final') { child.stdout.write(JSON.stringify(nativeRecords[0])+'\n'); finish(0); return; }
      if (scenario === 'bad-count') {
        const records = structuredClone(nativeRecords); records.at(-1).total_consumed = 2;
        child.stdout.write(records.map(JSON.stringify).join('\n')+'\n'); finish(0); return;
      }
      if (scenario === 'duplicate-final') { child.stdout.write(nativeText+JSON.stringify(nativeRecords.at(-1))+'\n'); finish(0); return; }
      if (scenario === 'output-flood') { child.stdout.write(Buffer.alloc(4096, 120)); return; }
      if (scenario === 'stderr-flood') { child.stderr.write(Buffer.alloc(65536, 120)); child.stdout.write(nativeText); finish(); return; }
      if (scenario.startsWith('wrong-')) {
        const records=structuredClone(nativeRecords), stream=records.at(-1).streams[0];
        const field=scenario.slice(6);
        stream[field]=field==='name'?'wrong-name':field==='workload_type'?'BURST':99;
        child.stdout.write(records.map(JSON.stringify).join('\n')+'\n');finish();return;
      }
      if (scenario === 'retention') {
        for (let sequence=1; sequence<=8; sequence++) { const record=structuredClone(nativeRecords[0]); record.sequence=sequence; record.elapsed_ms=sequence/100; child.stdout.write(JSON.stringify(record)+'\n'); }
        const final=structuredClone(nativeRecords[1]); final.sequence=9;
        child.stdout.write(JSON.stringify(final)+'\n'+JSON.stringify(nativeRecords[2])+'\n'); finish(); return;
      }
      const bytes = Buffer.from(nativeText);
      child.stdout.write(bytes.subarray(0, 43)); child.stdout.write(bytes.subarray(43, 278)); child.stdout.write(bytes.subarray(278)); finish();
    });
    return child;
  }
  return { spawn, calls };
}
async function waitTerminal(manager, id) {
  const deadline = Date.now()+5000;
  while (Date.now()<deadline) { const run=manager.get(id); if (terminal.has(run.status)) return run; await delay(5); }
  throw new Error('Run did not reach terminal state');
}
async function testRoot() {
  const parent = path.resolve(__dirname, '../../build_phase10/server-test-fixtures');
  await fs.promises.mkdir(parent, { recursive: true });
  const root = await fs.promises.mkdtemp(path.join(parent, 'run-'));
  if (!root.startsWith(parent+path.sep)) throw new Error('Unexpected fixture directory');
  return root;
}
module.exports = { nativeText, nativeRecords, normalized, fixtureSpawner, waitTerminal, testRoot, delay };
