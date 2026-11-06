import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { AdaptiveTimeline } from '../components/AdaptiveTimeline';
import { buildResizeEvents, resizeOutcome } from '../components/resizeTimeline';
import type { Resize, RunSummary, Snapshot, TelemetryEvent } from '../types/api';

afterEach(cleanup);
const run = { configuration: { strategy: 'adaptive' } } as RunSummary;
const record: Resize = { type: 'buffer_resize', snapshot_sequence: 1, success: false, deferred: false, stale: false, reason: 'Native supplied reason', streams: [{ stream_id: 0, previous_capacity: 8, requested_capacity: 4, actual_capacity: 8 }] };
const event = (index: number, overrides: Partial<Resize> = {}): TelemetryEvent => ({ index, receivedAt: '2026-11-04T10:00:00Z', record: { ...record, ...overrides } });
const sample = (sequence: number, elapsed_ms: number): Snapshot => ({ type: 'metrics_snapshot', sequence, elapsed_ms, window_ms: 100, final_sample: false, global: { throughput_req_per_sec: 12, occupancy: 3, capacity: 8 }, streams: [] } as unknown as Snapshot);

it('orders by emission index, deduplicates backend indexes, preserves separate attempts sharing a sequence', () => {
  const events = buildResizeEvents([event(9), event(4), event(9), event(6)], [sample(1, 100)]);
  expect(events.map(e => e.index)).toEqual([4, 6, 9]);
  expect(events.map(e => e.triggerSeconds)).toEqual([0.1, 0.1, 0.1]);
});
it('links trigger and next retained sample without using received wall time as native time', () => {
  const events = buildResizeEvents([event(4)], [sample(3, 300), sample(1, 100), sample(2, 200)]);
  expect(events[0].triggerSeconds).toBe(0.1);
  expect(events[0].nextSnapshot?.sequence).toBe(2);
  expect(buildResizeEvents([event(4)], [sample(3, 300)])[0].triggerSeconds).toBeUndefined();
  expect(buildResizeEvents([event(4)], [sample(1, 100), sample(1, 110)])[0].triggerSeconds).toBeUndefined();
});
it.each([
  [{ success: true }, 'Applied'], [{ deferred: true }, 'Deferred'], [{ stale: true }, 'Stale'],
  [{ deferred: true, stale: true }, 'Deferred · Stale'], [{}, 'Rejected'],
] as [Partial<Resize>, string][])('preserves outcome flags %o', (flags, expected) => {
  expect(resizeOutcome({ ...record, ...flags })).toBe(expected);
});
it('renders every unsuccessful event, capacities and literal engine reason', () => {
  const events = buildResizeEvents([event(1, { deferred: true }), event(2, { stale: true }), event(3)], [sample(1, 100)]);
  render(<AdaptiveTimeline run={run} events={events} idPrefix="test" />);
  expect(screen.getByLabelText('Resize event 1: Deferred')).toBeTruthy();
  expect(screen.getByLabelText('Resize event 2: Stale')).toBeTruthy();
  expect(screen.getByLabelText('Resize event 3: Rejected')).toBeTruthy();
  expect(screen.getAllByText('Previous: 8 slots')).toHaveLength(3);
  expect(screen.getAllByText('Requested: 4 slots')).toHaveLength(3);
  expect(screen.getAllByText('Actual: 8 slots')).toHaveLength(3);
  expect(screen.getAllByText('Engine reason: Native supplied reason')).toHaveLength(3);
});
it('handles unavailable fields and leaves selected event focusable with expanded context', () => {
  const events = buildResizeEvents([{ ...event(4, { reason: '', streams: undefined as unknown as Resize['streams'] }), receivedAt: 'invalid' }], []);
  render(<AdaptiveTimeline run={run} events={events} selectedIndex={4} idPrefix="test" />);
  const item = screen.getByLabelText('Resize event 4: Rejected');
  expect(item.getAttribute('tabindex')).toBe('-1');
  expect(item.querySelector('details')?.open).toBe(true);
  expect(item.textContent).toContain('Trigger sample: unavailable');
  expect(item.textContent).toContain('Engine reason: unavailable');
  expect(item.textContent).toContain('Affected stream capacities unavailable');
  expect(item.textContent).not.toContain('NaN');
});
