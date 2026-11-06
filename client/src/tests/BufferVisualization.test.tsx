import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { BufferVisualization } from '../components/BufferVisualization';
import type { Observation, RunSummary, Snapshot } from '../types/api';

afterEach(cleanup);

const run: RunSummary = {
  id: 'buffer-fixture', status: 'running', createdAt: '2026-11-04T00:00:00Z',
  startedAt: null, endedAt: null, progress: null, error: null,
  cancellationMode: 'terminate', cancellationRequested: false,
  configuration: { strategy: 'adaptive', metrics: { interval_ms: 100, window_ms: 1000 },
    config: { global_buffer_budget: 128, streams: [0, 1].map(stream_id => ({
      stream_id, name: `Stream-${stream_id}`, buffer_capacity: 64,
      num_requests: 100, producer_interval_ms: 0, consumer_processing_ms: 1,
      min_payload_bytes: 64, max_payload_bytes: 64, random_seed: 42,
      workload: { type: 'STEADY' },
    })) } },
};
function observation(stream_id: number, occupancy: number, capacity: number): Observation {
  return { stream_id, occupancy, capacity, produced: 100, consumed: 50, bytes: 3200,
    full_events: 0, empty_events: 0, throughput_req_per_sec: 10, throughput_mb_per_sec: 0,
    avg_latency_ms: 1, avg_occupancy_slots: 1, utilization_pct: 3,
    producer_wait_ms: 0, consumer_wait_ms: 0, p50_latency_upper_ms: 1, p95_latency_upper_ms: 2 };
}
function sample(streams: Observation[]): Snapshot {
  return { type: 'metrics_snapshot', sequence: 2, elapsed_ms: 1250, window_ms: 1000,
    final_sample: false, global: observation(0, 0, 128), streams };
}
const card = (id = 0) => screen.getByRole('article', { name: `Stream ${id} buffer` });
const meter = (id = 0) => screen.getByRole('meter', { name: `Stream ${id} buffer occupancy` });

describe('sampled buffer visualization', () => {
  it('renders actual telemetry and discrete slots for multiple streams', () => {
    render(<BufferVisualization run={run} snapshot={sample([observation(0, 11, 16), observation(1, 2, 8)])} />);
    expect(meter().getAttribute('aria-valuenow')).toBe('11');
    expect(meter().getAttribute('aria-valuemax')).toBe('16');
    expect(meter(1).getAttribute('aria-valuenow')).toBe('2');
    expect(card().querySelectorAll('.buffer-slot')).toHaveLength(16);
    expect(card().querySelectorAll('.buffer-slot.is-occupied')).toHaveLength(11);
  });

  it('calculates instantaneous utilization rather than using window utilization', () => {
    render(<BufferVisualization run={run} snapshot={sample([observation(0, 11, 16)])} />);
    expect(card().textContent).toMatch(/68\.8|68\.75/);
    expect(card().textContent).not.toMatch(/\b3%/);
  });

  it('does not substitute configured capacity when telemetry has not arrived', () => {
    render(<BufferVisualization run={run} />);
    expect(screen.queryByRole('meter')).toBeNull();
    expect(card().textContent).toContain('—');
    expect(card().querySelectorAll('.buffer-slot')).toHaveLength(0);
  });

  it('keeps a missing stream unavailable instead of copying another stream', () => {
    render(<BufferVisualization run={run} snapshot={sample([observation(0, 11, 16)])} />);
    expect(within(card(1)).queryByRole('meter')).toBeNull();
    expect(card(1).textContent).toContain('—');
  });

  it.each([[0, 0], [0, -1], [-1, 8], [9, 8], [NaN, 8], [1, Infinity], [0.5, 8], [1, 8.5]])(
    'handles invalid occupancy %s and capacity %s without rendering a false meter', (occupancy, capacity) => {
      render(<BufferVisualization run={run} snapshot={sample([observation(0, occupancy, capacity)])} />);
      expect(within(card()).queryByRole('meter')).toBeNull();
      expect(card().textContent).toContain('—');
      expect(card().querySelectorAll('.buffer-slot')).toHaveLength(0);
    },
  );

  it('shows valid empty and full buffers without inventing error or worker states', () => {
    render(<BufferVisualization run={run} snapshot={sample([observation(0, 0, 8), observation(1, 8, 8)])} />);
    expect(meter().getAttribute('aria-valuenow')).toBe('0');
    expect(meter(1).getAttribute('aria-valuenow')).toBe('8');
    expect(card().querySelectorAll('.is-occupied')).toHaveLength(0);
    expect(card(1).querySelectorAll('.is-occupied')).toHaveLength(8);
    expect(card().textContent).toContain('Running');
    expect(card(1).textContent).not.toMatch(/blocked|worker active|error/i);
  });

  it('uses bounded rendering for large measured capacities', () => {
    render(<BufferVisualization run={run} snapshot={sample([observation(0, 500000, 1000000)])} />);
    expect(meter().getAttribute('aria-valuemax')).toBe('1000000');
    expect(card().querySelectorAll('.buffer-slot').length).toBeLessThanOrEqual(64);
    expect(card().querySelectorAll('*').length).toBeLessThan(100);
  });

  it('updates sampled values and labels retained telemetry with the current run state', () => {
    const view = render(<BufferVisualization run={run} snapshot={sample([observation(0, 1, 8)])} />);
    view.rerender(<BufferVisualization run={{ ...run, status: 'cancelled' }} snapshot={sample([observation(0, 4, 16)])} />);
    expect(meter().getAttribute('aria-valuenow')).toBe('4');
    expect(meter().getAttribute('aria-valuemax')).toBe('16');
    expect(card().textContent).toContain('Cancelled');
  });
});
