'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const fsp=require('node:fs/promises');const path=require('node:path');
const {createApp}=require('../src/app');const {RunManager}=require('../src/run-manager');
const {testRoot,waitTerminal}=require('./helpers');
const candidate=process.env.NATIVE_TEST_EXECUTABLE||process.env.NATIVE_EXECUTABLE||path.resolve(__dirname,'../../build_phase10/adaptive_io_sim.exe');
test('real running native process is terminated on cancel and yields no successful final result',
 {skip:!fs.existsSync(candidate),timeout:10000},async t=>{
 const root=await testRoot();const manager=new RunManager({executablePath:candidate,cwd:path.resolve(__dirname,'../..'),tempRoot:root,timeoutMs:5000});
 const server=await new Promise(resolve=>{const value=createApp({manager}).listen(0,'127.0.0.1',()=>resolve(value));});
 t.after(async()=>{await manager.close();await new Promise(resolve=>server.close(resolve));await fsp.rm(root,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+server.address().port;
 const created=await fetch(base+'/api/v1/runs',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({config:{num_requests:500,producer_interval_ms:0,consumer_processing_ms:1000},metrics:{interval_ms:10,window_ms:20}})});
 assert.equal(created.status,202);const run=await created.json();
 const deadline=Date.now()+3000;
 while(manager.telemetry(run.id).records.length===0&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,5));
 assert.ok(manager.telemetry(run.id).records.length>0,'native baseline was not observed');
 const cancelled=await fetch(base+'/api/v1/runs/'+run.id+'/cancel',{method:'POST'});assert.equal(cancelled.status,202);
 const terminal=await waitTerminal(manager,run.id);assert.equal(terminal.status,'cancelled');assert.equal(terminal.cancellationMode,'terminate');
 assert.equal((await fetch(base+'/api/v1/runs/'+run.id+'/result')).status,409);
 assert.equal((await manager.health()).activeRuns,0);assert.deepEqual(await fsp.readdir(root),[]);
 });
