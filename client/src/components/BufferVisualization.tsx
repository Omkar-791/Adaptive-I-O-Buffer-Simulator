import { useId } from 'react';
import type { RunSummary, Snapshot } from '../types/api';
import { activeRun } from '../hooks/useRun';
import { statusLabel } from './RunView';
import './BufferVisualization.css';

/** Displays one retained native sample; deliberately owns no polling or run state. */
export function BufferVisualization({ run, snapshot }: { run: RunSummary; snapshot?: Snapshot }) {
  const descriptionId = useId();
  const elapsed = snapshot?.elapsed_ms;
  const sampleTime = typeof elapsed === 'number' && Number.isFinite(elapsed) && elapsed >= 0
    ? `${(elapsed / 1000).toLocaleString(undefined, { maximumFractionDigits: 2 })} s` : 'unavailable';
  return <section className="panel buffer-visualization" aria-label="Live buffer occupancy" aria-describedby={descriptionId}>
    <div className="panel-heading"><h2>Live buffer occupancy</h2><span className="eyebrow">Last native sample</span></div>
    <p id={descriptionId} className="buffer-explanation">{snapshot ? `Native elapsed: ${sampleTime}. ` : 'Waiting for native telemetry. '}
      {activeRun(run.status) ? 'Values update when a new sample is received; retained measurements may lag the running simulation.' : 'Run ended; these are retained measurements, not current worker activity.'}
      {' '}Sampled fill utilization is occupied slots / capacity; it differs from time-weighted window utilization. Worker status is unavailable.</p>
    <div className="buffer-rows">{run.configuration.config.streams.map(stream => {
      const matches = Array.isArray(snapshot?.streams) ? snapshot.streams.filter(item => item?.stream_id === stream.stream_id) : [];
      const sample = matches.length === 1 ? matches[0] : undefined;
      const occupancy = sample?.occupancy;
      const capacity = sample?.capacity;
      const validCapacity = typeof capacity === 'number' && Number.isSafeInteger(capacity) && capacity > 0;
      const validOccupancy = typeof occupancy === 'number' && Number.isSafeInteger(occupancy) && occupancy >= 0 && (!validCapacity || occupancy <= capacity);
      const valid = validCapacity && validOccupancy;
      const percent = valid ? occupancy / capacity * 100 : undefined;
      const percentText = percent === undefined ? '—' : `${percent.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;
      return <article className="buffer-row" key={stream.stream_id} aria-label={`Stream ${stream.stream_id} buffer`}>
        <div className="buffer-row-heading"><div><strong>{stream.name}</strong><span className="mono">Stream {stream.stream_id}</span></div><span>Run state: <strong>{statusLabel(run.status)}</strong></span></div>
        <dl className="buffer-values"><div><dt>Occupancy</dt><dd>{validOccupancy ? `${occupancy.toLocaleString()} slots` : '—'}</dd></div><div><dt>Capacity</dt><dd>{validCapacity ? `${capacity.toLocaleString()} slots` : '—'}</dd></div><div><dt>Sampled fill utilization</dt><dd>{percentText}</dd></div></dl>
        {valid ? <><div className={`buffer-meter${percent! >= 80 ? ' buffer-high' : ''}`} role="meter" aria-label={`Stream ${stream.stream_id} buffer occupancy`} aria-valuemin={0} aria-valuemax={capacity} aria-valuenow={occupancy} aria-valuetext={`${occupancy} of ${capacity} slots occupied, ${percentText} sampled fill utilization`}>
          {capacity <= 64 ? <div className="buffer-segments" aria-hidden="true">{Array.from({ length: capacity }, (_, index) => <span key={index} className={`buffer-slot${index < occupancy ? ' is-occupied' : ''}`} />)}</div> : <div className="buffer-proportion" aria-hidden="true"><span style={{ width: `${percent}%` }} /></div>}
        </div><p className="buffer-caption">{occupancy === 0 ? 'Empty buffer' : occupancy === capacity ? 'Full buffer' : percent! >= 80 ? 'High occupancy' : 'Occupied and available slots'} · {capacity <= 64 ? 'Each segment represents one slot.' : 'Proportional view; individual slots are not shown.'}</p></> : <p className="buffer-caption">Buffer fill unavailable: a valid occupancy and positive capacity are required from the same native sample.</p>}
      </article>;
    })}</div>
    {!run.configuration.config.streams.length && <p className="empty-state">No streams are configured for this run.</p>}
  </section>;
}
