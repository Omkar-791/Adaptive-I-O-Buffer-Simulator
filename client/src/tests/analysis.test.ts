import { describe, expect, it } from 'vitest';
import recorded from './fixtures/native-short.ndjson?raw';
import { analysisCsv, analysisDataset, comparisonProblem, comparisonRows, type AnalysisMember } from '../components/analysis';
import type { Result, RunSummary } from '../types/api';

// Actual previously recorded native output, not a production data source.
const result: Result = JSON.parse(recorded.trim().split('\n').at(-1)!);
const configuration: RunSummary['configuration'] = { strategy:'fixed', metrics:{interval_ms:10,window_ms:20},config:{global_buffer_budget:8,streams:[{stream_id:0,name:'Stream-0',buffer_capacity:8,num_requests:3,producer_interval_ms:0,consumer_processing_ms:0,min_payload_bytes:512,max_payload_bytes:4096,random_seed:42,workload:{type:'STEADY'}}]} };
export function member(strategy:'fixed'|'adaptive'): AnalysisMember {
  return {run:{id:strategy,status:'completed',createdAt:'2026-11-01T00:00:00Z',startedAt:null,endedAt:null,progress:null,error:null,cancellationRequested:false,cancellationMode:'terminate',configuration:{...structuredClone(configuration),strategy}},result:structuredClone(result),records:[],truncated:false,clientTruncated:false};
}
describe('native comparison and exports', () => {
  it('retains requested IDs for evicted and missing comparison members', () => {
    const a = { ...member('adaptive'), requestedId:'evicted-adaptive-id', run:undefined, result:undefined, error:'Run not found.' };
    const data = analysisDataset(member('fixed'),a);
    expect(data.fixed.requestedId).toBe('fixed');expect(data.adaptive.requestedId).toBe('evicted-adaptive-id');expect(data.adaptive.run).toBeNull();expect(analysisCsv(data)).toContain('evicted-adaptive-id');
  });
  it('maps recorded whole-run measurements exactly without invented values', () => {
    const f=member('fixed'), a=member('adaptive');
    expect(comparisonProblem(f,a)).toBeNull();
    const rows=comparisonRows(f,a); expect(rows.map(r=>r.fixed)).toEqual([4927.7267,0.0345,0]);
    expect(rows.every(r=>r.delta===0)).toBe(true); expect(rows[2].percent).toBeNull();
  });
  it('preserves positive and negative tradeoffs and percentage signs', () => {
    const f=member('fixed'),a=member('adaptive'); a.result!.avg_latency_ms*=2;a.result!.throughput_req_per_sec/=2;
    expect(comparisonRows(f,a)[0].percent).toBe(-50);expect(comparisonRows(f,a)[1].percent).toBe(100);
  });
  it.each(['global_buffer_budget','metrics','seed','capacity','workload','requests'])('rejects different %s', field => {
    const f=member('fixed'),a=member('adaptive'),s=a.run!.configuration.config.streams[0];
    if(field==='global_buffer_budget')a.run!.configuration.config.global_buffer_budget++;
    if(field==='metrics')a.run!.configuration.metrics.interval_ms++;
    if(field==='seed')s.random_seed++;if(field==='capacity')s.buffer_capacity++;if(field==='workload')s.workload.type='BURST';if(field==='requests')s.num_requests++;
    expect(comparisonRows(f,a)).toEqual([]);expect(comparisonProblem(f,a)).toContain('Inputs differ');
  });
  it('ignores object key and stream order but requires matching per-stream bytes', () => {
    const f=member('fixed'),a=member('adaptive');
    for(const m of [f,a])m.run!.configuration.config.streams.push({...m.run!.configuration.config.streams[0],stream_id:1});
    a.run!.configuration.config.streams.reverse();a.run!.configuration.metrics={window_ms:20,interval_ms:10};
    expect(comparisonProblem(f,a)).toBeNull();a.result!.streams[0].total_bytes--;
    expect(comparisonProblem(f,a)).toContain('payload bytes differ');
  });
  it.each(['failed','cancelled','timed_out','running','starting'] as const)('exports %s as unavailable with null result and failure context', status => {
    const f=member('fixed'),a=member('adaptive');a.run!.status=status;a.result=undefined;a.error='No result';a.truncated=true;a.clientTruncated=true;
    const data=analysisDataset(f,a);expect(data.metrics).toEqual([]);expect(data.adaptive.result).toBeNull();expect(data.adaptive.backendTruncated).toBe(true);expect(data.adaptive.browserTruncated).toBe(true);expect(data.adaptive.observationError).toBe('No result');expect(analysisCsv(data)).toContain('"unavailable","NA"');
  });
  it('rejects wrong strategy, missing members, unsuccessful and nonfinite measurements', () => {
    const f=member('fixed'),a=member('adaptive');expect(comparisonProblem(f,{...a,run:undefined})).toContain('Select');a.run!.configuration.strategy='fixed';expect(comparisonRows(f,a)).toEqual([]);a.run!.configuration.strategy='adaptive';a.result!.success=false;expect(comparisonRows(f,a)).toEqual([]);a.result!.success=true;a.result!.avg_latency_ms=NaN;expect(comparisonRows(f,a)).toEqual([]);
  });
  it('preserves full retained native events, configurations and quoted multiline context', () => {
    const f=member('fixed'),a=member('adaptive'); a.error='A "quoted",\nerror';
    a.records=[{index:1,receivedAt:'2026-11-01T00:00:00Z',record:result}];
    const data=analysisDataset(f,a),csv=analysisCsv(data);
    expect(JSON.parse(JSON.stringify(data)).adaptive.records[0].record.total_bytes).toBe(9141);
    expect(csv).toContain('context_json');expect(csv).toContain('"throughput_req_per_sec","req/s","4927.7267"');expect(csv).toContain('""random_seed"":42');expect(csv).toContain('"NA"');
  });
});
