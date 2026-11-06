import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { useEffect, useState, type ReactNode } from 'react';
import recorded from './fixtures/native-short.ndjson?raw';
import { buildRunComparison, comparableValues } from '../components/runComparison';
import type { AnalysisMember } from '../components/analysis';
import type { Result, RunSummary, Snapshot } from '../types/api';
import GeneralComparison from '../components/GeneralComparison';

const { observe } = vi.hoisted(() => ({ observe: vi.fn() }));
vi.mock('../hooks/useRun', () => ({ useRun: observe }));
vi.mock('../components/ExportActions', () => ({ ComparisonExportActions: ({ members }: { members: AnalysisMember[] }) => <span aria-label="Exported comparison members">{JSON.stringify(members.map(member => ({ id: member.requestedId, retained: member.records.length, throughput: member.result?.throughput_req_per_sec })))}</span> }));
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  BarChart: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Bar: () => null, CartesianGrid: () => null, Tooltip: () => null, XAxis: () => null, YAxis: () => null,
}));
const native = recorded.trim().split('\n').map(line => JSON.parse(line));
function member(id = 'fixed', strategy: 'fixed' | 'adaptive' = 'fixed'): AnalysisMember {
  const result = structuredClone(native.at(-1)) as Result;
  const run: RunSummary = { id, status: 'completed', createdAt: '2026-11-04T00:00:00Z', startedAt: '2026-11-04T00:00:01Z', endedAt: '2026-11-04T00:00:03Z', progress: null, error: null, cancellationRequested: false, cancellationMode: 'terminate', configuration: { strategy, metrics: { interval_ms: 10, window_ms: 20 }, config: { global_buffer_budget: 8, streams: [{ stream_id: 0, name: 'Stream-0', buffer_capacity: 8, num_requests: 3, producer_interval_ms: 0, consumer_processing_ms: 0, min_payload_bytes: 512, max_payload_bytes: 4096, random_seed: 42, workload: { type: 'STEADY' } }] } } };
  return { requestedId: id, run, result, records: [], truncated: false, clientTruncated: false };
}
const row = (members: AnalysisMember[], key: string) => buildRunComparison(members).metrics.find(metric => metric.key === key)!;

