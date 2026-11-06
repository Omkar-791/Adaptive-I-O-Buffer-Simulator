import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Play } from 'lucide-react';
import { api } from '../api/client';
import { parseReusableConfiguration, reusableConfiguration } from './configReuse';
import './ConfigurationReuse.css';

export function ConfigurationReuse({ sourceId }: { sourceId: string }) {
  const navigate = useNavigate();
  const [revision, setRevision] = useState(0);
  const [text, setText] = useState(''); const [original, setOriginal] = useState('');
  const [loading, setLoading] = useState(true); const [loadError, setLoadError] = useState('');
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const pending = useRef(false); const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController();
    api.run(sourceId, controller.signal).then(run => {
      if (controller.signal.aborted) return;
      const json = JSON.stringify(reusableConfiguration(run), null, 2);
      setOriginal(json); setText(json);
    }).catch(cause => {
      if (!controller.signal.aborted) setLoadError(cause instanceof Error ? cause.message : 'The effective configuration could not be retrieved.');
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [sourceId, revision]);
  function retry() { setLoading(true); setLoadError(''); setRevision(value => value + 1); }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (pending.current) return; setError('');
    let configuration;
    try { configuration = parseReusableConfiguration(text); } catch (cause) { setError((cause as Error).message); return; }
    pending.current = true; setBusy(true);
    try {
      const created = await api.create(configuration);
      if (mounted.current) navigate(`/runs/${created.id}`);
    } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : 'Unable to start simulation.'); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  }
  return <div className="configuration-reuse">
    <div className="page-heading"><div><h1>New Simulation</h1><p>Review and edit a copy of a previous run’s effective configuration.</p></div><Link className="button" to="/simulations/new">Use default form</Link></div>
    <p className="notice">Source run: <Link className="mono" to={`/runs/${encodeURIComponent(sourceId)}?tab=configuration`}>{sourceId}</Link>. Only configuration is copied. The new run receives its own ID, lifecycle, telemetry and results.</p>
    {loading ? <div className="skeleton" role="status" aria-label="Loading effective configuration"/> : loadError ? <section className="panel"><h2>Configuration unavailable</h2><p role="alert">{loadError}</p><p>The run may have left the backend’s in-memory history. No default configuration has been substituted.</p><button type="button" onClick={retry}>Retry configuration</button></section> :
      <form className="form-layout" onSubmit={submit} noValidate>
        <section className="panel"><h2>Reuse effective configuration</h2><p id="reuse-help" className="secondary">The explicit JSON preserves heterogeneous streams, individual workload parameters, seeds and mixed phases. Edit the supported values below. Required fields remain explicit; no defaults are inserted.</p>
          <label htmlFor="reuse-configuration">Effective configuration to reuse</label>
          <textarea id="reuse-configuration" value={text} onChange={event => setText(event.target.value)} spellCheck={false} aria-describedby="reuse-help reuse-validation" aria-invalid={!!error}/>
          <p id="reuse-validation" className="secondary">Frontend bounds are checked before submission. The backend remains the final validation authority.</p>
          <details><summary>Original effective configuration · read only</summary><pre>{original}</pre></details>
        </section>
        <aside className="panel configuration-summary"><span className="eyebrow">CONFIGURATION REUSE</span><h2>Independent new run</h2><p>The previous run and its effective configuration remain unchanged.</p><p>Strategy, initial buffer allocation, stream/workload settings and metrics sampling are editable in the JSON.</p><p className="secondary">Run duration is measured after execution. A duration limit is not exposed as a reusable setting by this API.</p>{error && <p role="alert" className="notice error">{error}</p>}<button type="submit" className="button primary" disabled={busy}><Play size={16} aria-hidden="true"/>{busy ? 'Starting simulation…' : 'Start Simulation'}</button></aside>
      </form>}
  </div>;
}
