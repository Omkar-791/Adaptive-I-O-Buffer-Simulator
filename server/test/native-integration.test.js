'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { createApp } = require('../src/app');
const { RunManager } = require('../src/run-manager');
const { testRoot, waitTerminal } = require('./helpers');
const requested=process.env.NATIVE_TEST_EXECUTABLE||process.env.NATIVE_EXECUTABLE;
const candidates=[path.resolve(__dirname,'../../build_phase10/adaptive_io_sim.exe'),path.resolve(__dirname,'../../build_phase9/adaptive_io_sim.exe')];
const executable=requested||candidates.find(value=>fs.existsSync(value));

test('real native simulator completes fixed and adaptive HTTP runs with bounded telemetry and cleanup',
  {skip:!executable,timeout:15000},async t=>{
    const root=await testRoot();
    const manager=new RunManager({executablePath:path.resolve(executable),cwd:path.resolve(__dirname,'../..'),tempRoot:root,timeoutMs:10000});
    const server=await new Promise(resolve=>{const value=createApp({manager}).listen(0,'127.0.0.1',()=>resolve(value));});
    t.after(async()=>{await manager.close();await new Promise(resolve=>server.close(resolve));await fsp.rm(root,{recursive:true,force:true});});
    const base='http://127.0.0.1:'+server.address().port;
    let expectedBytes;
    for(const strategy of ['fixed','adaptive']){
      const body={strategy,config:{global_buffer_budget:16,streams:[
        {stream_id:0,name:'hot',buffer_capacity:8,num_requests:50,consumer_processing_ms:1,
          workload:{type:'STEADY',base_interval_ms:0,min_payload_bytes:64,max_payload_bytes:128,seed:42}},
        {stream_id:1,name:'idle',buffer_capacity:8,num_requests:0,consumer_processing_ms:0,
          workload:{type:'STEADY',base_interval_ms:5,min_payload_bytes:64,max_payload_bytes:128,seed:142}}]},
        metrics:{interval_ms:20,window_ms:100}};
      const created=await fetch(base+'/api/v1/runs',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
      assert.equal(created.status,202);const response=await created.json();const run=response.run||response;
      const state=await waitTerminal(manager,run.id);assert.equal(state.status,'completed',JSON.stringify(state.error));
      const resultResponse=await fetch(base+'/api/v1/runs/'+run.id+'/result');assert.equal(resultResponse.status,200);
      const data=await resultResponse.json();const result=data.result||data;
      assert.equal(result.total_produced,50);assert.equal(result.total_consumed,50);assert.equal(result.success,true);
      assert.equal(result.global_buffer_budget,16);assert.ok(result.total_allocated_capacity<=16);
      if(expectedBytes===undefined)expectedBytes=result.total_bytes;else assert.equal(result.total_bytes,expectedBytes);
      const telemetryResponse=await fetch(base+'/api/v1/runs/'+run.id+'/telemetry');assert.equal(telemetryResponse.status,200);
      const telemetry=await telemetryResponse.json();assert.ok(telemetry.records.length<=100);
      assert.ok(telemetry.records.some(event=>event.record.type==='metrics_snapshot'));
      if(strategy==='fixed')assert.ok(result.streams.every(stream=>stream.buffer_capacity===8));
      else assert.ok(telemetry.records.some(event=>event.record.type==='buffer_resize'&&event.record.success), 'real adaptive queue resize was not observed');
    }
    const emptyResponse=await fetch(base+'/api/v1/runs',{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({config:{num_streams:1,buffer_capacity:8,num_requests:0,producer_interval_ms:0,consumer_processing_ms:0}})});
    assert.equal(emptyResponse.status,202);const emptyBody=await emptyResponse.json();
    const empty=emptyBody.run||emptyBody;
    assert.equal((await waitTerminal(manager,empty.id)).status,'completed');
    assert.equal(manager.result(empty.id).total_consumed,0);
    assert.deepEqual(await fsp.readdir(root),[]);
  });