describe('general comparison data contract', () => {
  it('uses exact successful native measurements for arbitrary strategies and multiple runs', () => {
    const members = [member('one'), member('two'), member('three', 'adaptive')];
    expect(row(members, 'throughput_req_per_sec').values.map(value => value.value)).toEqual([4927.7267, 4927.7267, 4927.7267]);
    expect(row(members, 'total_consumed').values.every(value => value.value === 3 && value.availability === 'measured')).toBe(true);
    expect(row(members, 'avg_latency_ms').comparable).toBe(true);
  });
  it('keeps differing workloads/configurations and native durations visible without rejecting descriptive values', () => {
    const first = member('one'), second = member('two', 'adaptive');
    second.run!.configuration.config.streams[0].workload.type = 'BURST';
    second.result!.simulation_time_sec = 15;
    const model = buildRunComparison([first, second]);
    expect(model.warnings.join(' ')).toContain('configurations differ');
    expect(model.warnings.join(' ')).toContain('durations differ');
    expect(model.runs[1].workloads).toEqual(['BURST']);
    expect(model.runs[1].nativeDurationSec).toBe(15);
    expect(model.runs[1].wallClockDurationSec).toBe(2);
    expect(model.limitations).toContain('not a controlled benchmark');
  });
  it.each([undefined, NaN, Infinity])('does not substitute zero for unavailable throughput %s', throughput => {
    const first = member(); first.result!.throughput_req_per_sec = throughput as number;
    const cell = row([first, member('second')], 'throughput_req_per_sec').values[0];
    expect(cell.value).toBeNull(); expect(cell.availability).toBe('unavailable');
    expect(row([first, member('second')], 'throughput_req_per_sec').comparable).toBe(false);
  });
  it.each(['failed', 'cancelled', 'timed_out'] as const)('does not expose stale final metrics for %s', status => {
    const failed = member(); failed.run!.status = status;
    expect(row([failed], 'total_consumed').values[0].value).toBeNull();
    expect(row([failed], 'simulation_time_sec').values[0].value).toBeNull();
  });
  it('labels available percentile bucket bounds as retained windows and does not invent failed operations or p99', () => {
    const observed = member(); const snapshot = structuredClone(native[0]) as Snapshot;
    snapshot.window_ms = 125; snapshot.elapsed_ms = 1000; snapshot.global.p95_latency_upper_ms = 64;
    observed.records = [{ index: 2, receivedAt: '2026-11-04T00:00:00Z', record: snapshot }]; observed.truncated = true;
    const cell = row([observed], 'p95_latency_upper_ms').values[0];
    expect(cell.value).toBe(64); expect(cell.source).toContain('125 ms, ending 1000 ms'); expect(cell.source).toContain('not an exact or whole-run percentile');
    expect(row([observed], 'failed_operations').values[0].value).toBeNull();
    expect(row([observed], 'p99_latency_ms').values[0].value).toBeNull();
    expect(buildRunComparison([observed]).warnings.join(' ')).toContain('evicted');
  });
  it('uses measured capacity instead of configured initial capacity and does not replace missing telemetry', () => {
    const observed = member(); observed.result!.total_allocated_capacity = 4;
    expect(row([observed], 'capacity').values[0].value).toBe(4);
    expect(row([observed], 'occupancy').values[0].value).toBeNull();
    expect(row([observed], 'retained_resize_attempts').values[0].value).toBeNull();
    observed.result = undefined;
    expect(row([observed], 'capacity').values[0].value).toBeNull();
  });
  it('treats zero histogram bounds as absent observations while preserving positive-window zero utilization', () => {
    const observed = member(); const snapshot = structuredClone(native[0]) as Snapshot;
    observed.records = [{ index: 1, receivedAt: '2026-11-04T00:00:00Z', record: snapshot }];
    expect(row([observed], 'p50_latency_upper_ms').values[0].value).toBeNull();
    expect(row([observed], 'utilization_pct').values[0].value).toBeNull();
    snapshot.window_ms = 100; snapshot.elapsed_ms = 100;
    expect(row([observed], 'p95_latency_upper_ms').values[0].value).toBeNull();
    expect(row([observed], 'p95_latency_upper_ms').values[0].source).toContain('no populated histogram');
    expect(row([observed], 'utilization_pct').values[0].value).toBe(0);
  });
  it('derives retained outcomes without hiding unsuccessful attempts or claiming a full history', () => {
    const observed = member(); observed.records = [
      { index: 1, receivedAt: '2026-11-04T00:00:00Z', record: { type: 'buffer_resize', snapshot_sequence: 1, success: true, deferred: false, stale: false, reason: 'Applied', streams: [] } },
      { index: 2, receivedAt: '2026-11-04T00:00:00Z', record: { type: 'buffer_resize', snapshot_sequence: 2, success: false, deferred: true, stale: true, reason: 'Retained failure', streams: [] } },
    ];
    expect(row([observed], 'retained_resize_attempts').values[0].value).toBe(2);
    expect(row([observed], 'retained_resize_applied').values[0].value).toBe(1);
    expect(row([observed], 'retained_resize_deferred').values[0].value).toBe(1);
    expect(row([observed], 'retained_resize_stale').values[0].value).toBe(1);
    expect(row([observed], 'retained_resize_rejected').values[0].value).toBe(0);
    expect(row([observed], 'retained_resize_attempts').values[0].availability).toBe('derived');
    expect(row([observed], 'retained_resize_attempts').values[0].source).toContain('not a complete historical count');
  });
  it('refuses mixed units or scopes and preserves genuine measured zero', () => {
    const observed = member(); observed.result!.throughput_req_per_sec = 0;
    const values = row([observed, member('second')], 'throughput_req_per_sec').values;
    expect(values[0].value).toBe(0); expect(comparableValues(values)).toBe(true);
    expect(comparableValues([values[0], { ...values[1], unit: 'MB/s' }])).toBe(false);
    expect(comparableValues([values[0], { ...values[1], scope: 'native window 100 ms' }])).toBe(false);
  });
  it('does not present an empty-run default latency as measured while keeping genuine zero work and throughput', () => {
    const empty = member(); empty.result!.total_consumed = 0; empty.result!.avg_latency_ms = 0; empty.result!.throughput_req_per_sec = 0;
    expect(row([empty], 'avg_latency_ms').values[0].value).toBeNull();
    expect(row([empty], 'avg_latency_ms').values[0].source).toContain('no completed operations');
    expect(row([empty], 'total_consumed').values[0].value).toBe(0);
    expect(row([empty], 'throughput_req_per_sec').values[0].value).toBe(0);
  });
  it('deduplicates selected identities without mutating source configuration or records', () => {
    const observed = member(); const before = JSON.stringify(observed);
    expect(buildRunComparison([observed, observed]).runs.length).toBe(1);
    expect(JSON.stringify(observed)).toBe(before);
  });
  it('withholds stale observations whose run identity does not match the requested selection', () => {
    const observed = member('old'); observed.requestedId = 'new';
    const model = buildRunComparison([observed]);
    expect(model.runs[0].runId).toBe('new'); expect(model.runs[0].configuration).toBeNull();
    expect(model.metrics.every(metric => metric.values[0].value === null)).toBe(true);
    expect(model.runs[0].retainedRecords).toBe(0);
  });
});

