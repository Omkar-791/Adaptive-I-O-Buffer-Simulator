import {useEffect,useState} from 'react';
import {Link,NavLink,Route,Routes,useLocation} from 'react-router-dom';
import {Activity,LayoutDashboard,PlayCircle,History as HistoryIcon,Workflow,Menu,X} from 'lucide-react';
import {api} from '../api/client';
import type {Health} from '../types/api';
import NewRun from '../pages/NewRun';
import History from '../pages/History';
import Architecture from '../pages/Architecture';
import Dashboard from '../pages/Dashboard';
import RunDetails from '../pages/RunDetails';
export default function App(){
 const location=useLocation();const [open,setOpen]=useState(false);const [health,setHealth]=useState<Health|null>(null);const [connection,setConnection]=useState('Connecting');
 useEffect(()=>{let disposed=false;let timer:ReturnType<typeof setTimeout>;const abort=new AbortController();async function poll(){try{const h=await api.health(abort.signal);if(!disposed){setHealth(h);setConnection(h.status==='ok'?'Connected':'Disconnected')}}catch{if(!disposed){setHealth(null);setConnection('Error')}}if(!disposed)timer=setTimeout(poll,5000)}void poll();return()=>{disposed=true;abort.abort();clearTimeout(timer)}},[]);
 const online=connection==='Connected';
 const links=[['/','Dashboard',LayoutDashboard],['/simulations/new','New Simulation',PlayCircle],['/history','History',HistoryIcon],['/architecture','Architecture',Workflow]] as const;
 const title=location.pathname==='/'?'Dashboard':location.pathname.includes('/new')?'New Simulation':location.pathname==='/history'?'History':location.pathname==='/architecture'?'Architecture':'Run Details';
 return <div className="app-shell" onKeyDown={event=>{if(event.key==='Escape')setOpen(false)}}><aside className={`sidebar ${open?'is-open':''}`}><Link className="brand" to="/" onClick={()=>setOpen(false)}><Activity size={24}/><span>Adaptive I/O Lab<small>Simulation Workspace</small></span></Link><div className="nav-label">WORKSPACE</div><nav aria-label="Main navigation">{links.map(([url,label,Icon])=><NavLink end={url==='/'} to={url} key={url} onClick={()=>setOpen(false)}><Icon size={18}/>{label}</NavLink>)}</nav><div className="sidebar-footer"><span className={`connection ${online?'online':''}`}>{connection}</span><small>{health?.native.available?'Native engine ready':'Native engine unavailable'}</small></div></aside>{open&&<button className="nav-backdrop" aria-label="Close navigation" onClick={()=>setOpen(false)}/>}
 <div className="main-shell"><header className="topbar"><button className="menu-toggle" title={open?'Close navigation':'Open navigation'} aria-label={open?'Close navigation':'Open navigation'} aria-expanded={open} onClick={()=>setOpen(!open)}>{open?<X size={18}/>:<Menu size={18}/>}</button><span>Workspace <span className="muted">/</span> <strong>{title}</strong></span><span className={`connection ${online?'online':''}`} role="status">{connection}</span></header><main><Routes><Route path="/" element={<Dashboard/>}/><Route path="/simulations/new" element={<NewRun/>}/><Route path="/runs/new" element={<NewRun/>}/><Route path="/runs/:runId" element={<RunDetails/>}/><Route path="/history" element={<History/>}/><Route path="/architecture" element={<Architecture/>}/><Route path="*" element={<section className="panel empty-state"><h1>Page not found</h1><Link to="/">Open dashboard</Link></section>}/></Routes></main><footer className="workspace-footer">ADAPTIVE I/O LAB <span>Local simulation workspace · Native measurements</span></footer></div></div>;
}

