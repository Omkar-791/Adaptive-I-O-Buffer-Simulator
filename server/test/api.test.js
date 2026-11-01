'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createApp } = require('../src/app');
const { RunManager } = require('../src/run-manager');
const { fixtureSpawner, waitTerminal, testRoot } = require('./helpers');
const request = () => ({ strategy:'fixed', config:{ num_streams:1,buffer_capacity:8,num_requests:3,
  producer_interval_ms:0,consumer_processing_ms:0,min_payload_bytes:512,max_payload_bytes:4096,random_seed:42 },
  metrics:{interval_ms:10,window_ms:20} });
async function api(t,scenario='success',options={}) {
  const root=await testRoot(),fake=fixtureSpawner(scenario);
  const manager=new RunManager({executablePath:process.execPath,cwd:path.resolve(__dirname,'../..'),tempRoot:root,
    spawn:fake.spawn,timeoutMs:1000,...options});
  const app=createApp({manager});
  const server=await new Promise(resolve=>{const value=app.listen(0,'127.0.0.1',()=>resolve(value));});
  const base='http://127.0.0.1:'+server.address().port;
  t.after(async()=>{await manager.close();await new Promise(resolve=>server.close(resolve));await fs.rm(root,{recursive:true,force:true});});
  async function call(route,method='GET',body) {
    const response=await fetch(base+route,{method,headers:body===undefined?{}:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
    const data=await response.json();return {status:response.status,data};
  }
  return {base,manager,fake,call};
}
function runBody(data){return data.run||data;}
function assertError(reply,status){assert.equal(reply.status,status);assert.equal(typeof reply.data.error.code,'string');assert.equal(typeof reply.data.error.message,'string');assert.equal(reply.data.error.stack,undefined);}

test('health, run creation/status/result and bounded recent history form a live HTTP flow',async t=>{
  const {call,manager}=await api(t);
  const health=await call('/api/v1/health');assert.equal(health.status,200);assert.equal(health.data.native.configured,true);assert.equal(health.data.native.available,true);
  assert.doesNotMatch(JSON.stringify(health.data),new RegExp(path.resolve(__dirname,'../..').replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  const created=await call('/api/v1/runs','POST',request());assert.equal(created.status,202);
  const run=runBody(created.data);assert.equal(typeof run.id,'string');assert.ok(run.createdAt);
  await waitTerminal(manager,run.id);
  const status=await call('/api/v1/runs/'+run.id);assert.equal(status.status,200);assert.equal(runBody(status.data).status,'completed');
  assert.equal(runBody(status.data).progress,null);
  const result=await call('/api/v1/runs/'+run.id+'/result');assert.equal(result.status,200);
  assert.equal((result.data.result||result.data).total_consumed,3);
  const telemetry=await call('/api/v1/runs/'+run.id+'/telemetry?after=0&limit=1');assert.equal(telemetry.status,200);assert.ok(telemetry.data.records.length<=1);
  const list=await call('/api/v1/runs?limit=1');assert.equal(list.status,200);assert.ok((list.data.runs||list.data).length<=1);
});

test('pending results and cancellation are explicit; cancelled runs do not claim a result',async t=>{
  const {call,manager}=await api(t,'pending');
  const created=runBody((await call('/api/v1/runs','POST',request())).data);
  assertError(await call('/api/v1/runs/'+created.id+'/result'),409);
  const cancel=await call('/api/v1/runs/'+created.id+'/cancel','POST',{});assert.equal(cancel.status,202);
  assert.equal((await waitTerminal(manager,created.id)).status,'cancelled');
  assertError(await call('/api/v1/runs/'+created.id+'/result'),409);
});

test('invalid complete config, arbitrary executable/path fields and strategy metacharacters never launch children',async t=>{
  const {call,fake}=await api(t);
  const bad=[];
  bad.push({...request(),executablePath:'../../cmd.exe'});
  bad.push({...request(),strategy:'fixed; echo injected'});
  for(const value of [-1,1.5,null,Number.MAX_SAFE_INTEGER]){const body=request();body.config.num_requests=value;bad.push(body);}
  const unknown=request();unknown.config.config_path='../../outside.json';bad.push(unknown);
  const budget=request();budget.config.global_buffer_budget=0;bad.push(budget);
  const streams=request();streams.config.num_streams=17;bad.push(streams);
  const payload=request();payload.config.min_payload_bytes=4096;payload.config.max_payload_bytes=512;bad.push(payload);
  const metrics=request();metrics.metrics={interval_ms:0,window_ms:100};bad.push(metrics);
  for(const body of bad)assertError(await call('/api/v1/runs','POST',body),422);
  assert.equal(fake.calls.length,0);
});

test('unknown IDs and invalid cursors return consistent safe JSON errors',async t=>{
  const {call}=await api(t);
  assertError(await call('/api/v1/runs/00000000-0000-4000-8000-000000000000'),404);
  const created=runBody((await call('/api/v1/runs','POST',request())).data);
  assertError(await call('/api/v1/runs/'+created.id+'/telemetry?after=-1'),400);
  assertError(await call('/api/v1/runs?limit=0'),400);
  const missing=await call('/not-an-endpoint');assertError(missing,404);
});

test('request-size limits and malformed JSON fail before native launch',async t=>{
  const {base,fake}=await api(t);
  const large=await fetch(base+'/api/v1/runs',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({config:{name:'x'.repeat(100000)}})});
  assert.equal(large.status,413);assert.equal(typeof(await large.json()).error.code,'string');
  const malformed=await fetch(base+'/api/v1/runs',{method:'POST',headers:{'content-type':'application/json'},body:'{"config":'});
  assert.equal(malformed.status,400);assert.equal(typeof(await malformed.json()).error.code,'string');
  const media=await fetch(base+'/api/v1/runs',{method:'POST',headers:{'content-type':'text/plain'},body:'hello'});
  assert.equal(media.status,415);
  assert.equal(fake.calls.length,0);
});

test('HTTP concurrency limit gives a clear response while another isolated run is active',async t=>{
  const {call}=await api(t,'pending',{maxConcurrent:1});
  assert.equal((await call('/api/v1/runs','POST',request())).status,202);
  const limited=await call('/api/v1/runs','POST',request());assert.ok([429,503].includes(limited.status));
  assert.equal(typeof limited.data.error.code,'string');
});


test('default browser-origin boundary refuses an unrelated website',async t=>{
  const {base}=await api(t);
  const response=await fetch(base+'/api/v1/health',{headers:{origin:'https://unrelated.invalid'}});
  assert.equal(response.status,403);assert.equal(typeof(await response.json()).error.code,'string');
});

test('health truthfully reports a missing trusted executable without leaking its path',async t=>{
  const hidden=path.resolve(__dirname,'../../build_phase10/private-missing-native.exe');
  const {call}=await api(t,'success',{executablePath:hidden});
  const health=await call('/api/v1/health');assert.equal(health.status,200);
  assert.equal(health.data.native.configured,true);assert.equal(health.data.native.available,false);
  assert.ok(!JSON.stringify(health.data).includes(hidden));
});


test('unsupported encodings and charsets return safe 415 errors',async t=>{
  const {base,fake}=await api(t);
  for(const headers of [{'content-type':'application/json; charset=iso-8859-1'},
                         {'content-type':'application/json','content-encoding':'gzip'}]) {
    const response=await fetch(base+'/api/v1/runs',{method:'POST',headers,body:'{}'});
    assert.equal(response.status,415);assert.equal(typeof(await response.json()).error.code,'string');
  }
  assert.equal(fake.calls.length,0);
});

test('non-loopback Host headers are refused before configuration or process handling',async t=>{
  const http=require('node:http');const {base,fake}=await api(t);
  const reply=await new Promise((resolve,reject)=>{
    const request=http.get(base+'/api/v1/health',{headers:{host:'untrusted.example'}},response=>{
      let text='';response.setEncoding('utf8');response.on('data',chunk=>{text+=chunk;});
      response.on('end',()=>resolve({status:response.statusCode,data:JSON.parse(text)}));
    });request.on('error',reject);
  });
  assertError(reply,403);assert.equal(fake.calls.length,0);
});
