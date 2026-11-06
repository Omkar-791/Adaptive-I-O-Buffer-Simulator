import { useId, useState } from 'react';
import type { AnalysisMember } from './analysis';
import { comparisonCsv, comparisonExportDataset, downloadExport, runCsv, runExportDataset, safeExportName, type RunCsvDataset } from './runExports';
import './ExportActions.css';

export function RunExportActions({ member }: { member: AnalysisMember }) {
  const id = useId(); const [dataset,setDataset] = useState<RunCsvDataset>('summary'); const [busy,setBusy] = useState(false);const [error,setError] = useState('');
  async function save(format: 'json'|'csv') {
    if (busy) return;setBusy(true);setError('');
    try { await new Promise(resolve=>setTimeout(resolve,0)); const text = format === 'json' ? JSON.stringify(runExportDataset(member),null,2) : runCsv(member,dataset);downloadExport(text,safeExportName(member.requestedId || member.run?.id,format === 'json' ? 'run' : dataset,format),format); }
    catch { setError('Export could not be created. Retained data remains available; retry the download.'); } finally {setBusy(false);}
  }
  return <div className="run-export-actions"><div className="export-toolbar"><button type="button" disabled={busy || !member.run} onClick={()=>void save('json')}>Export run JSON</button><label htmlFor={id}>Run CSV dataset <select id={id} value={dataset} onChange={event=>setDataset(event.target.value as RunCsvDataset)}><option value="summary">Summary metrics</option><option value="streams">Stream measurements</option><option value="resizes">Resize events</option></select></label><button type="button" disabled={busy || !member.run} onClick={()=>void save('csv')}>Export run CSV</button></div>{busy && <p role="status">Preparing export…</p>}{error && <p role="alert" className="notice error">{error}</p>}<p className="export-note">Exports contain retained observations. Missing values are NA in CSV or null in JSON; final results remain separate. The original submitted request is unavailable through this API.</p></div>;
}
export function ComparisonExportActions({ members }: { members: AnalysisMember[] }) {
  const [busy,setBusy] = useState(false);const [error,setError] = useState('');
  async function save(format: 'json'|'csv') {
    if(busy)return;setBusy(true);setError('');
    try {await new Promise(resolve=>setTimeout(resolve,0));downloadExport(format === 'json' ? JSON.stringify(comparisonExportDataset(members),null,2) : comparisonCsv(members),safeExportName('selected-runs','comparison',format),format);}
    catch {setError('Comparison export could not be created. Retry after the selected observations load.');}finally{setBusy(false);}
  }
  return <div className="run-export-actions"><div className="export-toolbar"><button type="button" disabled={busy || members.length<2} onClick={()=>void save('json')}>Export comparison JSON</button><button type="button" disabled={busy || members.length<2} onClick={()=>void save('csv')}>Export comparison CSV</button></div>{busy&&<p role="status">Preparing comparison export…</p>}{error&&<p role="alert" className="notice error">{error}</p>}</div>;
}
