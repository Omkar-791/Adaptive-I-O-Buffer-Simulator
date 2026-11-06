import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../api/client';
import { useRun } from '../hooks/useRun';
import type { RunSummary } from '../types/api';
import { AllocationEvents, RunStrip } from './RunView';
import { analysisDataset, analysisLimitations, comparisonProblem, comparisonRows, downloadAnalysis } from './analysis';
import GeneralComparison from './GeneralComparison';

export default function ComparisonView({ runs, refresh }: { runs: RunSummary[]; refresh: () => void }) {
  const [params, setParams] = useSearchParams();
  const general = params.get('comparison') === 'general';
  return <><div className="comparison-mode" role="group" aria-label="Comparison mode"><button type="button" aria-pressed={!general} onClick={() => setParams(previous => { const next = new URLSearchParams(previous); next.delete('comparison'); return next; })}>Matched fixed/adaptive pair</button><button type="button" aria-pressed={general} onClick={() => setParams(previous => { const next = new URLSearchParams(previous); next.set('comparison', 'general'); return next; })}>Compare any runs</button></div>{general ? <GeneralComparison runs={runs}/> : <MatchedComparison runs={runs} refresh={refresh}/>}</>;
}

function MatchedComparison({ runs, refresh }: { runs: RunSummary[]; refresh: () => void }) {
  const [params, setParams] = useSearchParams();
  const [admittedFixedId, setAdmittedFixedId] = useState('');
  const fixedId = admittedFixedId || params.get('fixed') || ''; const adaptiveId = params.get('adaptive') || '';
  const fixed = useRun(fixedId || undefined);
  // A malformed URL must not create duplicate polling for the same ID.
  const adaptive = useRun(adaptiveId && adaptiveId !== fixedId ? adaptiveId : undefined);
  const [source, setSource] = useState(''); const [launching, setLaunching] = useState(false); const [error, setError] = useState('');
  const mounted = useRef(true); const pending = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (params.get('fixed')) setAdmittedFixedId(''); }, [params]);
  const select = (key: string, id: string) => { if (key === 'fixed') setAdmittedFixedId(''); setParams(previous => { const next = new URLSearchParams(previous); if (id) next.set(key,id); else next.delete(key); return next; }); };
  async function launch() {
    const original = runs.find(run => run.id === source);
    if (!original || pending.current) return;
    pending.current = true; setLaunching(true); setError('');
    let first: RunSummary | undefined;
    try {
      const body = original.configuration;
      first = await api.create({ ...body, strategy: 'fixed' });
      if (!mounted.current) return;
      // Preserve the actual admitted run immediately, including before URL navigation commits.
      setAdmittedFixedId(first.id);
      setParams(previous => { const next = new URLSearchParams(previous); next.set('fixed',first!.id); next.delete('adaptive'); return next; });
      if (first.status === 'failed') throw new Error('Fixed process launch failed. Inspect its reported error before launching another pair.');
      const second = await api.create({ ...body, strategy: 'adaptive' });
      if (!mounted.current) return;
      setParams(previous => { const next = new URLSearchParams(previous); next.set('fixed',first!.id); next.set('adaptive',second.id); return next; });
      if (second.status === 'failed') setError('Adaptive process launch failed. Both admitted runs remain available for inspection.');
    } catch (cause) {
      if (mounted.current) setError(`${first ? `Fixed run ${first.id} was admitted and remains available. ` : ''}${cause instanceof Error ? cause.message : 'Pair launch failed.'}`);
    } finally { pending.current = false; if (mounted.current) { setLaunching(false); refresh(); } }
  }
  const problem = adaptiveId && adaptiveId === fixedId ? 'Choose two distinct runs.' : comparisonProblem(fixed, adaptive);
  const rows = problem ? [] : comparisonRows(fixed, adaptive);
  const dataset = () => analysisDataset({ ...fixed, requestedId: fixedId }, { ...adaptive, requestedId: adaptiveId });
  return <section aria-label="Experiment analysis" className="analysis-section">
    <div className="panel"><div className="panel-heading"><h2>Experiment Analysis</h2><div className="toolbar"><button disabled={!fixedId && !adaptiveId} onClick={() => downloadAnalysis(dataset(),'json')}>Export JSON</button><button disabled={!fixedId && !adaptiveId} onClick={() => downloadAnalysis(dataset(),'csv')}>Export CSV</button></div></div>
      <p className="notice">{analysisLimitations}</p>
      <div className="filters"><div className="field"><label htmlFor="analysis-source">Source configuration</label><select id="analysis-source" disabled={launching} value={source} onChange={e => setSource(e.target.value)}><option value="">Choose a retained run</option>{runs.map(run => <option key={run.id} value={run.id}>{run.id.slice(0,8)} · {run.configuration.strategy} · {run.status}</option>)}</select></div><button className="primary" disabled={!runs.some(r => r.id === source) || launching} onClick={() => void launch()}>{launching ? 'Launching pair…' : 'Launch matched pair'}</button></div>
      <p className="table-note">Copies all effective settings; only strategy differs. Two independent launches may overlap. If the second is rejected, the first continues and can be cancelled below. Refresh History to update selectable runs.</p>
      {error && <p role="alert" className="notice error">{error}</p>}
      <div className="form-grid">{(['fixed','adaptive'] as const).map(role => <div className="field" key={role}><label htmlFor={`analysis-${role}`}>{role === 'fixed' ? 'Fixed comparison run' : 'Adaptive comparison run'}</label><select id={`analysis-${role}`} disabled={launching} value={role === 'fixed' ? fixedId : adaptiveId} onChange={e => select(role,e.target.value)}><option value="">Select {role} run</option>{!runs.some(r => r.id === (role === 'fixed' ? fixedId : adaptiveId)) && (role === 'fixed' ? fixedId : adaptiveId) && <option value={role === 'fixed' ? fixedId : adaptiveId}>{role === 'fixed' ? fixedId : adaptiveId} · fetching / possibly evicted</option>}{runs.filter(r => r.configuration.strategy === role).map(r => { const observed = role === 'fixed' ? fixed.run : adaptive.run; return <option key={r.id} value={r.id}>{r.id.slice(0,8)} · {observed?.id === r.id ? observed.status : r.status}</option>; })}</select></div>)}</div>
      {problem && <p className="notice" role="status">{problem}</p>}
      {!!rows.length && <><p>Whole-run final measurements. Delta = adaptive minus fixed. Zero fixed baselines have no percentage change.</p><div className="table-wrap"><table aria-label="Comparison measurements"><thead><tr><th>Metric</th><th>Fixed</th><th>Adaptive</th><th>Delta</th><th>Change</th></tr></thead><tbody>{rows.map(row => <tr key={row.key}><th>{row.label} ({row.unit})</th><td>{row.fixed.toFixed(3)}</td><td>{row.adaptive.toFixed(3)}</td><td>{row.delta.toFixed(3)}</td><td>{row.percent === null ? 'Unavailable (zero baseline)' : `${row.percent.toFixed(2)}%`}</td></tr>)}</tbody></table></div></>}
    </div>
    {!!rows.length && <div className="analysis-charts">{rows.map(row => <section className="panel" key={row.key}><h3>{row.label} ({row.unit})</h3><p className="chart-description">{row.direction} · whole run</p><div role="img" aria-label={`${row.label}: fixed ${row.fixed} ${row.unit}; adaptive ${row.adaptive} ${row.unit}.`}><ResponsiveContainer width="100%" height={200} minWidth={0}><BarChart data={[{strategy:'Fixed',value:row.fixed},{strategy:'Adaptive',value:row.adaptive}]}><CartesianGrid vertical={false} stroke="var(--border)"/><XAxis dataKey="strategy" stroke="var(--secondary)"/><YAxis width={52} stroke="var(--secondary)" tickFormatter={v => Number(v).toLocaleString(undefined,{notation:'compact'})}/><Tooltip formatter={v => [`${v} ${row.unit}`,row.label]} contentStyle={{background:'var(--surface)',borderColor:'var(--border)',color:'var(--text)'}}/><Bar dataKey="value" isAnimationActive={false}><Cell fill="var(--info)"/><Cell fill="var(--accent)"/></Bar></BarChart></ResponsiveContainer></div></section>)}</div>}
    <div className="chart-grid">{[{role:'Fixed',state:fixed},{role:'Adaptive',state:adaptive}].map(({role,state}) => <div key={role}><h3>{role} run</h3>{state.loading && <p role="status">Loading {role.toLowerCase()} measurements…</p>}{state.error && <div role="alert" className="notice error">{state.error} <button onClick={state.retry}>Retry {role.toLowerCase()}</button></div>}{state.run && <><RunStrip run={state.run} snapshots={state.records.flatMap(e => e.record.type === 'metrics_snapshot' ? [e.record] : [])} cancel={() => void state.cancel()} cancelling={state.cancelling}/>{state.run.error && <p className="notice error">{state.run.error.code}: {state.run.error.message}</p>}{(state.truncated || state.clientTruncated) && <p className="notice">{role}: earlier telemetry is no longer retained by the {state.truncated ? 'backend' : 'browser'}; this timeline is partial.</p>}<AllocationEvents run={state.run} records={state.records} snapshots={state.records.flatMap(e => e.record.type === 'metrics_snapshot' ? [e.record] : [])}/></>}</div>)}</div>
  </section>;
}