describe('general comparison selection', () => {
  const members = [member('one'), member('two'), member('three', 'adaptive')];
  beforeEach(() => { observe.mockReset(); observe.mockImplementation((id: string) => ({ ...members.find(member => member.run!.id === id)!, loading: false, retry: vi.fn() })); });
  afterEach(cleanup);
  it('compares multiple arbitrary strategies and renders accessible native selectors', async () => {
    render(<MemoryRouter initialEntries={['/history?comparison=general&compare=one&compare=two&compare=three']}><GeneralComparison runs={members.map(member => member.run!)}/></MemoryRouter>);
    await waitFor(() => expect(screen.getByRole('table', { name: 'General comparison measurements' }).textContent).toContain('4,927.727'));
    expect(screen.getAllByRole('checkbox').length).toBe(3);
    expect(screen.getAllByRole('checkbox').every(input => (input as HTMLInputElement).checked)).toBe(true);
    const box = screen.getAllByRole('checkbox')[0]; box.focus(); expect(document.activeElement).toBe(box); fireEvent.click(box);
    await waitFor(() => expect((screen.getAllByRole('checkbox')[0] as HTMLInputElement).checked).toBe(false));
  });
  it('does not create duplicate observers for repeated URL IDs', async () => {
    render(<MemoryRouter initialEntries={['/history?comparison=general&compare=one&compare=one']}><GeneralComparison runs={members.map(member => member.run!)}/></MemoryRouter>);
    await screen.findByText('Select at least two distinct runs to compare.');
    expect(screen.getAllByText('Native duration · measured')).toHaveLength(1);
    expect(screen.queryByRole('table')).toBeNull();
  });
  it('bounds URL selections and their observations to six distinct runs', async () => {
    const all = Array.from({ length: 8 }, (_, i) => member(`run-${i}`));
    const loaded = new Set<string>();
    observe.mockImplementation((id: string) => {
      loaded.add(id);
      return { ...all.find(item => item.requestedId === id)!, loading: false, retry: vi.fn() };
    });
    render(<MemoryRouter initialEntries={[`/history?comparison=general&${all.map(item => `compare=${item.requestedId}`).join('&')}`]}><GeneralComparison runs={all.map(item => item.run!)}/></MemoryRouter>);
    await waitFor(() => expect(loaded.size).toBe(6));
    expect(screen.getAllByRole('checkbox').filter(input => (input as HTMLInputElement).checked)).toHaveLength(6);
    expect(screen.getAllByRole('checkbox').slice(6).every(input => (input as HTMLInputElement).disabled)).toBe(true);
    expect(JSON.parse(screen.getByLabelText('Exported comparison members').textContent!)).toHaveLength(6);
  });
  it('resets observation scopes on URL push/back/forward and ignores delayed old observations', async () => {
    const all = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'].map(id => member(id));
    const live = new Set<string>();
    const mountCounts = new Map<string, number>();
    const lateUpdates = new Map<string, (value: AnalysisMember) => void>();
    observe.mockImplementation(function useObserved(id: string) {
      const [value, setValue] = useState(all.find(item => item.requestedId === id)!);
      useEffect(() => {
        live.add(id); mountCounts.set(id, (mountCounts.get(id) || 0) + 1);
        lateUpdates.set(id, setValue);
        return () => { live.delete(id); };
      }, [id]);
      return { ...value, loading: false, retry: vi.fn() };
    });
    function Navigation() {
      const navigate = useNavigate();
      return <><button onClick={() => navigate('?comparison=general&compare=one&compare=three')}>Replace overlapping selection</button>
        <button onClick={() => navigate('?comparison=general&compare=four&compare=five')}>Next selection</button>
        <button onClick={() => navigate('?comparison=general&compare=six&compare=seven&compare=eight')}>Last selection</button>
        <button onClick={() => navigate(-1)}>Back</button><button onClick={() => navigate(1)}>Forward</button></>;
    }
    render(<MemoryRouter initialEntries={['/history?comparison=general&compare=one&compare=two']}><Navigation/><GeneralComparison runs={all.map(item => item.run!)}/></MemoryRouter>);
    await waitFor(() => expect([...live].sort()).toEqual(['one', 'two']));
    const oldUpdate = lateUpdates.get('one')!;
    fireEvent.click(screen.getByText('Replace overlapping selection'));
    await waitFor(() => expect([...live].sort()).toEqual(['one', 'three']));
    // The retained ID receives a new observer scope, proving old cache state
    // is discarded rather than merely hidden in the rendered metrics table.
    expect(mountCounts.get('one')).toBe(2);
    const stale = member('one'); stale.result!.throughput_req_per_sec = 999999;
    oldUpdate(stale);
    expect(screen.getByLabelText('Exported comparison members').textContent).not.toContain('999999');
    fireEvent.click(screen.getByText('Next selection'));
    await waitFor(() => expect([...live].sort()).toEqual(['five', 'four']));
    fireEvent.click(screen.getByText('Last selection'));
    await waitFor(() => expect([...live].sort()).toEqual(['eight', 'seven', 'six']));
    fireEvent.click(screen.getByText('Back'));
    await waitFor(() => expect([...live].sort()).toEqual(['five', 'four']));
    fireEvent.click(screen.getByText('Forward'));
    await waitFor(() => expect([...live].sort()).toEqual(['eight', 'seven', 'six']));
    const exported = screen.getByLabelText('Exported comparison members').textContent!;
    expect(JSON.parse(exported).map((item: { id: string }) => item.id)).toEqual(['six', 'seven', 'eight']);
    expect(live.size).toBeLessThanOrEqual(6);
    expect(screen.queryByText('999,999')).toBeNull();
  });
});
