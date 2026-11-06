import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Kpis } from '../components/RunView';
import { RunContent } from '../pages/RunDetails';
import Dashboard from '../pages/Dashboard';
import recorded from './fixtures/native-short.ndjson?raw';
import type { Result, Snapshot, RunSummary } from '../types/api';
const { state, runs } = vi.hoisted(() => ({ state: vi.fn(), runs: vi.fn() }));
vi.mock('../hooks/useRun', () => ({ useRun: state, activeRun: (status: string) => ['starting','running'].includes(status) }));
vi.mock('../api/client', () => ({ api: { runs } }));
vi.mock('../components/Charts', () => ({ MetricChart: () => null }));
const native = recorded.trim().split('\n').map(line => JSON.parse(line));
const result = () => structuredClone(native.at(-1)) as Result;
const sample = () => structuredClone(native[1]) as Snapshot;
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const throughput = () => screen.getByRole('region', { name: 'Throughput' });
it('withholds zero-work sentinel without changing other final KPIs or falling back to retained latency', () => {
 const final=result(); final.total_consumed=0; final.avg_latency_ms=0; final.throughput_req_per_sec=0;
 render(<Kpis result={final} snapshots={[sample()]}/>);
 expect(throughput().textContent).toContain('Mean latency — (unavailable');
 expect(throughput().textContent).toContain('0 req/s');
 expect(screen.getByRole('region',{name:'Buffer Capacity'}).textContent).toContain(String(final.total_allocated_capacity));
 expect(screen.getByRole('region',{name:'Backpressure'}).textContent).toContain(String(final.total_producer_wait_ms));
});
it.each([2.5,0])('preserves final latency %s when completed operations identify observations', latency => {
 const final=result(); final.total_consumed=3; final.avg_latency_ms=latency;
 render(<Kpis result={final} snapshots={[]}/>); expect(throughput().textContent).toContain(`Mean latency ${latency} ms`);
});
it.each([undefined,null,NaN,Infinity,-1])('withholds invalid/missing final latency %s without window fallback', latency => {
 const final=result(); final.avg_latency_ms=latency as number;
 render(<Kpis result={final} snapshots={[sample()]}/>); expect(throughput().textContent).toContain('Mean latency — (unavailable');
});
it.each([0,1.5])('uses positive window completions and preserves measured latency %s', latency => {
 const observed=sample(); observed.window_ms=100; observed.global.throughput_req_per_sec=10; observed.global.avg_latency_ms=latency;
 render(<Kpis snapshots={[observed]}/>); expect(throughput().textContent).toContain(`Mean latency ${latency} ms`);
});
it.each(['baseline','idle','missing','null'] as const)('withholds %s window latency even with cumulative consumed operations', kind => {
 const observed=sample(); observed.global.consumed=100; observed.window_ms=kind==='baseline'?0:100;
 observed.global.throughput_req_per_sec=kind==='idle'?0:10;
 if(kind==='missing') observed.global.avg_latency_ms=undefined as unknown as number;
 if(kind==='null') observed.global.avg_latency_ms=null as unknown as number;
 render(<Kpis snapshots={[observed]}/>); expect(throughput().textContent).toContain('Mean latency — (unavailable');
});
function run(strategy:'fixed'|'adaptive'): RunSummary {return {id:'phase7-run',status:'completed',createdAt:'2026-11-05T00:00:00Z',startedAt:null,endedAt:null,progress:null,error:null,cancellationMode:'terminate',cancellationRequested:false,configuration:{strategy,metrics:{interval_ms:50,window_ms:100},config:{global_buffer_budget:8,streams:[]}}};}
it.each(['fixed','adaptive'] as const)('shared Dashboard and Details preserve non-empty %s latency and suppress empty latency', async strategy => {
 const final=result(); final.avg_latency_ms=2.5;
 const summary=run(strategy); const observation={run:summary,result:final,records:[],loading:false,truncated:false,clientTruncated:false,cancelling:false,cancel:vi.fn(),retry:vi.fn()};
 state.mockReturnValue(observation); runs.mockResolvedValue({runs:[summary]});
 const dashboard=render(<MemoryRouter><Dashboard/></MemoryRouter>); await screen.findByText(/Mean latency 2.5 ms/); dashboard.unmount();
 const details=render(<MemoryRouter><RunContent id={summary.id} details/></MemoryRouter>); expect(throughput().textContent).toContain('Mean latency 2.5 ms'); details.unmount();
 final.total_consumed=0; final.avg_latency_ms=0;
 const emptyDashboard=render(<MemoryRouter><Dashboard/></MemoryRouter>); await screen.findByText(/Mean latency — \(unavailable/); emptyDashboard.unmount();
 render(<MemoryRouter initialEntries={['/runs/phase7-run?tab=result']}><RunContent id={summary.id} details/></MemoryRouter>); expect(throughput().textContent).toContain('Mean latency — (unavailable');
});
