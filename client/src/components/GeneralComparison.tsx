import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { RunSummary } from '../types/api';
import { useRun } from '../hooks/useRun';
import type { AnalysisMember } from './analysis';
import { buildRunComparison } from './runComparison';
import { ComparisonExportActions } from './ExportActions';
import './GeneralComparison.css';

const MAX_SELECTION = 6;
const measuredText = (value: number | null) => value === null ? 'Unavailable' : value.toLocaleString(undefined, { maximumFractionDigits: 3 });

function ObservedRun({ id, onObserve }: { id: string; onObserve: (id: string, member: AnalysisMember) => void }) {
  const state = useRun(id);
  const { run, result, records, truncated, clientTruncated, error, nextCursor, oldestCursor } = state;
  useEffect(() => { onObserve(id, { requestedId: id, run, result, records, truncated, clientTruncated, error, nextCursor, oldestCursor }); }, [id, run, result, records, truncated, clientTruncated, error, nextCursor, oldestCursor, onObserve]);
  return <div className="general-observation-status">
    {state.loading && <p role="status">Loading measurements for {id}…</p>}
    {state.error && <p role="alert" className="notice error">{id}: {state.error} <button onClick={state.retry}>Retry {id.slice(0, 8)}</button></p>}
  </div>;
}

export default function GeneralComparison({ runs }: { runs: RunSummary[] }) {
  const [params] = useSearchParams();
  const selectionKey = JSON.stringify([...new Set(params.getAll('compare').filter(Boolean))].slice(0, MAX_SELECTION));
  // Observations belong to one URL selection. Navigation discards the entire
  // previous scope, including cache entries for runs removed by back/forward.
  return <SelectedComparison key={selectionKey} selectionKey={selectionKey} runs={runs}/>;
}

