import type { AnalysisMember } from './analysis';
import { buildRunComparison } from './runComparison';
import type { Result, Snapshot } from '../types/api';

const limitation = 'Retained observations only; telemetry can be truncated by the backend or browser. Final results are separate. Exports are descriptive, not controlled benchmarks.';
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null;
const cursor = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
const resultKeys = ['type','stream_count','workload_type','global_buffer_budget','total_allocated_capacity','free_buffer_budget','min_buffer_capacity','total_produced','total_consumed','total_bytes','simulation_time_sec','throughput_req_per_sec','throughput_mb_per_sec','avg_latency_ms','min_latency_ms','max_latency_ms','total_producer_wait_ms','avg_producer_wait_ms','avg_occupancy_slots','avg_occupancy_pct','max_occupancy_slots','max_occupancy_pct','success'];
const streamResultKeys = ['stream_id','name','buffer_capacity','target_requests','producer_interval_ms','consumer_processing_ms','random_seed','workload_type','total_produced','total_consumed','total_bytes','throughput_req_per_sec','throughput_mb_per_sec','avg_latency_ms','min_latency_ms','max_latency_ms','total_producer_wait_ms','avg_producer_wait_ms','avg_occupancy_slots','avg_occupancy_pct','max_occupancy_slots','max_occupancy_pct','success'];
function pick<T extends object>(value: T, keys: string[]): Partial<T> { const source = value as Record<string, unknown>; return Object.fromEntries(keys.filter(key => Object.hasOwn(source,key)).map(key => [key,source[key]])) as Partial<T>; }
const observationKeys = ['stream_id','produced','consumed','bytes','occupancy','capacity','full_events','empty_events','throughput_req_per_sec','throughput_mb_per_sec','avg_latency_ms','avg_occupancy_slots','utilization_pct','producer_wait_ms','consumer_wait_ms','p50_latency_upper_ms','p95_latency_upper_ms'];
function publicConfiguration(run: NonNullable<AnalysisMember['run']>) {
  return {strategy:run.configuration.strategy,metrics:pick(run.configuration.metrics,['interval_ms','window_ms']),config:{global_buffer_budget:run.configuration.config.global_buffer_budget,streams:run.configuration.config.streams.map(stream=>({ ...pick(stream,['stream_id','name','buffer_capacity','num_requests','producer_interval_ms','consumer_processing_ms','min_payload_bytes','max_payload_bytes','random_seed']),workload:{...pick(stream.workload,['type','base_interval_ms','burst_interval_ms','burst_length','normal_length','period_length','amplitude_pct','lambda','min_payload_bytes','max_payload_bytes','seed','stream_id']),...(Array.isArray(stream.workload.phases)?{phases:stream.workload.phases.map(phase=>pick(phase as object,['name','interval_ms','request_count','min_payload_bytes','max_payload_bytes']))}:{})}}))}};
}
function publicRecords(member: AnalysisMember) {
  return member.records.map(event=>{
    const record=event.record;
    const publicRecord=record.type==='metrics_snapshot'?{...pick(record,['type','sequence','elapsed_ms','window_ms','final_sample']),global:pick(record.global,observationKeys),streams:record.streams.map(stream=>pick(stream,observationKeys))}:record.type==='buffer_resize'?{...pick(record,['type','snapshot_sequence','success','deferred','stale','reason']),streams:record.streams.map(stream=>pick(stream,['stream_id','previous_capacity','requested_capacity','actual_capacity']))}:{...pick(record,resultKeys),streams:record.streams.map(stream=>pick(stream,streamResultKeys))};
    return {index:event.index,receivedAt:event.receivedAt,record:publicRecord};
  });
}
function finalResult(member: AnalysisMember): Result | undefined { return member.run?.status === 'completed' && member.result?.success === true ? member.result : undefined; }
function lastSample(member: AnalysisMember): Snapshot | undefined { return member.records.flatMap(event => event.record.type === 'metrics_snapshot' ? [event.record] : []).at(-1); }
function observation(member: AnalysisMember): AnalysisMember { return member.requestedId && member.run && member.requestedId !== member.run.id ? {...member,run:undefined,result:undefined,records:[],error:'Requested run observations are unavailable; mismatched cached observations were withheld.'} : member; }

