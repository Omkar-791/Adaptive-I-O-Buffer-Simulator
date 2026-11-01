import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ComparisonView from '../components/ComparisonView';
import type { RunSummary } from '../types/api';
const { create, useRun }=vi.hoisted(()=>({create:vi.fn(),useRun:vi.fn()}));
vi.mock('../api/client',()=>({api:{create}}));
vi.mock('../hooks/useRun',()=>({useRun}));
vi.mock('../components/RunView',()=>({RunStrip:({run}:{run:RunSummary})=><p>Observed {run.id}: {run.status}</p>,AllocationEvents:()=>null}));
const run=(id:string,strategy:'fixed'|'adaptive'):RunSummary=>({id,status:'running',createdAt:'2026-11-01T00:00:00Z',startedAt:null,endedAt:null,error:null,progress:null,cancellationMode:'terminate',cancellationRequested:false,configuration:{strategy,config:{global_buffer_budget:8,streams:[]},metrics:{interval_ms:20,window_ms:100}}});
const source=run('source','fixed'); const refresh=vi.fn();
beforeEach(()=>{create.mockReset();refresh.mockReset();useRun.mockImplementation((id?:string)=>({run:id?run(id,id==='adaptive'?'adaptive':'fixed'):undefined,records:[],loading:false,truncated:false,clientTruncated:false,retry:vi.fn(),cancel:vi.fn(),cancelling:false}))});afterEach(cleanup);
function view(url='/history'){return render(<MemoryRouter initialEntries={[url]}><ComparisonView runs={[source]} refresh={refresh}/></MemoryRouter>)}
it('launches identical settings with opposite strategies and displays admitted IDs',async()=>{
  create.mockResolvedValueOnce(run('fixed','fixed')).mockResolvedValueOnce(run('adaptive','adaptive'));view();fireEvent.change(screen.getByLabelText('Source configuration'),{target:{value:'source'}});fireEvent.click(screen.getByRole('button',{name:'Launch matched pair'}));
  await screen.findByText('Observed adaptive: running');expect(create.mock.calls.map(c=>c[0].strategy)).toEqual(['fixed','adaptive']);expect(create.mock.calls[0][0].config).toEqual(create.mock.calls[1][0].config);expect(refresh).toHaveBeenCalledOnce();
});
it('keeps first admitted run when second launch is rejected',async()=>{
 create.mockResolvedValueOnce(run('fixed','fixed')).mockRejectedValueOnce(new Error('Concurrent run limit reached.'));view();fireEvent.change(screen.getByLabelText('Source configuration'),{target:{value:'source'}});fireEvent.click(screen.getByText('Launch matched pair'));expect((await screen.findByRole('alert')).textContent).toContain('Fixed run fixed was admitted');expect(screen.getByText('Observed fixed: running')).toBeTruthy();expect(screen.queryByRole('table')).toBeNull();
});
it('guards duplicate submissions and does not launch second process after navigation',async()=>{
 let resolve!:(r:RunSummary)=>void;create.mockReturnValue(new Promise<RunSummary>(r=>{resolve=r}));const rendered=view();fireEvent.change(screen.getByLabelText('Source configuration'),{target:{value:'source'}});fireEvent.click(screen.getByText('Launch matched pair'));fireEvent.click(screen.getByText('Launching pair…'));expect(create).toHaveBeenCalledOnce();rendered.unmount();resolve(run('fixed','fixed'));await waitFor(()=>expect(create).toHaveBeenCalledOnce());expect(refresh).not.toHaveBeenCalled();
});
it('avoids duplicated polling for an invalid identical-ID URL',()=>{view('/history?fixed=fixed&adaptive=fixed');expect(screen.getByText('Choose two distinct runs.')).toBeTruthy();expect(useRun.mock.calls.some(c=>c[0]===undefined)).toBe(true)});
it('reports first launch rejection without inventing a run',async()=>{create.mockRejectedValue(new Error('Unavailable'));view();fireEvent.change(screen.getByLabelText('Source configuration'),{target:{value:'source'}});fireEvent.click(screen.getByText('Launch matched pair'));expect((await screen.findByRole('alert')).textContent).toBe('Unavailable');expect(create).toHaveBeenCalledOnce()});
