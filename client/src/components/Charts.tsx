import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Snapshot } from '../types/api';
import type { ResizeTimelineEvent } from './resizeTimeline';
import './Charts.css';

type ChartKind = 'throughput' | 'occupancy' | 'waiting';
const details = {
  throughput: { title: 'Throughput Over Time', unit: 'req/s', description: 'Measured request throughput in the native metrics window.', key: 'throughput_req_per_sec', name: 'Throughput' },
  occupancy: { title: 'Buffer Occupancy', unit: 'slots', description: 'Current occupied slots and actual allocated capacity across all streams.', key: 'occupancy', name: 'Occupancy' },
  waiting: { title: 'Producer Backpressure', unit: 'ms', description: 'Producer waiting accumulated within each native metrics window.', key: 'producer_wait_ms', name: 'Producer waiting' },
};

const markerTime = (seconds?: number) => seconds?.toLocaleString(undefined, { maximumFractionDigits: 3 }) ?? 'unavailable';
function markerName(event: ResizeTimelineEvent) {
  return `Resize #${event.index}: ${event.outcome}, trigger sample ${markerTime(event.triggerSeconds)} s`;
}
function markerDescription(event: ResizeTimelineEvent) {
  const capacity = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 'unavailable';
  const streams = Array.isArray(event.record.streams) ? event.record.streams.filter(Boolean).map(stream => `Stream ${capacity(stream.stream_id)}: previous ${capacity(stream.previous_capacity)}, requested ${capacity(stream.requested_capacity)}, actual ${capacity(stream.actual_capacity)} slots`).join('; ') : 'Stream capacities unavailable';
  return `${markerName(event)}. Trigger sample time, not exact resize time. ${streams}. ${typeof event.record.reason === 'string' && event.record.reason ? event.record.reason : 'Engine reason unavailable.'}`;
}
function ResizeMarker({ event, selected, onSelect, x1, y1, x2, y2 }: { event: ResizeTimelineEvent; selected: boolean; onSelect?: (index: number) => void; x1?: number; y1?: number; x2?: number; y2?: number }) {
  if ([x1, y1, x2, y2].some(value => typeof value !== 'number' || !Number.isFinite(value))) return <g />;
  return <g className="resize-chart-marker" data-resize-index={event.index} aria-hidden="true" onClick={() => onSelect?.(event.index)}>
    <title>{markerDescription(event)}</title>
    <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={selected ? 'var(--info)' : 'var(--secondary)'} strokeWidth={selected ? 2 : 1} strokeDasharray="2 5" />
    <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent" strokeWidth={14} />
  </g>;
}

export function MetricChart({ snapshots, kind, resizeEvents, selectedResizeIndex, onSelectResize }: { snapshots: Snapshot[]; kind: ChartKind; resizeEvents?: ResizeTimelineEvent[]; selectedResizeIndex?: number; onSelectResize?: (index: number) => void }) {
  const meta = details[kind];
  const data = snapshots.map(sample => ({ ...sample.global, seconds: sample.elapsed_ms / 1000 }));
  const markers = kind === 'waiting' ? [] : (resizeEvents ?? []).filter(event => typeof event.triggerSeconds === 'number' && Number.isFinite(event.triggerSeconds) && event.triggerSeconds >= 0);
  return <section className="panel chart-panel" aria-label={meta.title}>
    <div className="panel-heading"><h2>{meta.title}</h2><span className="eyebrow">{meta.unit}</span></div>
    <p className="chart-description">{meta.description}</p>
    {data.length === 0 ? <div className="chart-empty empty-state">No measured samples available yet.</div> :
      <div className="chart-canvas" role="img" aria-label={`${meta.title}. ${data.length} native samples; horizontal axis is simulation elapsed seconds, vertical axis is ${meta.unit}. Latest ${meta.name}: ${data.at(-1)?.[meta.key as keyof typeof data[number]]} ${meta.unit}.`}>
        <ResponsiveContainer width="100%" height={220} minWidth={0}>
          <LineChart data={data} margin={{ top: 12, right: 16, left: 0, bottom: 12 }}>
            <CartesianGrid stroke="var(--border)" vertical={false} strokeDasharray="3 4" />
            <XAxis dataKey="seconds" type="number" domain={['dataMin', 'dataMax']} tickFormatter={seconds => Number(seconds).toFixed(1)} tick={{ fill: 'var(--secondary)', fontSize: 11 }} tickLine={false} axisLine={{ stroke: 'var(--border)' }} label={{ value: 'Native elapsed (s)', position: 'insideBottom', offset: -10, fill: 'var(--secondary)', fontSize: 11 }} />
            <YAxis width={52} tick={{ fill: 'var(--secondary)', fontSize: 11 }} tickLine={false} axisLine={false} />
            <Tooltip position={resizeEvents ? { x: 0, y: 0 } : undefined} wrapperStyle={resizeEvents ? { maxWidth: '100%', whiteSpace: 'normal' } : undefined} contentStyle={{ background: 'var(--elevated)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: 12, ...(resizeEvents ? { maxWidth: '100%', whiteSpace: 'normal', overflowWrap: 'anywhere' as const } : {}) }} itemStyle={resizeEvents ? { whiteSpace: 'normal' } : undefined} labelFormatter={value => `Native elapsed: ${value} s`} formatter={(value, name) => [`${value} ${meta.unit}`, name]} />
            {kind === 'occupancy' && <Legend wrapperStyle={{ fontSize: 11 }} verticalAlign="top" height={24} />}
            <Line dataKey={meta.key} name={meta.name} type="linear" stroke="var(--accent)" strokeWidth={2} dot={data.length === 1} activeDot={{ r: 4 }} isAnimationActive={false} connectNulls={false} />
            {kind === 'occupancy' && <Line dataKey="capacity" name="Actual capacity" type="stepAfter" stroke="var(--info)" strokeWidth={2} dot={false} strokeDasharray="5 3" isAnimationActive={false} connectNulls={false} />}
            {markers.map(event => <ReferenceLine key={event.index} x={event.triggerSeconds} ifOverflow="discard" shape={<ResizeMarker event={event} selected={selectedResizeIndex === event.index} onSelect={onSelectResize} />} />)}
          </LineChart>
        </ResponsiveContainer>
      </div>}
    {markers.length > 0 && <div className="chart-resize-controls" aria-label={`${meta.title} resize markers`}>
      <p>Resize markers use the triggering native sample, not exact resize time. Select an event to reveal its timeline entry.</p>
      <div className="chart-resize-buttons">{markers.map(event => <button type="button" key={event.index} aria-label={markerName(event)} aria-pressed={selectedResizeIndex === event.index} title={markerDescription(event)} onClick={() => onSelectResize?.(event.index)}>#{event.index} · {event.outcome} · {markerTime(event.triggerSeconds)} s</button>)}</div>
    </div>}
  </section>;
}
