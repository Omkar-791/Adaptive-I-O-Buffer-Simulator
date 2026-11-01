import { Link } from 'react-router-dom';
import { Square } from 'lucide-react';
import type { RunSummary, Result, TelemetryEvent, Snapshot, Resize } from '../types/api';
import { activeRun } from '../hooks/useRun';
import { MetricChart } from './Charts';

const labels: Record<string, string> = { starting: 'Starting', running: 'Running', completed: 'Completed', failed: 'Failed', cancelled: 'Cancelled', timed_out: 'Timed out' };
export const statusLabel = (status: string) => labels[status] ?? status;
const value = (number?: number, digits = 1) => number === undefined ? '—' : number.toLocaleString(undefined, { maximumFractionDigits: digits });

export function RunStrip({ run, snapshots, cancel, cancelling }: { run: RunSummary; snapshots: Snapshot[]; cancel: () => void; cancelling: boolean }) {
  const latest = snapshots.at(-1);
  return <section className="panel run-strip" aria-label="Selected run">
    <div className="run-meta"><span className="eyebrow">RUN</span><Link className="run-id" to={`/runs/${run.id}`}>{run.id}</Link></div>
    <div className="run-meta"><span className="eyebrow">STRATEGY</span><strong>{run.configuration.strategy === 'adaptive' ? 'Adaptive' : 'Fixed'}</strong></div>
    <div className="run-meta"><span className="eyebrow">WORKLOAD</span><span>{[...new Set(run.configuration.config.streams.map(stream => stream.workload.type))].join(' / ') || 'Unavailable'}</span></div>
    <div className="run-meta"><span className="eyebrow">STATE</span><span className={`status status-${run.status}`}>{statusLabel(run.status)}</span></div>
    <div className="run-meta"><span className="eyebrow">STARTED</span><span>{run.startedAt ? new Date(run.startedAt).toLocaleTimeString() : 'Awaiting process'}</span></div>
    <div className="run-meta"><span className="eyebrow">NATIVE ELAPSED · LAST SAMPLE</span><span>{latest ? `${value(latest.elapsed_ms / 1000, 2)} s` : '—'}</span></div>
    {activeRun(run.status) && <button className="button danger" disabled={cancelling || run.cancellationRequested} onClick={cancel}><Square size={14} />{cancelling || run.cancellationRequested ? 'Termination requested' : 'Cancel run'}</button>}
    {activeRun(run.status) && <span className="cancel-note">Cancellation terminates the native process.</span>}
  </section>;
}

export function Kpis({ snapshots, result, records = [] }: { snapshots: Snapshot[]; result?: Result; records?: TelemetryEvent[] }) {
  const sample = snapshots.at(-1);
  const global = sample?.global;
  const source = result ? 'Whole-run final summary' : sample ? `Native window · ${value(sample.window_ms)} ms` : 'Waiting for native telemetry';
  const resizeCount = records.filter(event => event.record.type === 'buffer_resize').length;
  const latency = result?.avg_latency_ms ?? global?.avg_latency_ms;
  const metrics = [
    ['Throughput', result?.throughput_req_per_sec ?? global?.throughput_req_per_sec, 'req/s', `${source} · Mean latency ${value(latency)} ms`],
    ['Buffer Occupancy', global?.occupancy, 'slots', sample ? `Last native sample · ${value(global?.utilization_pct)}% window utilization` : 'Unavailable · no native sample'],
    ['Backpressure', result?.total_producer_wait_ms ?? global?.producer_wait_ms, 'ms', `Producer waiting · ${source}`],
    ['Buffer Capacity', result?.total_allocated_capacity ?? global?.capacity, 'slots', `${result ? 'Final allocation' : 'Last native sample'} · ${resizeCount} retained resize decisions`],
  ] as const;
  return <div className="kpi-grid">{metrics.map(([label, number, unit, support]) => <section className="panel kpi" key={label} aria-label={label}>
    <div className="kpi-label">{label}</div><div className="kpi-value">{number === undefined ? <span>Unavailable</span> : value(number)} <span>{number === undefined ? '' : unit}</span></div><div className="kpi-support">{support}</div>
  </section>)}</div>;
}

