'use strict';
const LIMITS=Object.freeze({maxStreams:16,maxRequestsPerStream:10000,maxTotalRequests:100000,maxCapacity:64,maxBudget:1024,maxPayload:1048576});
function fail(field){const e=new Error(`Invalid or unsupported configuration field: ${field}`);e.status=422;e.code='INVALID_CONFIGURATION';throw e;}
function object(x,keys,field){if(!x||typeof x!=='object'||Array.isArray(x)||Object.keys(x).some(k=>!keys.includes(k)))fail(field);return x;}
function integer(x,def,min,max,field){const v=x===undefined?def:x;if(!Number.isSafeInteger(v)||v<min||v>max)fail(field);return v;}
function number(x,def,min,max,field){const v=x===undefined?def:x;if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)fail(field);return v;}
function name(x,def,field){const v=x===undefined?def:x;if(typeof v!=='string'||!/^[A-Za-z0-9 _.-]{1,64}$/.test(v))fail(field);return v;}
const workloadKeys=['type','base_interval_ms','burst_interval_ms','burst_length','normal_length','period_length','amplitude_pct','lambda','min_payload_bytes','max_payload_bytes','seed','stream_id','phases'];
function workload(input,defaults,id){
 const w=object(input===undefined?{}:input,workloadKeys,'workload');
 const type=w.type===undefined?'STEADY':typeof w.type==='string'?w.type.toUpperCase():'';
 if(!['STEADY','BURST','PERIODIC','STOCHASTIC','MIXED'].includes(type))fail('workload.type');
 if(w.stream_id!==undefined&&w.stream_id!==id)fail('workload.stream_id');
 const out={type,base_interval_ms:integer(w.base_interval_ms,defaults.producer_interval_ms,0,1000,'workload.base_interval_ms'),burst_interval_ms:integer(w.burst_interval_ms,1,0,1000,'workload.burst_interval_ms'),burst_length:integer(w.burst_length,20,0,10000,'workload.burst_length'),normal_length:integer(w.normal_length,80,0,10000,'workload.normal_length'),period_length:integer(w.period_length,40,1,10000,'workload.period_length'),amplitude_pct:number(w.amplitude_pct,50,0,100,'workload.amplitude_pct'),lambda:number(w.lambda,0,0,1000,'workload.lambda'),min_payload_bytes:integer(w.min_payload_bytes,defaults.min_payload_bytes,0,LIMITS.maxPayload,'workload.min_payload_bytes'),max_payload_bytes:integer(w.max_payload_bytes,defaults.max_payload_bytes,0,LIMITS.maxPayload,'workload.max_payload_bytes'),seed:integer(w.seed,defaults.random_seed,0,4294967295,'workload.seed'),stream_id:id,phases:[]};
 if(out.min_payload_bytes>out.max_payload_bytes||type==='BURST'&&out.burst_length+out.normal_length===0)fail('workload bounds');
 if(w.phases!==undefined){if(!Array.isArray(w.phases)||w.phases.length>32)fail('workload.phases');const seen=new Set();out.phases=w.phases.map((p,i)=>{object(p,['name','interval_ms','request_count','min_payload_bytes','max_payload_bytes'],'phase');const v={name:name(p.name,`PHASE-${i}`,'phase.name'),interval_ms:integer(p.interval_ms,10,0,1000,'phase.interval_ms'),request_count:integer(p.request_count,50,0,10000,'phase.request_count'),min_payload_bytes:integer(p.min_payload_bytes,out.min_payload_bytes,0,LIMITS.maxPayload,'phase.min_payload_bytes'),max_payload_bytes:integer(p.max_payload_bytes,out.max_payload_bytes,0,LIMITS.maxPayload,'phase.max_payload_bytes')};if(seen.has(v.name)||v.min_payload_bytes>v.max_payload_bytes)fail('phase bounds or duplicate name');seen.add(v.name);return v;});if(out.phases.length&&out.phases.every(p=>p.request_count===0))fail('phase.request_count');}
 return out;
}
function validateRequest(body){
 object(body,['strategy','config','metrics'],'request');
 const strategy=body.strategy===undefined?'fixed':body.strategy;if(!['fixed','adaptive'].includes(strategy))fail('strategy');
 const c=body.config;if(!c||typeof c!=='object'||Array.isArray(c))fail('config');
 const heterogeneous=Object.hasOwn(c,'streams');
 if(c.num_requests!==undefined)integer(c.num_requests,1000,0,10000,'num_requests');
 const common=['num_requests','global_buffer_budget'];
 const streamKeys=['stream_id','name','buffer_capacity','num_requests','producer_interval_ms','consumer_processing_ms','min_payload_bytes','max_payload_bytes','random_seed','workload'];
 object(c,heterogeneous?[...common,'streams']:['num_streams','buffer_capacity','producer_interval_ms','consumer_processing_ms','min_payload_bytes','max_payload_bytes','random_seed','workload',...common],'config');
 let count=heterogeneous?c.streams?.length:integer(c.num_streams,1,1,16,'num_streams');
 if(!Number.isSafeInteger(count)||count<1||count>16||heterogeneous&&!Array.isArray(c.streams))fail('streams');
 const requestedBudget=c.global_buffer_budget===undefined?undefined:integer(c.global_buffer_budget,0,1,1024,'global_buffer_budget');
 const uniformBase=integer(c.workload?.seed,c.random_seed===undefined?42:c.random_seed,0,4294967295,'random_seed');
 let totalRequests=0;const ids=new Set();const streams=Array.from({length:count},(_,i)=>{
 const source=heterogeneous?object(c.streams[i],streamKeys,'stream'):c;
 const id=integer(source.stream_id,i,0,4294967295,'stream_id');if(ids.has(id))fail('duplicate stream_id');ids.add(id);
 let capacity=source.buffer_capacity;
 if(!heterogeneous&&capacity===undefined&&requestedBudget!==undefined)capacity=Math.floor(requestedBudget/count)+(i<requestedBudget%count?1:0);
 const stream={stream_id:id,name:name(source.name,`Stream-${id}`,'name'),buffer_capacity:integer(capacity,8,1,64,'buffer_capacity'),num_requests:integer(source.num_requests,c.num_requests===undefined?1000:c.num_requests,0,10000,'num_requests'),producer_interval_ms:integer(source.producer_interval_ms,5,0,1000,'producer_interval_ms'),consumer_processing_ms:integer(source.consumer_processing_ms,10,0,1000,'consumer_processing_ms'),min_payload_bytes:integer(source.min_payload_bytes,512,0,LIMITS.maxPayload,'min_payload_bytes'),max_payload_bytes:integer(source.max_payload_bytes,4096,0,LIMITS.maxPayload,'max_payload_bytes'),random_seed:integer(source.random_seed,heterogeneous?(42+i*100)>>>0:(uniformBase+i*100)>>>0,0,4294967295,'random_seed')};
 if(stream.min_payload_bytes>stream.max_payload_bytes)fail('payload bounds');
 let w=source.workload;
 if(!heterogeneous&&w!==undefined){object(w,workloadKeys,'workload');w={...w,seed:(uniformBase+i*100)>>>0};}
 stream.workload=workload(w,stream,id);stream.random_seed=stream.workload.seed;
 totalRequests+=stream.num_requests;return stream;});
 if(totalRequests>100000)fail('total requests');
 const allocated=streams.reduce((s,c)=>s+c.buffer_capacity,0),budget=requestedBudget??allocated;
 if(allocated>budget||budget>1024)fail('global_buffer_budget');
 const m=body.metrics===undefined?{}:object(body.metrics,['interval_ms','window_ms'],'metrics');
 const interval=integer(m.interval_ms,100,10,1000,'metrics.interval_ms'),window=integer(m.window_ms,1000,interval,60000,'metrics.window_ms');
 return {config:{global_buffer_budget:budget,streams},adaptive:strategy==='adaptive',metricsIntervalMs:interval,metricsWindowMs:window};
}
module.exports={validateRequest,LIMITS};
