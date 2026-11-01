'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { NdjsonParser } = require('../src/telemetry');
const fixture = fs.readFileSync(path.join(__dirname, 'fixtures/native-short.ndjson'), 'utf8');
const nativeRecords = fixture.trim().split(/\r?\n/).map(JSON.parse);
function parser(options = {}) {
  const records = [];
  const instance = new NdjsonParser({ maxLineBytes: 64 * 1024, onRecord: record => records.push(record), ...options });
  return { instance, records };
}

test('native NDJSON survives arbitrary chunk boundaries and multiple records', () => {
  const { instance, records } = parser();
  const bytes = Buffer.from(fixture);
  for (let offset = 0; offset < bytes.length; offset += 7) instance.write(bytes.subarray(offset, offset + 7));
  instance.end();
  assert.deepEqual(records, nativeRecords);
});

test('valid final JSON without newline is accepted and fields preserved', () => {
  const { instance, records } = parser();
  instance.write(fixture.trim());
  instance.end();
  assert.deepEqual(records.at(-1), nativeRecords.at(-1));
  assert.equal(records.at(-1).total_consumed, 3);
});

test('malformed JSON, unsupported types and incomplete final lines fail', () => {
  for (const text of ['{broken}\n', '[]\n', '{"type":"unknown"}\n', '{"type":']) {
    const { instance } = parser();
    assert.throws(() => { instance.write(text); instance.end(); });
  }
});

test('line length is bounded before unbounded partial data can accumulate', () => {
  const { instance } = parser({ maxLineBytes: 64 });
  assert.throws(() => instance.write(Buffer.alloc(65, 120)));
});

test('invalid counters, nonfinite measurements and duplicate stream IDs fail schema validation', () => {
  const mutations = [
    record => { record.global.produced = -1; },
    record => { record.global.throughput_req_per_sec = null; },
    record => { record.streams.push(structuredClone(record.streams[0])); },
  ];
  for (const mutate of mutations) {
    const record = structuredClone(nativeRecords[0]); mutate(record);
    const { instance } = parser();
    assert.throws(() => instance.write(JSON.stringify(record) + '\n'));
  }
  const { instance } = parser();
  assert.throws(() => instance.write(JSON.stringify(nativeRecords[0]).replace('"elapsed_ms":0.0001', '"elapsed_ms":1e400') + '\n'));
});

test('UTF8 split across buffers remains intact; incomplete UTF8 is rejected', () => {
  const record = structuredClone(nativeRecords.at(-1)); record.streams[0].name = 'stream-µ';
  const bytes = Buffer.from(JSON.stringify(record));
  const boundary = bytes.indexOf(Buffer.from('µ')) + 1;
  const { instance, records } = parser();
  instance.write(bytes.subarray(0, boundary)); instance.write(bytes.subarray(boundary)); instance.end();
  assert.equal(records[0].streams[0].name, 'stream-µ');
  const broken = parser().instance;
  assert.throws(() => { broken.write(Buffer.from([0xc3])); broken.end(); });
});

test('physical resize outcome is preserved as a distinct native record', () => {
  const record = { type: 'buffer_resize', snapshot_sequence: 2, success: true, deferred: false, stale: false,
    reason: 'Applied physical queue capacities and resource accounting atomically',
    streams: [{ stream_id: 0, previous_capacity: 8, requested_capacity: 12, actual_capacity: 12 }] };
  const { instance, records } = parser();
  instance.write(JSON.stringify(record) + '\n'); instance.end();
  assert.deepEqual(records, [record]);
});
