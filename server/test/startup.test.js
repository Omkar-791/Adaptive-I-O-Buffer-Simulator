'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {once}=require('node:events');
const {readConfig}=require('../src/config');
const {start}=require('../src/index');

test('trusted environment configuration rejects unsafe host and numeric server limits',()=>{
  for(const environment of [{HOST:'0.0.0.0'},{PORT:'-1'},{PORT:'65536'},{RUN_TIMEOUT_MS:'NaN'},
                            {MAX_CONCURRENT_RUNS:'0'},{MAX_RUN_HISTORY:'9999'},{TELEMETRY_RETENTION:'0'}])
    assert.throws(()=>readConfig(environment));
  const config=readConfig({HOST:'127.0.0.1',PORT:'0',NATIVE_EXECUTABLE:process.execPath});
  assert.equal(config.port,0);assert.equal(config.host,'127.0.0.1');assert.equal(config.manager.executablePath,path.resolve(process.execPath));
});

test('actual backend startup exposes health on an ephemeral loopback port and stops cleanly',async t=>{
  const names=['PORT','HOST','NATIVE_EXECUTABLE','BROWSER_ORIGIN'];const old=Object.fromEntries(names.map(key=>[key,process.env[key]]));
  const signals={SIGINT:new Set(process.listeners('SIGINT')),SIGTERM:new Set(process.listeners('SIGTERM'))};
  process.env.PORT='0';process.env.HOST='127.0.0.1';process.env.NATIVE_EXECUTABLE=process.execPath;delete process.env.BROWSER_ORIGIN;
  let backend;
  t.after(async()=>{
    if(backend)await backend.stop();
    for(const [key,value]of Object.entries(old)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
    for(const signal of ['SIGINT','SIGTERM'])for(const listener of process.listeners(signal))if(!signals[signal].has(listener))process.removeListener(signal,listener);
  });
  backend=await start();if(!backend.server.listening)await once(backend.server,'listening');
  const response=await fetch('http://127.0.0.1:'+backend.server.address().port+'/api/v1/health');
  assert.equal(response.status,200);const data=await response.json();assert.equal(data.status,'ok');assert.equal(data.native.available,true);
  const closed=once(backend.server,'close');await backend.stop();await closed;
  assert.equal(backend.server.listening,false);assert.equal((await backend.manager.health()).status,'stopping');
});
