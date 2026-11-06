import type { AnalysisMember } from './analysis';
import type { Result, Snapshot } from '../types/api';

export interface ComparisonValue {
  runId: string;
  value: number | null;
  availability: 'measured' | 'derived' | 'unavailable';
  source: string;
  unit: string;
  scope: string;
}
export const generalComparisonLimitations = 'Descriptive observations, not a controlled benchmark. Workloads, initial configurations, run durations and execution conditions can differ. Concurrent processes can compete for CPU and timers. No universal adaptive improvement or statistical significance is established. History is in memory and retained telemetry may be incomplete.';
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;

export function comparableValues(values: ComparisonValue[]) {
  return values.length >= 2 && values.every(value => value.value !== null && finite(value.value) && value.unit === values[0].unit && value.scope === values[0].scope);
}
function latest(member: AnalysisMember): Snapshot | undefined {
  return member.records.flatMap(event => event.record.type === 'metrics_snapshot' ? [event.record] : []).at(-1);
}
function successful(member: AnalysisMember): Result | undefined {
  return member.run?.status === 'completed' && member.result?.success === true ? member.result : undefined;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(',')}}`;
  return JSON.stringify(value);
}

/** One model is shared by the descriptive table, charts and comparison exports. */
export function buildRunComparison(members: AnalysisMember[]) {
  const unique = new Map<string, AnalysisMember>();
  for (const member of members) {
    const id = member.requestedId || member.run?.id;
    if (id && !unique.has(id)) {
      const matchesIdentity = !member.requestedId || member.run?.id === member.requestedId;
      unique.set(id, matchesIdentity ? member : { requestedId: id, run: undefined, result: undefined, records: [], truncated: false, clientTruncated: false, error: member.error || 'Requested run has not supplied a matching observation.' });
    }
  }
  const entries = [...unique];
  const runs = entries.map(([runId, member]) => {
    const result = successful(member);
    const start = member.run?.startedAt ? Date.parse(member.run.startedAt) : NaN;
    const end = member.run?.endedAt ? Date.parse(member.run.endedAt) : NaN;
    return {
      runId, status: member.run?.status ?? 'unavailable', strategy: member.run?.configuration.strategy ?? null,
      configuration: member.run?.configuration ?? null,
      workloads: member.run ? [...new Set(member.run.configuration.config.streams.map(stream => stream.workload.type))] : [],
      nativeDurationSec: finite(result?.simulation_time_sec) ? result.simulation_time_sec : null,
      wallClockDurationSec: Number.isFinite(start) && Number.isFinite(end) && end >= start ? (end - start) / 1000 : null,
      telemetryPartial: member.truncated || member.clientTruncated,
      retainedRecords: member.records.length, observationError: member.error ?? null,
    };
  });
  const value = (id: string, candidate: unknown, unit: string, scope: string, source: string, derived = false): ComparisonValue => ({
    runId: id, value: finite(candidate) ? candidate : null,
    availability: finite(candidate) ? derived ? 'derived' : 'measured' : 'unavailable',
    unit, scope, source,
  });
  const definitions: { key: string; label: string; unit: string; scope: string; read: (member: AnalysisMember, id: string) => ComparisonValue }[] = [];
  const whole = (key: keyof Result, label: string, unit: string) => definitions.push({ key, label, unit, scope: 'whole-run final', read: (member, id) => {
    const result = successful(member);
    const emptyLatency = result !== undefined && key === 'avg_latency_ms' && (!finite(result.total_consumed) || result.total_consumed === 0);
    return value(id, emptyLatency ? undefined : result?.[key], unit, 'whole-run final', emptyLatency ? 'Unavailable: no completed operations supplied latency observations' : result ? 'Successful native final result' : 'Unavailable: no successful whole-run result');
  } });
  whole('total_consumed', 'Completed operations', 'operations');
  whole('throughput_req_per_sec', 'Throughput', 'req/s');
  whole('avg_latency_ms', 'Average latency', 'ms');
  whole('simulation_time_sec', 'Native run duration', 's');
  whole('total_producer_wait_ms', 'Producer waiting', 'ms');
  whole('avg_occupancy_slots', 'Mean occupancy', 'slots');
  whole('avg_occupancy_pct', 'Mean occupancy / capacity', '%');
  for (const [key, label, unit] of [['failed_operations', 'Failed operations', 'operations'], ['p99_latency_ms', 'p99 latency', 'ms']] as const) {
    definitions.push({ key, label, unit, scope: 'unavailable', read: (_member, id) => value(id, undefined, unit, 'unavailable', 'Unavailable: this metric is not exposed by the API') });
  }
  for (const [key, label] of [['p50_latency_upper_ms', 'p50 latency upper bound'], ['p95_latency_upper_ms', 'p95 latency upper bound'], ['utilization_pct', 'Window utilization']] as const) {
    const unit = key === 'utilization_pct' ? '%' : 'ms';
    definitions.push({ key, label: `${label} · last retained window`, unit, scope: 'last retained window', read: (member, id) => {
      const sample = latest(member);
      const hasWindow = sample && finite(sample.window_ms) && sample.window_ms > 0 && finite(sample.elapsed_ms);
      const candidate = sample?.global?.[key];
      const populated = key === 'utilization_pct' || finite(candidate) && candidate > 0;
      const timing = hasWindow ? `Native window ${sample.window_ms} ms, ending ${sample.elapsed_ms} ms` : 'Unavailable: no positive retained native window';
      const explanation = !populated ? ' · unavailable: zero latency bound denotes no populated histogram observations' : key !== 'utilization_pct' ? ' · histogram bucket upper bound, not an exact or whole-run percentile' : ' · time-weighted occupancy / capacity';
      return value(id, hasWindow && populated ? candidate : undefined, unit, hasWindow ? `native window ${sample.window_ms} ms` : 'unavailable', timing + explanation);
    } });
  }
  for (const [key, label] of [['capacity', 'Actual allocated capacity'], ['occupancy', 'Occupancy · last retained sample']] as const) {
    definitions.push({ key, label, unit: 'slots', scope: key === 'capacity' ? 'final or last retained' : 'last retained sample', read: (member, id) => {
      const result = successful(member), sample = latest(member);
      const finalCapacity = key === 'capacity' && finite(result?.total_allocated_capacity);
      return value(id, finalCapacity ? result.total_allocated_capacity : sample?.global?.[key], 'slots', finalCapacity ? 'whole-run final allocation' : 'last retained sample', finalCapacity ? 'Successful native final allocation' : sample ? `Native sample ending ${sample.elapsed_ms} ms; may be partial or stale` : 'Unavailable: no measured allocation/sample; configured capacity is not substituted');
    } });
  }
  for (const [key, label] of [['attempts', 'Resize attempts'], ['applied', 'Applied resize attempts'], ['deferred', 'Deferred resize attempts'], ['stale', 'Stale resize attempts'], ['rejected', 'Rejected resize attempts']] as const) {
    definitions.push({ key: `retained_resize_${key}`, label: `${label} · retained only`, unit: 'events', scope: 'retained telemetry', read: (member, id) => {
      const events = member.records.filter(event => event.record.type === 'buffer_resize');
      const count = events.filter(({ record }) => record.type === 'buffer_resize' && (key === 'attempts' || key === 'applied' && record.success || key === 'deferred' && record.deferred || key === 'stale' && record.stale || key === 'rejected' && !record.success && !record.deferred && !record.stale)).length;
      return value(id, member.records.length ? count : undefined, 'events', 'retained telemetry', member.records.length ? `Derived from ${member.records.length} retained records; not a complete historical count. Flags can overlap.` : 'Unavailable: no retained telemetry observations', true);
    } });
  }
  const metrics = definitions.map(definition => {
    const values = entries.map(([id, member]) => definition.read(member, id));
    return { key: definition.key, label: definition.label, unit: definition.unit, scope: definition.scope, values, comparable: comparableValues(values) };
  });
  const warnings: string[] = [];
  if (entries.length < 2) warnings.push('Select at least two distinct runs to compare.');
  if (new Set(runs.map(run => canonical(run.configuration?.config))).size > 1) warnings.push('Effective workloads or initial configurations differ. Interpret values in their configuration context.');
  if (new Set(runs.map(run => run.nativeDurationSec)).size > 1) warnings.push('Native run durations differ or are unavailable. Duration is shown per run.');
  if (runs.some(run => run.telemetryPartial)) warnings.push('Some telemetry has been evicted. Window metrics and resize counts describe retained observations only.');
  if (runs.some(run => run.status !== 'completed')) warnings.push('Some selected runs have no successful final result. Their whole-run metrics remain unavailable.');
  return { runs, metrics, warnings, limitations: generalComparisonLimitations };
}