export function runExportDataset(member: AnalysisMember) {
  member = observation(member);
  const run = member.run;
  const result = finalResult(member);
  const publicRun = run ? { id:run.id,status:run.status,createdAt:run.createdAt,startedAt:run.startedAt,endedAt:run.endedAt,progress:run.progress,error:run.error ? pick(run.error,['code','message']) : null,cancellationMode:run.cancellationMode,cancellationRequested:run.cancellationRequested } : null;
  return copy({ schemaVersion:1, exportedAt:new Date().toISOString(), source:'Adaptive I/O Lab public REST API', limitations:limitation,
    runId:member.requestedId || run?.id || null, metadata:publicRun,
    requestedConfiguration:null, requestedConfigurationAvailability:'Unavailable: the API does not retain the original submitted request.',
    effectiveConfiguration:run ? publicConfiguration(run) : null,
    finalResult:result ? { ...pick(result,resultKeys),streams:result.streams.map(stream => pick(stream,streamResultKeys)) } : null,
    finalResultAvailability:result ? 'Available: successful whole-run final result.' : 'Unavailable: a successful final result has not been retrieved for this run.',
    telemetry:{records:publicRecords(member),retainedCount:member.records.length,nextCursor:cursor(member.nextCursor),oldestCursor:cursor(member.oldestCursor),backendTruncated:member.truncated,browserTruncated:member.clientTruncated,coverage:'Retained observed subset; complete history is not guaranteed.'},
    metricAvailability:buildRunComparison([member]).metrics.map(metric=>({key:metric.key,unit:metric.unit,scope:metric.values[0]?.scope ?? metric.scope,availability:metric.values[0]?.availability ?? 'unavailable',source:metric.values[0]?.source ?? 'No observations available'})),
    observationError:member.error ?? null });
}

export function csvDocument(header: string[], rows: unknown[][]) {
  const quote = (value: unknown) => {
    if (typeof value === 'number' && !Number.isFinite(value)) value = null;
    let text = value === null || value === undefined ? 'NA' : String(value);
    if (typeof value !== 'number' && (/^[\t\r\n]/.test(text) || /^\s*[=+@-]/.test(text))) text = `'${text}`;
    return `"${text.replaceAll('"','""')}"`;
  };
  return [header,...rows].map(row => row.map(quote).join(',')).join('\r\n')+'\r\n';
}
export type RunCsvDataset = 'summary' | 'streams' | 'resizes';
export function runCsv(member: AnalysisMember, dataset: RunCsvDataset) {
  member = observation(member);
  const id = member.requestedId || member.run?.id || null;
  const contextHeader=['run_status','execution_strategy','telemetry_coverage','backend_truncated','browser_truncated','next_cursor','oldest_cursor','observation_error','dataset_availability'];
  const context=(available:boolean)=>[member.run?.status,member.run?.configuration.strategy,'Retained observed subset; complete history is not guaranteed',member.truncated,member.clientTruncated,cursor(member.nextCursor),cursor(member.oldestCursor),member.error,available?'Available retained data':'Unavailable: no observations for this dataset'];
  if (dataset === 'summary') {
    const model = buildRunComparison([member]);
    return csvDocument(['run_id','status','strategy','metric','unit','scope','value','availability','source',...contextHeader], model.metrics.map(metric => {
      const value = metric.values[0];
      return [id,member.run?.status,member.run?.configuration.strategy,metric.key,metric.unit,value?.scope ?? metric.scope,value?.value,value?.availability,value?.source,...context(value?.value!==null&&value?.value!==undefined)];
    }));
  }
  if (dataset === 'streams') {
    const result = finalResult(member), sample = lastSample(member);
    const rows: unknown[][] = [];
    for (const stream of result?.streams ?? []) rows.push([id,stream.stream_id,stream.name,'whole-run final',null,null,stream.buffer_capacity,null,stream.total_consumed,stream.throughput_req_per_sec,stream.total_consumed>0?stream.avg_latency_ms:null,stream.avg_occupancy_slots,stream.avg_occupancy_pct,null,null,null,stream.total_producer_wait_ms,'Unavailable: final result has no percentiles']);
    for (const stream of sample?.streams ?? []) { const hasWindow=!!sample&&sample.window_ms>0;const quantile=(value:number)=>hasWindow&&Number.isFinite(value)&&value>0?value:null;rows.push([id,stream.stream_id,member.run?.configuration.config.streams.find(item => item.stream_id === stream.stream_id)?.name,'last retained sample: instantaneous slots, cumulative consumed, window rates',sample?.elapsed_ms,sample?.window_ms,stream.capacity,stream.occupancy,stream.consumed,hasWindow?stream.throughput_req_per_sec:null,hasWindow&&stream.throughput_req_per_sec>0?stream.avg_latency_ms:null,hasWindow?stream.avg_occupancy_slots:null,null,hasWindow?stream.utilization_pct:null,quantile(stream.p50_latency_upper_ms),quantile(stream.p95_latency_upper_ms),hasWindow?stream.producer_wait_ms:null,quantile(stream.p50_latency_upper_ms)!==null&&quantile(stream.p95_latency_upper_ms)!==null?'Native histogram upper bounds in retained window':'Unavailable: no latency observations or usable window']); }
    const available=rows.length>0;
    if(!available){const unavailable=Array(18).fill(null);unavailable[0]=id;unavailable[3]='Unavailable: no final or retained stream measurements';rows.push(unavailable);}
    return csvDocument(['row_kind','run_id','stream_id','stream_name','measurement_scope','sample_elapsed_ms','window_ms','actual_capacity_slots','sample_occupancy_slots','cumulative_consumed_operations','throughput_req_per_sec','avg_latency_ms','avg_occupancy_slots','whole_run_avg_occupancy_pct','window_utilization_pct','window_p50_latency_upper_ms','window_p95_latency_upper_ms','producer_wait_ms','window_percentile_availability',...contextHeader],rows.map(row=>[available?'measurement':'availability',...row,...context(available)]));
  }
  const rows: unknown[][] = [];
  for (const event of member.records) if (event.record.type === 'buffer_resize') {
    const record = event.record;
    const matches = member.records.flatMap(item => item.record.type === 'metrics_snapshot' && item.record.sequence === record.snapshot_sequence ? [item.record] : []);
    const trigger = matches.length === 1 ? finite(matches[0].elapsed_ms) : null;
    const outcome = record.success ? 'applied' : [record.deferred ? 'deferred' : '',record.stale ? 'stale' : ''].filter(Boolean).join('; ') || 'rejected';
    for (const stream of record.streams.length ? record.streams : [null]) rows.push([id,event.index,event.receivedAt,record.snapshot_sequence,trigger,'Trigger sample; exact resize time unavailable',outcome,record.success,record.deferred,record.stale,stream?.stream_id,stream?.previous_capacity,stream?.requested_capacity,stream?.actual_capacity,record.reason]);
  }
  const available=rows.length>0;
  if(!available){const unavailable=Array(15).fill(null);unavailable[0]=id;unavailable[5]='Unavailable: no retained resize observations';rows.push(unavailable);}
  return csvDocument(['row_kind','run_id','backend_event_index','backend_received_at','trigger_snapshot_sequence','trigger_sample_elapsed_ms','timing_scope','outcome','success','deferred','stale','stream_id','previous_capacity_slots','requested_capacity_slots','actual_capacity_slots','engine_reason',...contextHeader],rows.map(row=>[available?'native_resize_event':'availability',...row,...context(available)]));
}

