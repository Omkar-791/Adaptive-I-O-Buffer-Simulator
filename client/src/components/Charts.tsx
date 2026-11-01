import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Snapshot } from '../types/api';

type ChartKind = 'throughput' | 'occupancy' | 'waiting';
const details = {
  throughput: { title: 'Throughput Over Time', unit: 'req/s', description: 'Measured request throughput in the native metrics window.', key: 'throughput_req_per_sec', name: 'Throughput' },
  occupancy: { title: 'Buffer Occupancy', unit: 'slots', description: 'Current occupied slots and actual allocated capacity across all streams.', key: 'occupancy', name: 'Occupancy' },
  waiting: { title: 'Producer Backpressure', unit: 'ms', description: 'Producer waiting accumulated within each native metrics window.', key: 'producer_wait_ms', name: 'Producer waiting' },
};

export function MetricChart({ snapshots, kind }: { snapshots: Snapshot[]; kind: ChartKind }) {
  const meta = details[kind];
  const data = snapshots.map(sample => ({ ...sample.global, seconds: sample.elapsed_ms / 1000 }));
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
            <Tooltip contentStyle={{ background: 'var(--elevated)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: 12 }} labelFormatter={value => `Native elapsed: ${value} s`} formatter={(value, name) => [`${value} ${meta.unit}`, name]} />
            {kind === 'occupancy' && <Legend wrapperStyle={{ fontSize: 11 }} verticalAlign="top" height={24} />}
            <Line dataKey={meta.key} name={meta.name} type="linear" stroke="var(--accent)" strokeWidth={2} dot={data.length === 1} activeDot={{ r: 4 }} isAnimationActive={false} connectNulls={false} />
            {kind === 'occupancy' && <Line dataKey="capacity" name="Actual capacity" type="stepAfter" stroke="var(--info)" strokeWidth={2} dot={false} strokeDasharray="5 3" isAnimationActive={false} connectNulls={false} />}
          </LineChart>
        </ResponsiveContainer>
      </div>}
  </section>;
}