function SelectedComparison({ runs, selectionKey }: { runs: RunSummary[]; selectionKey: string }) {
  const [, setParams] = useSearchParams();
  const selected = useMemo<string[]>(() => JSON.parse(selectionKey), [selectionKey]);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const [observed, setObserved] = useState<Record<string, AnalysisMember>>({});
  const onObserve = useCallback((id: string, member: AnalysisMember) => {
    if (!active.current || !selected.includes(id)) return;
    setObserved(previous => ({ ...previous, [id]: member }));
  }, [selected]);
  function toggle(id: string, checked: boolean) {
    const next = checked ? [...new Set([...selected, id])].slice(0, MAX_SELECTION) : selected.filter(value => value !== id);
    setObserved(previous => Object.fromEntries(Object.entries(previous).filter(([key]) => next.includes(key))));
    setParams(previous => { const updated = new URLSearchParams(previous); updated.set('comparison', 'general'); updated.delete('compare'); next.forEach(value => updated.append('compare', value)); return updated; });
  }
  const members = selected.map(id => observed[id] || { requestedId: id, records: [], truncated: false, clientTruncated: false });
  const model = buildRunComparison(members);
  return <section className="analysis-section general-comparison" aria-label="General run comparison">
    <section className="panel"><div className="panel-heading"><h2>Compare available runs</h2><ComparisonExportActions members={members}/></div>
      <p className="notice">{model.limitations}</p>
      <fieldset className="general-run-selection"><legend>Select two to six runs</legend>
        {!runs.length && <p>No retained runs are available. Execute a simulation, then refresh History.</p>}
        {runs.map(run => <label key={run.id}><input type="checkbox" checked={selected.includes(run.id)} disabled={!selected.includes(run.id) && selected.length >= MAX_SELECTION} onChange={event => toggle(run.id, event.target.checked)}/><span><span className="mono">{run.id}</span><small>{run.configuration.strategy} · {run.status} · {run.createdAt}</small></span></label>)}
      </fieldset>
      <p className="table-note">{selected.length} selected. At most six observations are loaded together. In-memory history may be evicted; unavailable selected IDs stay identified below.</p>
      {selected.filter(id => !runs.some(run => run.id === id)).map(id => <p key={id} className="notice">Selected run {id} is no longer in the history listing. <button onClick={() => toggle(id, false)}>Remove {id.slice(0, 8)}</button></p>)}
      {selected.map(id => <ObservedRun key={id} id={id} onObserve={onObserve}/>)}
      {model.warnings.map(warning => <p key={warning} className="notice">{warning}</p>)}
    </section>
    {!!model.runs.length && <section className="panel"><h3>Selected run context</h3><div className="general-context-grid">{model.runs.map(run => <article key={run.runId}><h4><Link className="mono" to={`/runs/${run.runId}`}>{run.runId}</Link></h4><dl><dt>Strategy / state</dt><dd>{run.strategy || 'Unavailable'} / {run.status}</dd><dt>Workload types</dt><dd>{run.workloads.join(', ') || 'Unavailable'}</dd><dt>Native duration · measured</dt><dd>{measuredText(run.nativeDurationSec)}{run.nativeDurationSec !== null && ' s'}</dd><dt>Backend lifecycle duration · derived</dt><dd>{measuredText(run.wallClockDurationSec)}{run.wallClockDurationSec !== null && ' s'}</dd><dt>Telemetry</dt><dd>{run.retainedRecords} retained records{run.telemetryPartial && ' · earlier records evicted'}</dd></dl><details><summary>Effective configuration</summary>{run.configuration ? <pre>{JSON.stringify(run.configuration, null, 2)}</pre> : <p>Unavailable: the effective configuration could not be retrieved.</p>}</details></article>)}</div></section>}
    {selected.length >= 2 && <>
      <section className="panel"><h3>Available comparison measurements</h3><p className="table-note">Measured native values and derived retained-event counts are labelled separately. Percentile bounds describe only their retained sampling windows. Different scopes or units are not combined.</p><div className="table-scroll"><table aria-label="General comparison measurements"><thead><tr><th>Metric / unit</th>{model.runs.map(run => <th key={run.runId}><Link title={run.runId} to={`/runs/${run.runId}`}>{run.runId.slice(0, 8)}</Link><small>{run.strategy || 'Unavailable'}</small></th>)}</tr></thead><tbody>{model.metrics.map(metric => <tr key={metric.key}><th>{metric.label} ({metric.unit})<small>{metric.scope}{!metric.comparable && ' · unavailable or incompatible scope'}</small></th>{metric.values.map(value => <td key={value.runId}>{measuredText(value.value)}<small>{value.availability} · {value.scope}</small><small>{value.source}</small></td>)}</tr>)}</tbody></table></div></section>
      <div className="analysis-charts">{model.metrics.filter(metric => ['throughput_req_per_sec', 'avg_latency_ms'].includes(metric.key)).map(metric => <section className="panel" key={metric.key}><h3>{metric.label} ({metric.unit})</h3><p className="chart-description">Whole-run native measurements · descriptive comparison</p>{metric.comparable ? <div role="img" aria-label={`${metric.label}: ${metric.values.map(value => `${value.runId} ${value.value} ${metric.unit}`).join('; ')}`}><ResponsiveContainer width="100%" height={220} minWidth={0}><BarChart data={metric.values.map(value => ({ run: value.runId.slice(0, 8), value: value.value }))}><CartesianGrid vertical={false} stroke="var(--border)"/><XAxis dataKey="run" stroke="var(--secondary)"/><YAxis width={60} stroke="var(--secondary)"/><Tooltip position={{ x: 0, y: 0 }} wrapperStyle={{ maxWidth: '100%', whiteSpace: 'normal' }} formatter={value => [`${value} ${metric.unit}`, metric.label]} contentStyle={{ background: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--text)' }}/><Bar dataKey="value" name={metric.label} fill="var(--accent)" isAnimationActive={false}/></BarChart></ResponsiveContainer></div> : <p className="empty-state">Chart unavailable until all selected runs have compatible successful whole-run measurements. Available values remain in the table.</p>}</section>)}</div>
    </>}
  </section>;
}
