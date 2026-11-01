import {useEffect,useState} from 'react';
import {Link} from 'react-router-dom';
import {Activity,Plus} from 'lucide-react';
import {api} from '../api/client';
import type {RunSummary} from '../types/api';
import {activeRun} from '../hooks/useRun';
import {RunContent} from './RunDetails';
export default function Dashboard(){
 const [runs,setRuns]=useState<RunSummary[]>([]);const [selected,setSelected]=useState('');const [loading,setLoading]=useState(true);const [error,setError]=useState('');const [generation,setGeneration]=useState(0);
 useEffect(()=>{const abort=new AbortController();setLoading(true);setError('');api.runs(abort.signal).then(v=>{if(abort.signal.aborted)return;setRuns(v.runs);setSelected(old=>v.runs.some(r=>r.id===old)?old:(v.runs.find(r=>activeRun(r.status))??v.runs[0])?.id||'')}).catch(e=>{if(!abort.signal.aborted)setError(e.message)}).finally(()=>{if(!abort.signal.aborted)setLoading(false)});return()=>abort.abort()},[generation]);
 return <><div className="page-heading"><div><p className="eyebrow">OBSERVABILITY WORKSPACE</p><h1>Dashboard</h1><p className="muted">Monitor I/O simulation performance, buffer utilization, and adaptive behavior.</p></div><Link className="button primary" to="/simulations/new"><Plus size={16}/> New Simulation</Link></div><div className="toolbar"><label>Selected run <select aria-label="Selected run" value={selected} onChange={e=>setSelected(e.target.value)} disabled={!runs.length}>{!runs.length&&<option>No runs</option>}{runs.map(r=><option value={r.id} key={r.id}>{r.id.slice(0,8)} · {r.configuration.strategy} · {r.status}</option>)}</select></label><button onClick={()=>setGeneration(n=>n+1)}>Refresh runs</button>{selected&&<Link to={`/runs/${selected}`}>View Details ↗</Link>}</div>{error?<div className="panel empty-state" role="alert"><h2>Backend unavailable</h2><p>{error}</p><button onClick={()=>setGeneration(n=>n+1)}>Retry</button></div>:loading?<div className="skeleton" aria-label="Loading runs"/>:selected?<RunContent key={selected} id={selected}/>:<section className="panel empty-state"><Activity size={32}/><h2>No active simulation</h2><p>Launch a simulation to inspect real throughput, backpressure and allocation decisions.</p><Link className="button primary" to="/simulations/new">Start Simulation</Link></section>}</>;
}