export function comparisonExportDataset(members: AnalysisMember[]) {
  members=members.map(observation);
  const model=buildRunComparison(members);
  return {schemaVersion:1,exportedAt:new Date().toISOString(),limitations:limitation,comparison:{...model,runs:model.runs.map(run=>({...run,configuration:members.find(member=>member.run?.id===run.runId)?.run ? publicConfiguration(members.find(member=>member.run?.id===run.runId)!.run!) : null}))},selectedRuns:members.map(runExportDataset)};
}
export function comparisonCsv(members: AnalysisMember[]) {
  members=members.map(observation);
  const model = buildRunComparison(members);
  return csvDocument(['run_id','status','strategy','effective_configuration_json','metric','unit','scope','value','availability','source','comparable_scope','comparison_warnings','limitations','telemetry_coverage','backend_truncated','browser_truncated','next_cursor','oldest_cursor'],model.metrics.flatMap(metric => metric.values.map(value => {
    const member = members.find(item => (item.requestedId || item.run?.id) === value.runId);
    return [value.runId,member?.run?.status,member?.run?.configuration.strategy,member?.run ? JSON.stringify(publicConfiguration(member.run)) : null,metric.key,value.unit,value.scope,value.value,value.availability,value.source,metric.comparable,model.warnings.join('; '),model.limitations,'Retained observed subset; complete history is not guaranteed',member?.truncated,member?.clientTruncated,cursor(member?.nextCursor),cursor(member?.oldestCursor)];
  })));
}
export function safeExportName(id: string | undefined, dataset: string, format: 'json'|'csv') { return `adaptive-io-${(id || 'unavailable').replace(/[^A-Za-z0-9_-]/g,'_').slice(0,80)}-${dataset}.${format}`; }
export function downloadExport(text: string, filename: string, format: 'json'|'csv') {
  const blob = new Blob([format === 'csv' ? '\uFEFF'+text : text],{type:format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8'});
  const url = URL.createObjectURL(blob); const link = document.createElement('a');link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
