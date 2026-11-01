import type { Result, RunSummary, TelemetryEvent } from '../types/api';

export interface AnalysisMember {
  requestedId?: string;
  run?: RunSummary;
  result?: Result;
  records: TelemetryEvent[];
  truncated: boolean;
  clientTruncated: boolean;
  error?: string;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value);
}
function inputs(run: RunSummary) {
  return { metrics: run.configuration.metrics, config: { ...run.configuration.config, streams: [...run.configuration.config.streams].sort((a, b) => a.stream_id - b.stream_id) } };
}
export function comparisonProblem(fixed: AnalysisMember, adaptive: AnalysisMember): string | null {
  if (!fixed.run || !adaptive.run) return 'Select a fixed run and an adaptive run.';
  if (fixed.run.configuration.strategy !== 'fixed' || adaptive.run.configuration.strategy !== 'adaptive') return 'The selected runs must have fixed and adaptive strategies respectively.';
  if (canonical(inputs(fixed.run)) !== canonical(inputs(adaptive.run))) return 'Inputs differ. Match initial capacities, workloads, seeds, requests, budget and sampling settings.';
  if (fixed.run.status !== 'completed' || adaptive.run.status !== 'completed' || !fixed.result || !adaptive.result) return 'Comparison unavailable until both runs have successful final results.';
  const counts = (r: Result) => ({ produced: r.total_produced, consumed: r.total_consumed, bytes: r.total_bytes, streams: [...r.streams].sort((a,b) => a.stream_id-b.stream_id).map(s => [s.stream_id,s.total_produced,s.total_consumed,s.total_bytes]) });
  if (!fixed.result.success || !adaptive.result.success || canonical(counts(fixed.result)) !== canonical(counts(adaptive.result))) return 'Measured request counts or payload bytes differ; these results cannot be paired.';
  if ([fixed.result, adaptive.result].some(r => metricDefinitions.some(m => !Number.isFinite(r[m.key]) || r[m.key] < 0))) return 'Final measurements are invalid or unavailable.';
  return null;
}
export const metricDefinitions = [
  { key: 'throughput_req_per_sec', label: 'Throughput', unit: 'req/s', direction: 'Higher is better' },
  { key: 'avg_latency_ms', label: 'Mean latency', unit: 'ms', direction: 'Lower is better' },
  { key: 'total_producer_wait_ms', label: 'Producer waiting', unit: 'ms', direction: 'Lower is better' },
] as const;
export function comparisonRows(fixed: AnalysisMember, adaptive: AnalysisMember) {
  if (comparisonProblem(fixed, adaptive)) return [];
  return metricDefinitions.map(m => {
    const f = fixed.result![m.key], a = adaptive.result![m.key];
    return { ...m, fixed: f, adaptive: a, delta: a-f, percent: f === 0 ? null : (a-f)/f*100 };
  });
}
export const analysisLimitations = 'Descriptive single-pair comparison. Concurrent runs can compete for CPU and timers. Seeded nominal configurations and measured counts/bytes are checked; native input checksums, executable hashes and statistical significance are unavailable through this API. Use the Phase9 CLI for reproducible multi-repetition evaluation. History is in memory; telemetry is a bounded observed subset.';
export function analysisDataset(fixed: AnalysisMember, adaptive: AnalysisMember) {
  const member = (m: AnalysisMember) => ({ requestedId: m.requestedId || m.run?.id || null, run: m.run ?? null, result: m.result ?? null, records: m.records, backendTruncated: m.truncated, browserTruncated: m.clientTruncated, observationError: m.error ?? null });
  return { schemaVersion: 1, exportedAt: new Date().toISOString(), source: 'Adaptive I/O Lab Phase10 REST / native simulation_completed', limitations: analysisLimitations, comparisonUnavailable: comparisonProblem(fixed, adaptive), metrics: comparisonRows(fixed, adaptive), fixed: member(fixed), adaptive: member(adaptive) };
}
export function analysisCsv(dataset: ReturnType<typeof analysisDataset>) {
  // Quote every field; protect spreadsheet readers from formula interpretation.
  const quote = (value: unknown) => { const s = value === null || value === undefined ? 'NA' : String(value); return `"${(/^[=+@\-\t\r]/.test(s) && typeof value !== 'number' ? "'" : '') + s.replaceAll('"', '""')}"`; };
  const context = JSON.stringify(dataset);
  const header = ['metric','unit','fixed','adaptive','adaptive_minus_fixed','percent_change','context_json'];
  const rows = dataset.metrics.length ? dataset.metrics.map(m => [m.key,m.unit,m.fixed,m.adaptive,m.delta,m.percent,context]) : [['unavailable',null,null,null,null,null,context]];
  return [header,...rows].map(row => row.map(quote).join(',')).join('\r\n')+'\r\n';
}
export function downloadAnalysis(dataset: ReturnType<typeof analysisDataset>, format: 'json'|'csv') {
  const blob = new Blob([format === 'json' ? JSON.stringify(dataset,null,2) : analysisCsv(dataset)], { type: format === 'json' ? 'application/json' : 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob); const a = document.createElement('a');
  a.href = url; a.download = `adaptive-io-comparison.${format}`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
