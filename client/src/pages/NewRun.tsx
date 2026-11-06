import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Play, SlidersHorizontal } from 'lucide-react';
import { api } from '../api/client';
import type { CreateRun } from '../types/api';
import { defaults, validateForm, type FormValues } from './validation';
import { ConfigurationReuse } from '../components/ConfigurationReuse';

const labels: Record<keyof FormValues, string> = { streams: 'Number of streams', requests: 'Requests per stream', seed: 'Random seed', capacity: 'Buffer capacity', budget: 'Global buffer budget', producer: 'Producer interval', consumer: 'Consumer processing time', minimum: 'Minimum payload size', maximum: 'Maximum payload size', interval: 'Sampling interval', window: 'Metrics window' };
const units: Partial<Record<keyof FormValues, string>> = { capacity: 'slots / stream', budget: 'slots', producer: 'ms', consumer: 'ms', minimum: 'bytes', maximum: 'bytes', interval: 'ms', window: 'ms' };
export default function NewRun() {
  const [params] = useSearchParams();
  const reuse = params.get('reuse');
  return reuse ? <ConfigurationReuse key={reuse} sourceId={reuse}/> : <UniformNewRun/>;
}
function UniformNewRun() {
  const navigate = useNavigate();
  const [values, setValues] = useState<FormValues>(defaults);
  const [strategy, setStrategy] = useState<'fixed' | 'adaptive'>('adaptive');
  const [workload, setWorkload] = useState('STEADY');
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const errors = validateForm(values);
  const numbers = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, Number(value)])) as Record<keyof FormValues, number>;
  const phaseCounts = [Math.ceil(numbers.requests / 3), Math.floor(numbers.requests / 3), numbers.requests - Math.ceil(numbers.requests / 3) - Math.floor(numbers.requests / 3)];
  const phases = phaseCounts.map((request_count, i) => ({ name: ['FAST', 'BASE', 'SLOW'][i], request_count, interval_ms: [0, numbers.producer, Math.min(1000, numbers.producer * 2)][i], min_payload_bytes: numbers.minimum, max_payload_bytes: numbers.maximum }));
  const field = (key: keyof FormValues) => <div className="field" key={key}><label htmlFor={key}>{labels[key]} {units[key] && <span className="muted">({units[key]})</span>}</label><input id={key} name={key} inputMode="numeric" value={values[key]} aria-invalid={attempted && !!errors[key]} aria-describedby={attempted && errors[key] ? `${key}-error` : undefined} onChange={e => setValues(previous => ({ ...previous, [key]: e.target.value }))} />{attempted && errors[key] && <small className="error" id={`${key}-error`}>{errors[key]}</small>}</div>;
  async function submit(event: FormEvent) {
    event.preventDefault(); setAttempted(true); setError('');
    if (busy || Object.keys(errors).length) return;
    if (workload === 'MIXED' && numbers.requests === 0) { setError('Mixed workloads need at least one request so their explicit phases contain work. Other workload types support zero requests.'); return; }
    setBusy(true);
    const body: CreateRun = { strategy, config: { num_streams: numbers.streams, num_requests: numbers.requests, buffer_capacity: numbers.capacity, global_buffer_budget: numbers.budget, producer_interval_ms: numbers.producer, consumer_processing_ms: numbers.consumer, min_payload_bytes: numbers.minimum, max_payload_bytes: numbers.maximum, random_seed: numbers.seed, workload: { type: workload, ...(workload === 'MIXED' ? { phases } : {}) } }, metrics: { interval_ms: numbers.interval, window_ms: numbers.window } };
    try { const run = await api.create(body); navigate(`/runs/${run.id}`); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to start simulation. Retry with the configuration below.'); }
    finally { setBusy(false); }
  }
  return <><div className="page-heading"><div><h1>New Simulation</h1><p>Configure a workload and observe how buffer allocation affects performance.</p></div><SlidersHorizontal size={24} aria-hidden="true" /></div>
    <form className="form-layout" onSubmit={submit} noValidate>
      <div className="configuration-form">
        <section className="panel"><h2>Allocation strategy</h2><div className="segmented" role="group" aria-label="Allocation strategy">{(['fixed', 'adaptive'] as const).map(value => <button type="button" key={value} className={strategy === value ? 'selected' : ''} aria-pressed={strategy === value} onClick={() => setStrategy(value)}>{value === 'fixed' ? 'Fixed Allocation' : 'Adaptive Allocation'}</button>)}</div><p className="muted">{strategy === 'fixed' ? 'Capacities remain as configured for the entire run.' : 'The native controller may redistribute the configured global buffer budget.'}</p></section>
        <section className="panel"><h2>Workload</h2><div className="form-grid">{field('streams')}{field('requests')}<div className="field"><label htmlFor="workload">Workload type</label><select id="workload" value={workload} onChange={e => setWorkload(e.target.value)}>{['STEADY', 'BURST', 'PERIODIC', 'STOCHASTIC', 'MIXED'].map(type => <option key={type} value={type}>{type.charAt(0) + type.slice(1).toLowerCase()}</option>)}</select></div>{field('seed')}</div>
          <p className="muted">One uniform workload is applied to all streams. Effective per-stream seeds appear in the run configuration.</p>
          {workload === 'BURST' && <p className="notice">Native defaults: 20 requests at 1 ms, then 80 at the configured producer interval, repeating.</p>}
          {workload === 'PERIODIC' && <p className="notice">Native defaults: period length 40 requests, amplitude 50% around the producer interval.</p>}
          {workload === 'STOCHASTIC' && <p className="notice">Native default lambda is 0; the engine derives it from the producer interval. The seed controls reproducibility.</p>}
          {workload === 'MIXED' && <div className="notice"><strong>Explicit mixed phases</strong><p>The request count is split into three sequential phases, using the payload range below.</p><ul>{phases.map(phase => <li key={phase.name}>{phase.name}: {phase.request_count} requests · {phase.interval_ms} ms interval</li>)}</ul></div>}
        </section>
        <section className="panel"><h2>Buffer configuration</h2><div className="form-grid">{field('capacity')}{field('budget')}</div><p className="muted">Initial allocation = streams × capacity. It cannot exceed the global budget. Unallocated slots remain available to the adaptive controller.</p>{strategy === 'adaptive' && <p className="notice">Adaptive thresholds, cooldowns and resize step sizes are controlled by the native engine and are not editable through this API.</p>}</section>
        <section className="panel"><h2>Producer and consumer</h2><div className="form-grid">{field('producer')}{field('consumer')}{field('minimum')}{field('maximum')}</div></section>
        <section className="panel"><h2>Metrics</h2><div className="form-grid">{field('interval')}{field('window')}</div><p className="muted">Sampling interval controls telemetry collection frequency. Window metrics summarize recent native activity.</p></section>
      </div>
      <aside className="panel configuration-summary"><span className="eyebrow">LIVE CONFIGURATION</span><h2>Run summary</h2><dl><dt>Strategy</dt><dd>{strategy === 'adaptive' ? 'Adaptive' : 'Fixed'}</dd><dt>Streams</dt><dd>{values.streams || '—'}</dd><dt>Total requests</dt><dd>{Number.isFinite(numbers.streams * numbers.requests) ? (numbers.streams * numbers.requests).toLocaleString() : '—'}</dd><dt>Global budget</dt><dd>{values.budget || '—'} slots</dd><dt>Initial allocation</dt><dd>{Number.isFinite(numbers.streams * numbers.capacity) ? numbers.streams * numbers.capacity : '—'} slots</dd><dt>Workload</dt><dd>{workload}</dd><dt>Producer interval</dt><dd>{values.producer || '—'} ms</dd><dt>Consumer processing</dt><dd>{values.consumer || '—'} ms</dd><dt>Sampling / window</dt><dd>{values.interval} / {values.window} ms</dd></dl><p className="muted">The backend validates every setting. Its returned effective configuration is available after launch.</p>{error && <div role="alert" className="notice error">{error}</div>}<button className="button primary" type="submit" disabled={busy}><Play size={16} aria-hidden="true" />{busy ? 'Starting simulation…' : 'Start Simulation'}</button><p className="muted">Runs execute locally in the native C++ engine.</p></aside>
    </form>
  </>;
}