export function AllocationEvents({ run, records, snapshots }: { run: RunSummary; records: TelemetryEvent[]; snapshots: Snapshot[] }) {
  const events = records.filter((event): event is TelemetryEvent & { record: Resize } => event.record.type === 'buffer_resize');
  return <section className="panel allocation-panel"><div className="panel-heading"><h2>Adaptive Allocation Events</h2><span className="eyebrow">{events.length} retained</span></div>
    {!events.length ? <div className="empty-state">{run.configuration.strategy === 'fixed' ? 'This run uses fixed buffer capacities. No adaptive resize events are expected.' : 'No adaptive resize events have been received.'}</div> :
      <ol className="event-list">{events.map(({ index, receivedAt, record }) => {
        const sample = snapshots.find(snapshot => snapshot.sequence === record.snapshot_sequence);
        return <li className="event-row" key={index}>
          <div className="event-heading"><span className={`status status-${record.success ? 'completed' : 'timed_out'}`}>{record.success ? 'Applied' : record.deferred ? 'Deferred' : record.stale ? 'Stale' : 'Not applied'}</span><time>{sample ? `Native ${value(sample.elapsed_ms / 1000, 2)} s` : `Received ${new Date(receivedAt).toLocaleTimeString()}`}</time></div>
          <div>{record.streams.map(stream => <span className="resize-stream" key={stream.stream_id}>Stream {stream.stream_id}: {stream.previous_capacity} → {stream.actual_capacity} slots <span className="secondary">(requested {stream.requested_capacity})</span></span>)}</div>
          <p>{record.reason}</p>
        </li>;
      })}</ol>}
  </section>;
}

export function StreamTable({ run, snapshots, result }: { run: RunSummary; snapshots: Snapshot[]; result?: Result }) {
  const last = snapshots.at(-1);
  return <section className="panel"><div className="panel-heading"><h2>Stream Overview</h2><span className="eyebrow">{result ? 'Final counts · last measured occupancy' : 'Latest native sample'}</span></div>
    <div className="table-scroll"><table><thead><tr><th>Stream</th><th>Capacity</th><th>Occupancy</th><th>Completed</th><th>Throughput</th><th>Producer waiting</th><th>Run state</th></tr></thead><tbody>
      {run.configuration.config.streams.map(stream => {
        const sample = last?.streams.find(item => item.stream_id === stream.stream_id);
        const final = result?.streams.find(item => item.stream_id === stream.stream_id);
        return <tr key={stream.stream_id}><td><strong>{stream.name}</strong><small>Stream {stream.stream_id}</small></td><td>{value(final?.buffer_capacity ?? sample?.capacity ?? stream.buffer_capacity, 0)} slots<small>{final ? 'Final allocation' : sample ? 'Latest native sample' : 'Configured initial'}</small></td><td>{value(sample?.occupancy, 0)}{sample && ' slots'}</td><td>{value(final?.total_consumed ?? sample?.consumed, 0)} / {value(stream.num_requests, 0)}</td><td>{value(final?.throughput_req_per_sec ?? sample?.throughput_req_per_sec)} req/s<small>{final ? 'Whole run' : 'Metrics window'}</small></td><td>{value(final?.total_producer_wait_ms ?? sample?.producer_wait_ms)} ms<small>{final ? 'Whole run' : 'Metrics window'}</small></td><td><span className={`status status-${run.status}`}>{statusLabel(run.status)}</span></td></tr>;
      })}
    </tbody></table></div><p className="table-note">Per-stream worker status is unavailable; state above is the backend run state. Occupancy is the last retained measurement.</p>
  </section>;
}

export function RunView({ run, records, result, cancel, cancelling }: { run: RunSummary; records: TelemetryEvent[]; result?: Result; cancel: () => void; cancelling: boolean }) {
  const snapshots = records.flatMap(event => event.record.type === 'metrics_snapshot' ? [event.record] : []);
  return <div className="run-view">
    <RunStrip run={run} snapshots={snapshots} cancel={cancel} cancelling={cancelling} />
    {run.error && <div className="error-message" role="alert"><strong>{run.error.code}</strong> · {run.error.message}</div>}
    {run.status !== 'completed' && !activeRun(run.status) && <p className="notice">This run {statusLabel(run.status).toLowerCase()}. Retained samples are partial telemetry; a successful final result is unavailable.</p>}
    <Kpis snapshots={snapshots} result={result} records={records} />
    <div className="chart-grid"><MetricChart snapshots={snapshots} kind="throughput" /><MetricChart snapshots={snapshots} kind="occupancy" /></div>
    <div className="chart-grid"><MetricChart snapshots={snapshots} kind="waiting" /><AllocationEvents run={run} records={records} snapshots={snapshots} /></div>
    <StreamTable run={run} snapshots={snapshots} result={result} />
  </div>;
}
