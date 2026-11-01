'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateRequest } = require('../src/validation');
const body=()=>({strategy:'fixed',config:{num_streams:2,buffer_capacity:8,num_requests:3,producer_interval_ms:0,
  consumer_processing_ms:0,random_seed:42},metrics:{interval_ms:10,window_ms:20}});
const invalid=value=>assert.throws(()=>validateRequest(value),error=>error.status===422&&typeof error.code==='string');

test('uniform input canonicalizes into bounded per-stream config without mutating request',()=>{
  const input=body(),before=structuredClone(input),normalized=validateRequest(input);
  assert.deepEqual(input,before);assert.equal(normalized.adaptive,false);
  assert.equal(normalized.metricsIntervalMs,10);assert.equal(normalized.metricsWindowMs,20);
  assert.equal(normalized.config.streams.length,2);assert.equal(normalized.config.global_buffer_budget,16);
  for(const stream of normalized.config.streams){assert.equal(stream.buffer_capacity,8);assert.equal(stream.num_requests,3);assert.ok(stream.workload);}
});

test('heterogeneous workloads and explicit adaptive strategy retain actual supported fields',()=>{
  const input={strategy:'adaptive',config:{global_buffer_budget:16,streams:[
    {stream_id:7,name:'hot',buffer_capacity:8,num_requests:3,consumer_processing_ms:1,
      workload:{type:'BURST',base_interval_ms:0,burst_interval_ms:0,burst_length:2,normal_length:1,min_payload_bytes:64,max_payload_bytes:128,seed:11}},
    {stream_id:3,name:'idle',buffer_capacity:8,num_requests:0,consumer_processing_ms:0,
      workload:{type:'STEADY',base_interval_ms:5,min_payload_bytes:64,max_payload_bytes:128,seed:22}}]},metrics:{interval_ms:20,window_ms:100}};
  const normalized=validateRequest(input);assert.equal(normalized.adaptive,true);
  assert.deepEqual(new Set(normalized.config.streams.map(s=>s.stream_id)),new Set([7,3]));
  assert.equal(normalized.config.streams.find(s=>s.stream_id===7).workload.type,'BURST');
  assert.equal(normalized.config.streams.find(s=>s.stream_id===3).num_requests,0);
});

test('path/executable injection and unsupported fields are rejected',()=>{
  for(const field of ['executablePath','nativeExecutable','config_path','cwd','env']){const input=body();input[field]='../../cmd.exe';invalid(input);}
  for(const field of ['executable','config_path','file','args']){const input=body();input.config[field]='x;calc';invalid(input);}
  for(const strategy of ['fixed_equal','fixed;calc','../adaptive','unknown']){const input=body();input.strategy=strategy;invalid(input);}
  for(const name of ['bad"name','bad\\name','bad\nname'])invalid({config:{streams:[{stream_id:0,name,buffer_capacity:8,num_requests:1}]}});
});

test('noninteger/nonfinite/negative and resource-exhausting configurations reject before spawn',()=>{
  for(const value of [-1,1.5,NaN,Infinity,null,'3',true]){const input=body();input.config.num_requests=value;invalid(input);}
  for(const field of ['num_streams','buffer_capacity','min_payload_bytes','max_payload_bytes','consumer_processing_ms','random_seed']){
    const input=body();input.config[field]=-1;invalid(input);
  }
  const overStreams=body();overStreams.config.num_streams=17;invalid(overStreams);
  const overRequests=body();overRequests.config.num_requests=10001;invalid(overRequests);
  const total=body();total.config.num_streams=16;total.config.num_requests=10000;invalid(total);
  const capacity=body();capacity.config.buffer_capacity=65;invalid(capacity);
  const budget=body();budget.config.global_buffer_budget=1025;invalid(budget);
  const tooSmall=body();tooSmall.config.global_buffer_budget=1;invalid(tooSmall);
  const reversed=body();reversed.config.min_payload_bytes=4096;reversed.config.max_payload_bytes=512;invalid(reversed);
});

test('bad metrics, duplicate IDs and unsupported workload definitions reject',()=>{
  for(const metrics of [{interval_ms:0,window_ms:100},{interval_ms:20,window_ms:10},{interval_ms:1001,window_ms:2000},{interval_ms:10,window_ms:60001},{interval_ms:10,window_ms:20,unsupported:1}]){const input=body();input.metrics=metrics;invalid(input);}
  invalid({config:{global_buffer_budget:8,streams:[{stream_id:0,buffer_capacity:4},{stream_id:0,buffer_capacity:4}]}});
  invalid({config:{workload:{type:'UNSUPPORTED'}}});
  invalid({config:{workload:{type:'STEADY',base_interval_ms:-1}}});
  invalid({config:{workload:{type:'PERIODIC',amplitude_pct:101}}});
  invalid({config:{workload:{type:'STOCHASTIC',lambda:-1}}});
  invalid({config:{workload:{type:'MIXED',phases:[{name:'p',interval_ms:-1,request_count:1}]}}});
});


test('explicit falsy workload values are rejected rather than silently defaulted',()=>{
  for(const value of [null,false,0,'']){
    const uniform=body();uniform.config.workload=value;invalid(uniform);
    invalid({config:{streams:[{stream_id:0,buffer_capacity:8,num_requests:1,workload:value}]}});
  }
});
