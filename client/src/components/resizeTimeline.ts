import type { Resize, Snapshot, TelemetryEvent } from '../types/api';

export interface ResizeTimelineEvent {
  index: number;
  receivedAt: string;
  record: Resize;
  outcome: string;
  triggerSeconds?: number;
  triggerSnapshot?: Snapshot;
  nextSnapshot?: Snapshot;
}

export function resizeOutcome(record: Resize): string {
  if (record.success === true) return 'Applied';
  const flags = [record.deferred === true ? 'Deferred' : '', record.stale === true ? 'Stale' : ''].filter(Boolean);
  if (flags.length) return flags.join(' · ');
  return record.success === false && record.deferred === false && record.stale === false ? 'Rejected' : 'Unavailable';
}

/** Backend indexes order observations; sequence links a resize attempt to its preceding trigger sample. */
export function buildResizeEvents(records: TelemetryEvent[], snapshots: Snapshot[]): ResizeTimelineEvent[] {
  const unique = new Map<number, TelemetryEvent & { record: Resize }>();
  for (const event of records) {
    if (event?.record?.type === 'buffer_resize' && Number.isSafeInteger(event.index) && event.index > 0 && !unique.has(event.index)) {
      unique.set(event.index, event as TelemetryEvent & { record: Resize });
    }
  }
  const validSamples = snapshots.filter(sample => Number.isSafeInteger(sample?.sequence) && typeof sample.elapsed_ms === 'number' && Number.isFinite(sample.elapsed_ms) && sample.elapsed_ms >= 0);
  return [...unique.values()].sort((a, b) => a.index - b.index).map(event => {
    const matches = validSamples.filter(sample => sample.sequence === event.record.snapshot_sequence);
    const triggerSnapshot = matches.length === 1 ? matches[0] : undefined;
    const nextSnapshot = triggerSnapshot ? validSamples.filter(sample => sample.sequence > triggerSnapshot.sequence && sample.elapsed_ms >= triggerSnapshot.elapsed_ms).sort((a, b) => a.sequence - b.sequence)[0] : undefined;
    return { ...event, outcome: resizeOutcome(event.record), triggerSnapshot, nextSnapshot, triggerSeconds: triggerSnapshot ? triggerSnapshot.elapsed_ms / 1000 : undefined };
  });
}
