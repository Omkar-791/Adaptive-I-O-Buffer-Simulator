import { describe, expect, it } from 'vitest';
import { parseReusableConfiguration, reusableConfiguration } from '../components/configReuse';
import type { RunSummary } from '../types/api';

function reuseRun(strategy: 'fixed' | 'adaptive' = 'fixed'): RunSummary {
  return { id: 'old-run', status: 'completed', createdAt: '2026-11-04T00:00:00Z', startedAt: '2026-11-04T00:00:01Z', endedAt: '2026-11-04T00:00:02Z', progress: null, error: null, cancellationMode: 'terminate', cancellationRequested: false,
    configuration: { strategy, metrics: { interval_ms: 20, window_ms: 100 }, config: { global_buffer_budget: 32, streams: [0, 1].map(id => ({ stream_id: id, name: `Stream-${id}`, buffer_capacity: id ? 4 : 8, num_requests: 20, producer_interval_ms: id ? 5 : 0, consumer_processing_ms: id ? 20 : 5, min_payload_bytes: 64, max_payload_bytes: 128, random_seed: 42 + id,
      workload: { type: id ? 'MIXED' : 'BURST', base_interval_ms: id ? 5 : 0, burst_interval_ms: 1, burst_length: 10, normal_length: 5, period_length: 40, amplitude_pct: 32.5, lambda: 0.1, min_payload_bytes: 64, max_payload_bytes: 128, seed: 42 + id, stream_id: id, phases: id ? [{ name: 'FAST', interval_ms: 0, request_count: 10, min_payload_bytes: 64, max_payload_bytes: 128 }, { name: 'SLOW', interval_ms: 10, request_count: 10, min_payload_bytes: 64, max_payload_bytes: 128 }] : [] } })) } } };
}

describe('explicit effective configuration reuse', () => {
  it.each(['fixed', 'adaptive'] as const)('copies only %s configuration, preserving all heterogeneous settings without aliases', strategy => {
    const original = reuseRun(strategy), before = structuredClone(original);
    const request = reusableConfiguration(original);
    expect(request).toEqual(original.configuration);
    expect(Object.keys(request).sort()).toEqual(['config', 'metrics', 'strategy']);
    request.config.streams![0].num_requests = 25;
    (request.config.streams![1].workload.phases as { interval_ms: number }[])[0].interval_ms = 3;
    expect(original).toEqual(before);
    expect(JSON.stringify(request)).not.toContain('old-run');
  });
  it('preserves explicit zeros, decimal workload parameters and mixed phases', () => {
    const original = reuseRun();
    expect(parseReusableConfiguration(JSON.stringify(original.configuration))).toEqual(original.configuration);
  });
  it('does not replace missing fields with defaults', () => {
    const request = structuredClone(reuseRun().configuration);
    delete (request.config.streams[0] as Partial<typeof request.config.streams[0]>).consumer_processing_ms;
    expect(() => parseReusableConfiguration(JSON.stringify(request))).toThrow('no default is substituted');
  });
  it.each([
    ['old run state', (request: Record<string, unknown>) => { request.status = 'completed'; }],
    ['unsupported duration', (request: Record<string, unknown>) => { request.duration_ms = 1000; }],
  ])('rejects %s rather than sending it into a new run', (_label, edit) => {
    const request = structuredClone(reuseRun().configuration); edit(request as unknown as Record<string, unknown>);
    expect(() => parseReusableConfiguration(JSON.stringify(request))).toThrow('unsupported field');
  });
  it.each(['budget', 'duplicate-id', 'request-limit', 'seed-shadow', 'payload', 'metrics', 'unknown-workload', 'empty-phases', 'phase-name', 'fractional'])('rejects invalid edited %s configuration', defect => {
    const request = structuredClone(reuseRun().configuration), first = request.config.streams[0], second = request.config.streams[1];
    if (defect === 'budget') request.config.global_buffer_budget = 1;
    if (defect === 'duplicate-id') second.stream_id = 0;
    if (defect === 'request-limit') first.num_requests = 10001;
    if (defect === 'seed-shadow') first.random_seed++;
    if (defect === 'payload') first.min_payload_bytes = 129;
    if (defect === 'metrics') request.metrics.window_ms = 1;
    if (defect === 'unknown-workload') first.workload.type = 'UNKNOWN';
    if (defect === 'empty-phases') (second.workload.phases as { request_count: number }[]).forEach(phase => { phase.request_count = 0; });
    if (defect === 'phase-name') (second.workload.phases as { name: string }[])[0].name = '../outside';
    if (defect === 'fractional') first.buffer_capacity = 1.5;
    expect(() => parseReusableConfiguration(JSON.stringify(request))).toThrow();
  });
  it('reports malformed JSON', () => { expect(() => parseReusableConfiguration('{broken')).toThrow('valid configuration JSON'); });
});
