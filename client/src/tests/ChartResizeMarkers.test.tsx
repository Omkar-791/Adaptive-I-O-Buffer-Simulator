import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MetricChart } from '../components/Charts';
import { buildResizeEvents } from '../components/resizeTimeline';
import type { Resize, Snapshot, TelemetryEvent } from '../types/api';

// Capture chart props without depending on jsdom layout; actual SVG interactions are browser-tested.
const captured = vi.hoisted(() => ({ data: [] as unknown[], lines: [] as { dataKey: string; type: string }[] }));
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  LineChart: ({ data, children }: { data: unknown[]; children: ReactNode }) => { captured.data = data; return <div>{children}</div>; },
  Line: ({ dataKey, type }: { dataKey: string; type: string }) => { captured.lines.push({ dataKey, type }); return null; },
  CartesianGrid: () => null, Legend: () => null, Tooltip: () => null, XAxis: () => null, YAxis: () => null,
  ReferenceLine: ({ x }: { x: number }) => <span data-testid="marker-time">{x}</span>,
}));
afterEach(() => { cleanup(); captured.lines = []; captured.data = []; });
const record: Resize = { type: 'buffer_resize', snapshot_sequence: 1, success: false, deferred: true, stale: false, reason: 'Queue remains busy', streams: [{ stream_id: 7, previous_capacity: 8, requested_capacity: 4, actual_capacity: 8 }] };
const telemetry = (index: number, overrides: Partial<Resize> = {}): TelemetryEvent => ({ index, receivedAt: '2026-11-04T10:00:00Z', record: { ...record, ...overrides } });
const snapshots = [{ type: 'metrics_snapshot', sequence: 1, elapsed_ms: 1250, global: { throughput_req_per_sec: 12, occupancy: 3, capacity: 8 } }] as Snapshot[];

it('keeps measured data and stepwise capacity intact while adding trigger-time markers', () => {
  render(<MetricChart snapshots={snapshots} kind="occupancy" resizeEvents={buildResizeEvents([telemetry(5)], snapshots)} />);
  expect(captured.data).toEqual([{ ...snapshots[0].global, seconds: 1.25 }]);
  expect(captured.lines).toContainEqual({ dataKey: 'capacity', type: 'stepAfter' });
  expect(screen.getByTestId('marker-time').textContent).toBe('1.25');
});
it('selects the exact event, keeps repeated trigger times distinct and identifies actual outcome', () => {
  const onSelect = vi.fn();
  render(<MetricChart snapshots={snapshots} kind="throughput" resizeEvents={buildResizeEvents([telemetry(5), telemetry(6, { deferred: false, stale: true })], snapshots)} selectedResizeIndex={6} onSelectResize={onSelect} />);
  const deferred = screen.getByRole('button', { name: 'Resize #5: Deferred, trigger sample 1.25 s' });
  const stale = screen.getByRole('button', { name: 'Resize #6: Stale, trigger sample 1.25 s' });
  expect(stale.getAttribute('aria-pressed')).toBe('true');
  expect(deferred.title).toContain('previous 8, requested 4, actual 8');
  expect(deferred.title).toContain('Queue remains busy');
  deferred.focus(); expect(document.activeElement).toBe(deferred);
  fireEvent.click(deferred); expect(onSelect).toHaveBeenCalledWith(5);
});
it('omits unpositionable events instead of borrowing backend receipt time', () => {
  render(<MetricChart snapshots={snapshots} kind="throughput" resizeEvents={buildResizeEvents([telemetry(5, { snapshot_sequence: 9 })], snapshots)} />);
  expect(screen.queryByRole('button')).toBeNull();
  expect(screen.queryByTestId('marker-time')).toBeNull();
});
it('handles missing capacities/reason safely without fabricating values', () => {
  render(<MetricChart snapshots={snapshots} kind="throughput" resizeEvents={buildResizeEvents([telemetry(5, { streams: undefined as unknown as Resize['streams'], reason: '' })], snapshots)} />);
  expect(screen.getByRole('button').title).toContain('Engine reason unavailable');
});
it('does not add markers to default charts or producer-waiting chart', () => {
  const view = render(<MetricChart snapshots={snapshots} kind="throughput" />);
  expect(screen.queryByRole('button')).toBeNull();
  view.rerender(<MetricChart snapshots={snapshots} kind="waiting" resizeEvents={buildResizeEvents([telemetry(5)], snapshots)} />);
  expect(screen.queryByRole('button')).toBeNull();
});
