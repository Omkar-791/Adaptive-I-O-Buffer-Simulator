import type { RunSummary, Snapshot } from '../types/api';
import type { ResizeTimelineEvent } from './resizeTimeline';
import './AdaptiveTimeline.css';

const measured = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value.toLocaleString(undefined, { maximumFractionDigits: 3 }) : '—';
const slots = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? `${value.toLocaleString()} slots` : '—';
function SampleContext({ label, sample }: { label: string; sample?: Snapshot }) {
  return <div><dt>{label}</dt><dd>{sample ? `${measured(sample.elapsed_ms / 1000)} s · all streams: ${measured(sample.global?.throughput_req_per_sec)} req/s · occupancy ${measured(sample.global?.occupancy)} / ${measured(sample.global?.capacity)} slots` : 'Sample unavailable'}</dd></div>;
}

export function AdaptiveTimeline({ run, events, selectedIndex, idPrefix }: { run: RunSummary; events: ResizeTimelineEvent[]; selectedIndex?: number; idPrefix: string }) {
  return <section className="panel adaptive-timeline" aria-label="Adaptive decision timeline">
    <div className="panel-heading"><h2>Adaptive decision timeline</h2><span className="eyebrow">{events.length} retained</span></div>
    <p className="timeline-note">Ordered by backend event index. Trigger sample time precedes the resize attempt; an exact native resize timestamp is not emitted. Only emitted resize attempts are shown, not every controller evaluation.</p>
    {!events.length ? <p className="empty-state">{run.configuration.strategy === 'fixed' ? 'This run uses fixed buffer capacities. No adaptive resize events are expected.' : 'No adaptive resize events have been received.'}</p> :
      <ol className="event-list timeline-events">{events.map(event => {
        const receipt = typeof event.receivedAt === 'string' && Number.isFinite(Date.parse(event.receivedAt)) ? event.receivedAt : undefined;
        const outcomeClass = event.outcome === 'Applied' ? 'timeline-applied' : event.outcome === 'Rejected' ? 'timeline-rejected' : 'timeline-pending';
        return <li key={event.index} id={`${idPrefix}-resize-${event.index}`} tabIndex={-1} className={`timeline-event ${selectedIndex === event.index ? 'is-selected' : ''}`} aria-label={`Resize event ${event.index}: ${event.outcome}`}>
          <div className="timeline-event-heading"><strong className="mono">Event #{event.index}</strong><span className={`timeline-outcome ${outcomeClass}`}>{event.outcome}</span><span className="mono">Trigger sample: {event.triggerSeconds === undefined ? 'unavailable' : `${measured(event.triggerSeconds)} s`}</span></div>
          <p className="timeline-reason">Engine reason: {typeof event.record.reason === 'string' && event.record.reason.trim() ? event.record.reason : 'unavailable.'}</p>
          {Array.isArray(event.record.streams) && event.record.streams.length ? <ul className="timeline-streams">{event.record.streams.map((stream, index) => <li key={`${stream?.stream_id}-${index}`}><strong className="mono">Stream {measured(stream?.stream_id)}</strong><span>Previous: {slots(stream?.previous_capacity)}</span><span>Requested: {slots(stream?.requested_capacity)}</span><span>Actual: {slots(stream?.actual_capacity)}</span></li>)}</ul> : <p className="timeline-note">Affected stream capacities unavailable.</p>}
          <details open={selectedIndex === event.index}><summary>Sample context and receipt time</summary><p className="timeline-note">Context is the trigger sample and next retained sample, not proof that the resize caused a metric change. Next sample may follow other attempts.</p><dl className="timeline-context"><SampleContext label="Trigger sample · before attempt" sample={event.triggerSnapshot}/><SampleContext label="Next retained sample" sample={event.nextSnapshot}/><div><dt>Backend received · wall clock</dt><dd>{receipt ? <time dateTime={receipt}>{receipt}</time> : 'Unavailable'}</dd></div><div><dt>Trigger snapshot sequence</dt><dd className="mono">{measured(event.record.snapshot_sequence)}</dd></div></dl>{event.triggerSeconds === undefined && <p className="timeline-note">Matching native sample unavailable; this event cannot be positioned on the native-time chart.</p>}</details>
        </li>;
      })}</ol>}
  </section>;
}
