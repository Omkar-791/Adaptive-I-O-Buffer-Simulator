import type { CreateRun, RunSummary } from '../types/api';

type Fields = Record<string, unknown>;
const streamKeys = ['stream_id', 'name', 'buffer_capacity', 'num_requests', 'producer_interval_ms', 'consumer_processing_ms', 'min_payload_bytes', 'max_payload_bytes', 'random_seed', 'workload'];
const workloadKeys = ['type', 'base_interval_ms', 'burst_interval_ms', 'burst_length', 'normal_length', 'period_length', 'amplitude_pct', 'lambda', 'min_payload_bytes', 'max_payload_bytes', 'seed', 'stream_id', 'phases'];
const phaseKeys = ['name', 'interval_ms', 'request_count', 'min_payload_bytes', 'max_payload_bytes'];
function fail(field: string, explanation = 'is missing, invalid or unsupported'): never { throw new Error(`${field} ${explanation}.`); }
function fields(value: unknown, allowed: string[], field: string): Fields {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(field, 'must be an object');
  const record = value as Fields;
  if (Object.keys(record).some(key => !allowed.includes(key))) fail(field, 'contains an unsupported field');
  for (const key of allowed) if (!Object.hasOwn(record, key)) fail(`${field}.${key}`, 'is required; no default is substituted');
  return record;
}
function numeric(value: unknown, min: number, max: number, field: string, integer = true): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || (integer && !Number.isSafeInteger(value)) || value < min || value > max) fail(field, `must be ${integer ? 'a whole number' : 'a number'} from ${min} to ${max}`);
  return value;
}
function name(value: unknown, field: string): void {
  if (typeof value !== 'string' || !/^[A-Za-z0-9 _.-]{1,64}$/.test(value)) fail(field, 'must contain 1–64 safe ASCII letters, digits, spaces, underscores, periods or hyphens');
}
function payload(record: Fields, field: string): void {
  const min = numeric(record.min_payload_bytes, 0, 1048576, `${field}.min_payload_bytes`);
  const max = numeric(record.max_payload_bytes, 0, 1048576, `${field}.max_payload_bytes`);
  if (min > max) fail(field, 'minimum payload cannot exceed maximum payload');
}

/** Validate an explicit effective configuration without inserting defaults or run state. */
export function parseReusableConfiguration(text: string): CreateRun {
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error('Enter valid configuration JSON.'); }
  const request = fields(value, ['strategy', 'config', 'metrics'], 'configuration');
  if (request.strategy !== 'fixed' && request.strategy !== 'adaptive') fail('strategy', 'must be fixed or adaptive');
  const config = fields(request.config, ['global_buffer_budget', 'streams'], 'config');
  const budget = numeric(config.global_buffer_budget, 1, 1024, 'config.global_buffer_budget');
  if (!Array.isArray(config.streams) || config.streams.length < 1 || config.streams.length > 16) fail('config.streams', 'must contain 1–16 streams');
  const ids = new Set<number>(); let capacity = 0; let requests = 0;
  config.streams.forEach((entry, index) => {
    const path = `config.streams[${index}]`, stream = fields(entry, streamKeys, path);
    const id = numeric(stream.stream_id, 0, 4294967295, `${path}.stream_id`);
    if (ids.has(id)) fail(`${path}.stream_id`, 'duplicates another stream'); ids.add(id);
    name(stream.name, `${path}.name`);
    capacity += numeric(stream.buffer_capacity, 1, 64, `${path}.buffer_capacity`);
    requests += numeric(stream.num_requests, 0, 10000, `${path}.num_requests`);
    numeric(stream.producer_interval_ms, 0, 1000, `${path}.producer_interval_ms`);
    numeric(stream.consumer_processing_ms, 0, 1000, `${path}.consumer_processing_ms`);
    const seed = numeric(stream.random_seed, 0, 4294967295, `${path}.random_seed`);
    payload(stream, path);
    const wPath = `${path}.workload`, workload = fields(stream.workload, workloadKeys, wPath);
    const type = typeof workload.type === 'string' ? workload.type.toUpperCase() : '';
    if (!['STEADY', 'BURST', 'PERIODIC', 'STOCHASTIC', 'MIXED'].includes(type)) fail(`${wPath}.type`);
    if (numeric(workload.stream_id, 0, 4294967295, `${wPath}.stream_id`) !== id) fail(`${wPath}.stream_id`, 'must match its stream ID');
    if (numeric(workload.seed, 0, 4294967295, `${wPath}.seed`) !== seed) fail(`${path}.random_seed`, 'must match workload.seed; edit both to change the effective seed');
    numeric(workload.base_interval_ms, 0, 1000, `${wPath}.base_interval_ms`);
    numeric(workload.burst_interval_ms, 0, 1000, `${wPath}.burst_interval_ms`);
    const burst = numeric(workload.burst_length, 0, 10000, `${wPath}.burst_length`);
    const normal = numeric(workload.normal_length, 0, 10000, `${wPath}.normal_length`);
    if (type === 'BURST' && burst + normal === 0) fail(wPath, 'burst and normal lengths cannot both be zero');
    numeric(workload.period_length, 1, 10000, `${wPath}.period_length`);
    numeric(workload.amplitude_pct, 0, 100, `${wPath}.amplitude_pct`, false);
    numeric(workload.lambda, 0, 1000, `${wPath}.lambda`, false);
    payload(workload, wPath);
    if (!Array.isArray(workload.phases) || workload.phases.length > 32) fail(`${wPath}.phases`, 'must be an array with at most 32 phases');
    const phaseNames = new Set<unknown>(); let phaseRequests = 0;
    workload.phases.forEach((entry, phaseIndex) => {
      const pPath = `${wPath}.phases[${phaseIndex}]`, phase = fields(entry, phaseKeys, pPath);
      name(phase.name, `${pPath}.name`);
      if (phaseNames.has(phase.name)) fail(`${pPath}.name`, 'duplicates another phase'); phaseNames.add(phase.name);
      numeric(phase.interval_ms, 0, 1000, `${pPath}.interval_ms`);
      phaseRequests += numeric(phase.request_count, 0, 10000, `${pPath}.request_count`);
      payload(phase, pPath);
    });
    if (workload.phases.length && phaseRequests === 0) fail(`${wPath}.phases`, 'must contain some work');
  });
  if (capacity > budget) fail('config.global_buffer_budget', 'must cover the initial allocation');
  if (requests > 100000) fail('config.streams', 'cannot request more than 100,000 operations in total');
  const metrics = fields(request.metrics, ['interval_ms', 'window_ms'], 'metrics');
  const interval = numeric(metrics.interval_ms, 10, 1000, 'metrics.interval_ms');
  numeric(metrics.window_ms, interval, 60000, 'metrics.window_ms');
  return value as CreateRun;
}

export function reusableConfiguration(run: RunSummary): CreateRun {
  // Only these three public configuration fields cross into the new request.
  const { strategy, config, metrics } = run.configuration;
  return parseReusableConfiguration(JSON.stringify({ strategy, config, metrics }));
}
