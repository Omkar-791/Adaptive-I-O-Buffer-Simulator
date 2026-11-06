import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom';
import NewRun from '../pages/NewRun';
import type { RunSummary } from '../types/api';
function reuseRun(strategy: 'fixed' | 'adaptive' = 'fixed'): RunSummary {
  return { id: 'old-run', status: 'completed', createdAt: '2026-11-04T00:00:00Z', startedAt: '2026-11-04T00:00:01Z', endedAt: '2026-11-04T00:00:02Z', progress: null, error: null, cancellationMode: 'terminate', cancellationRequested: false,
    configuration: { strategy, metrics: { interval_ms: 20, window_ms: 100 }, config: { global_buffer_budget: 32, streams: [0, 1].map(id => ({ stream_id: id, name: `Stream-${id}`, buffer_capacity: id ? 4 : 8, num_requests: 20, producer_interval_ms: id ? 5 : 0, consumer_processing_ms: id ? 20 : 5, min_payload_bytes: 64, max_payload_bytes: 128, random_seed: 42 + id,
      workload: { type: id ? 'MIXED' : 'BURST', base_interval_ms: id ? 5 : 0, burst_interval_ms: 1, burst_length: 10, normal_length: 5, period_length: 40, amplitude_pct: 32.5, lambda: 0.1, min_payload_bytes: 64, max_payload_bytes: 128, seed: 42 + id, stream_id: id, phases: id ? [{ name: 'FAST', interval_ms: 0, request_count: 10, min_payload_bytes: 64, max_payload_bytes: 128 }, { name: 'SLOW', interval_ms: 10, request_count: 10, min_payload_bytes: 64, max_payload_bytes: 128 }] : [] } })) } } };
}

const { create, run } = vi.hoisted(() => ({ create: vi.fn(), run: vi.fn() }));
vi.mock('../api/client', () => ({ api: { create, run } }));
beforeEach(() => { create.mockReset(); run.mockReset(); }); afterEach(cleanup);
function Details() { return <h1>Created {useParams().id}</h1>; }
function view() { return render(<MemoryRouter initialEntries={['/simulations/new?reuse=old-run']}><Routes><Route path="/simulations/new" element={<NewRun/>}/><Route path="/runs/:id" element={<Details/>}/></Routes></MemoryRouter>); }

it.each(['fixed', 'adaptive'] as const)('loads completed %s configuration once and creates an independent edited run', async strategy => {
  const source = reuseRun(strategy), before = structuredClone(source);
  run.mockResolvedValue(source); create.mockResolvedValue({ id: 'new-run' }); view();
  const editor = await screen.findByLabelText('Effective configuration to reuse') as HTMLTextAreaElement;
  expect(JSON.parse(editor.value)).toEqual(source.configuration);
  const edited = JSON.parse(editor.value); edited.config.streams[1].consumer_processing_ms = 12;
  fireEvent.change(editor, { target: { value: JSON.stringify(edited) } });
  fireEvent.click(screen.getByRole('button', { name: 'Start Simulation' }));
  await screen.findByRole('heading', { name: 'Created new-run' });
  expect(create).toHaveBeenCalledExactlyOnceWith(edited);
  expect(Object.keys(create.mock.calls[0][0]).sort()).toEqual(['config', 'metrics', 'strategy']);
  expect(source).toEqual(before); expect(run).toHaveBeenCalledTimes(1);
});
it('blocks invalid edits before submission and retains the JSON', async () => {
  run.mockResolvedValue(reuseRun()); view();
  const editor = await screen.findByLabelText('Effective configuration to reuse') as HTMLTextAreaElement;
  const edited = JSON.parse(editor.value); edited.config.streams[0].buffer_capacity = 65;
  const text = JSON.stringify(edited); fireEvent.change(editor, { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Start Simulation' }));
  expect(screen.getByRole('alert').textContent).toContain('buffer_capacity'); expect(create).not.toHaveBeenCalled(); expect(editor.value).toBe(text);
});
it('keeps edits after backend rejection and guards repeated submissions', async () => {
  run.mockResolvedValue(reuseRun()); let reject!: (error: Error) => void;
  create.mockReturnValue(new Promise((_resolve, failure) => { reject = failure; })); view();
  const editor = await screen.findByLabelText('Effective configuration to reuse') as HTMLTextAreaElement;
  const text = editor.value; fireEvent.click(screen.getByRole('button', { name: 'Start Simulation' }));
  fireEvent.click(screen.getByRole('button', { name: /Starting simulation/ })); expect(create).toHaveBeenCalledTimes(1);
  reject(new Error('Concurrent run limit reached.'));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Concurrent run limit'));
  expect(editor.value).toBe(text);
});
it('explains an evicted source and retries without inserting defaults', async () => {
  run.mockRejectedValueOnce(new Error('Run not found.')).mockResolvedValueOnce(reuseRun()); view();
  await screen.findByRole('heading', { name: 'Configuration unavailable' });
  expect(screen.queryByLabelText('Effective configuration to reuse')).toBeNull(); expect(create).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Retry configuration' }));
  await screen.findByLabelText('Effective configuration to reuse'); expect(run).toHaveBeenCalledTimes(2);
});
