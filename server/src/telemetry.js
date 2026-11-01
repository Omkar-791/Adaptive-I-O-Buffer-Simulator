'use strict';
const { TextDecoder } = require('node:util');

class NativeProtocolError extends Error {
  constructor(message = 'Invalid native telemetry') { super(message); this.code = 'NATIVE_PROTOCOL_ERROR'; }
}
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function need(condition, field) { if (!condition) throw new NativeProtocolError(`Invalid native field: ${field}`); }
function number(record, key) { need(typeof record[key] === 'number' && Number.isFinite(record[key]) && record[key] >= 0, key); }
function integer(record, key) { number(record, key); need(Number.isSafeInteger(record[key]), key); }
function allFinite(value, depth = 0) {
  need(depth <= 32, 'nesting');
  if (typeof value === 'number') need(Number.isFinite(value), 'finite number');
  else if (Array.isArray(value)) for (const entry of value) allFinite(entry, depth + 1);
  else if (object(value)) for (const entry of Object.values(value)) allFinite(entry, depth + 1);
}
function uniqueStreams(streams, validate) {
  need(Array.isArray(streams) && streams.length <= 64, 'streams');
  const ids = new Set();
  for (const stream of streams) {
    need(object(stream), 'stream'); integer(stream, 'stream_id');
    need(!ids.has(stream.stream_id), 'duplicate stream_id'); ids.add(stream.stream_id); validate(stream);
  }
}
const rates = ['throughput_req_per_sec', 'throughput_mb_per_sec', 'avg_latency_ms', 'avg_occupancy_slots'];
function observation(stream) {
  for (const key of ['stream_id','produced','consumed','bytes','occupancy','capacity','full_events','empty_events']) integer(stream,key);
  need(stream.capacity > 0 && stream.consumed <= stream.produced && stream.occupancy <= stream.capacity && stream.occupancy <= stream.produced-stream.consumed, 'queue counts');
  for (const key of [...rates,'utilization_pct','producer_wait_ms','consumer_wait_ms','p50_latency_upper_ms','p95_latency_upper_ms']) number(stream,key);
}
function summaryStream(stream) {
  for (const key of ['stream_id','buffer_capacity','target_requests','producer_interval_ms','consumer_processing_ms','random_seed','total_produced','total_consumed','total_bytes','max_occupancy_slots']) integer(stream,key);
  need(stream.buffer_capacity > 0 && typeof stream.name === 'string' && typeof stream.workload_type === 'string' && typeof stream.success === 'boolean','stream summary');
  for (const key of [...rates,'min_latency_ms','max_latency_ms','total_producer_wait_ms','avg_producer_wait_ms','avg_occupancy_pct','max_occupancy_pct']) number(stream,key);
  need(stream.total_consumed <= stream.total_produced, 'completion counts');
}
function validateRecord(record) {
  need(object(record), 'record'); allFinite(record);
  if (record.type === 'metrics_snapshot') {
    integer(record,'sequence'); need(record.sequence > 0,'sequence');
    number(record,'elapsed_ms'); number(record,'window_ms');
    need(record.window_ms <= record.elapsed_ms + 1e-6 && typeof record.final_sample === 'boolean','snapshot timing');
    need(object(record.global), 'global'); observation(record.global);
    uniqueStreams(record.streams, observation);
    for (const key of ['produced','consumed','bytes','occupancy','capacity','full_events','empty_events']) {
      need(record.streams.reduce((sum,s)=>sum+s[key],0) === record.global[key], 'global '+key);
    }
  } else if (record.type === 'buffer_resize') {
    integer(record,'snapshot_sequence'); need(record.snapshot_sequence > 0,'snapshot_sequence');
    for (const key of ['success','deferred','stale']) need(typeof record[key] === 'boolean', key);
    need(typeof record.reason === 'string','reason');
    need(!record.success || (!record.deferred && !record.stale),'resize status');
    uniqueStreams(record.streams, stream => {
      for (const key of ['previous_capacity','requested_capacity','actual_capacity']) integer(stream,key);
      need(stream.previous_capacity > 0 && stream.requested_capacity > 0 && stream.actual_capacity > 0,'resize capacity');
      need(!record.success || stream.actual_capacity === stream.requested_capacity,'resize acknowledgement');
    });
  } else if (record.type === 'simulation_completed') {
    for (const key of ['stream_count','global_buffer_budget','total_allocated_capacity','free_buffer_budget','min_buffer_capacity','total_produced','total_consumed','total_bytes','max_occupancy_slots']) integer(record,key);
    need(typeof record.success === 'boolean' && typeof record.workload_type === 'string','completion');
    for (const key of [...rates,'simulation_time_sec','min_latency_ms','max_latency_ms','total_producer_wait_ms','avg_producer_wait_ms','avg_occupancy_pct','max_occupancy_pct']) number(record,key);
    uniqueStreams(record.streams, summaryStream);
    need(record.stream_count === record.streams.length && record.total_consumed <= record.total_produced,'completion stream count');
    need(record.total_allocated_capacity + record.free_buffer_budget === record.global_buffer_budget,'completion budget');
    need(record.streams.reduce((sum,s)=>sum+s.buffer_capacity,0) === record.total_allocated_capacity,'completion allocations');
    for (const key of ['total_produced','total_consumed','total_bytes']) need(record.streams.reduce((sum,s)=>sum+s[key],0) === record[key], key);
  } else throw new NativeProtocolError('Unsupported native telemetry type');
  return record;
}
class NdjsonParser {
  constructor({ maxLineBytes = 65536, onRecord = () => {} } = {}) {
    if (!Number.isSafeInteger(maxLineBytes) || maxLineBytes < 1) throw new TypeError('Invalid native line limit');
    this.maxLineBytes=maxLineBytes; this.onRecord=onRecord; this.buffer=''; this.ended=false;
    this.decoder=new TextDecoder('utf-8',{fatal:true});
  }
  _line(line) {
    if (!line.trim()) return;
    need(Buffer.byteLength(line,'utf8') <= this.maxLineBytes,'line byte limit');
    const record=validateRecord(JSON.parse(line)); this.onRecord(record);
  }
  write(chunk) {
    need(!this.ended,'stream already ended');
    this.buffer += this.decoder.decode(typeof chunk === 'string' ? Buffer.from(chunk) : chunk,{stream:true});
    let boundary;
    while ((boundary=this.buffer.indexOf('\n')) >= 0) {
      const line=this.buffer.slice(0,boundary); this.buffer=this.buffer.slice(boundary+1); this._line(line);
    }
    need(Buffer.byteLength(this.buffer,'utf8') <= this.maxLineBytes,'line byte limit');
  }
  end() {
    need(!this.ended,'stream already ended'); this.ended=true;
    this.buffer += this.decoder.decode(); this._line(this.buffer); this.buffer='';
  }
}
module.exports={NdjsonParser,validateRecord,NativeProtocolError};
