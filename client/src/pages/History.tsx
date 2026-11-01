import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { api } from '../api/client';
import type { RunSummary } from '../types/api';
import ComparisonView from '../components/ComparisonView';

export default function History() {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [strategy, setStrategy] = useState('all'); const [status, setStatus] = useState('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [revision, setRevision] = useState(0);
  useEffect(() => { const controller = new AbortController(); setLoading(true); setError(''); api.runs(controller.signal).then(data => { if (!controller.signal.aborted) setRuns(data.runs); }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Unable to load run history.'); }).finally(() => { if (!controller.signal.aborted) setLoading(false); }); return () => controller.abort(); }, [revision]);
  const filtered = runs.filter(run => run.id.toLowerCase().includes(search.trim().toLowerCase()) && (strategy === 'all' || run.configuration.strategy === strategy) && (status === 'all' || run.status === status));
  return <><div className="page-heading"><div><h1>Run History</h1><p>Inspect recent simulations and their effective configurations.</p></div><button className="button secondary" disabled={loading} onClick={() => setRevision(value => value + 1)}><RefreshCw size={16} aria-hidden="true" />Refresh</button></div>
    <p className="notice">History is bounded and stored in backend memory. Runs may disappear after a backend restart or retention eviction.</p>
    <section className="panel"><div className="filters"><div className="field"><label htmlFor="run-search">Search by Run ID</label><input type="search" id="run-search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Full or partial run ID" /></div><div className="field"><label htmlFor="strategy-filter">Strategy</label><select id="strategy-filter" value={strategy} onChange={event => setStrategy(event.target.value)}><option value="all">All strategies</option><option value="fixed">Fixed</option><option value="adaptive">Adaptive</option></select></div><div className="field"><label htmlFor="status-filter">Status</label><select id="status-filter" value={status} onChange={event => setStatus(event.target.value)}><option value="all">All states</option>{['starting', 'running', 'completed', 'failed', 'cancelled', 'timed_out'].map(value => <option key={value} value={value}>{value.replace('_', ' ')}</option>)}</select></div><span className="muted">{filtered.length} retained {filtered.length === 1 ? 'run' : 'runs'}</span></div>
      {error ? <div role="alert" className="notice error">{error} <button className="button secondary" onClick={() => setRevision(value => value + 1)}>Retry</button></div> : loading ? <div aria-label="Loading run history" className="skeleton" style={{ minHeight: 180 }} /> : !filtered.length ? <div className="empty"><h2>{runs.length ? 'No runs match these filters' : 'No simulations yet'}</h2><p>{runs.length ? 'Change the Run ID search, strategy or state to see retained runs.' : 'Start a simulation to collect real performance data.'}</p>{!runs.length && <Link className="button primary" to="/simulations/new">New Simulation</Link>}</div> : <div className="table-wrap"><table><thead><tr><th>Run ID</th><th>Strategy</th><th>State</th><th>Started</th><th>Duration</th><th>Workload</th><th>Actions</th></tr></thead><tbody>{filtered.map(run => <tr key={run.id}><td><Link to={`/runs/${run.id}`} title={run.id}>{run.id.slice(0, 8)}</Link></td><td>{run.configuration.strategy}</td><td><span className={`status status-${run.status}`}>{run.status.replace('_', ' ')}</span></td><td>{run.startedAt ? new Date(run.startedAt).toLocaleString() : '—'}</td><td>{run.startedAt && run.endedAt ? `${((Date.parse(run.endedAt) - Date.parse(run.startedAt)) / 1000).toFixed(2)} s` : '—'}</td><td>{run.configuration.config.streams.length} streams · {[...new Set(run.configuration.config.streams.map(stream => stream.workload.type))].join(', ')}</td><td><Link to={`/runs/${run.id}`}>View Details</Link>{run.status === 'completed' && <> · <Link to={`/runs/${run.id}?tab=result`}>View Result</Link></>}</td></tr>)}</tbody></table></div>}
    </section>
    <ComparisonView runs={runs} refresh={() => setRevision(value => value + 1)} />
  </>;
}

