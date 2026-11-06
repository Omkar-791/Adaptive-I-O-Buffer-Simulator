'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const {RunManager}=require('../src/run-manager');
const {NdjsonParser}=require('../src/telemetry');
const {normalized,nativeRecords,testRoot}=require('./helpers');
const {controlledSpawner}=require('./fixtures/phase3-controlled');

async function fixture(t,options={},streamCount=1) {
  const root=await testRoot(), fake=controlledSpawner();
  const manager=new RunManager({executablePath:process.execPath,tempRoot:root,spawn:fake.spawn,timeoutMs:30000,...options});
  const input=normalized();input.adaptive=true;
  if(streamCount===2){const second=structuredClone(input.config.streams[0]);second.stream_id=1;second.name='Stream-1';second.workload.stream_id=1;input.config.streams.push(second);input.config.global_buffer_budget=16;}
  const summary=await manager.create(input), child=fake.children[0], run=manager.runs.get(summary.id);
  child.start();
  t.after(async()=>{for(const process of fake.children)if(process.listenerCount('close'))process.finish(null,'SIGTERM');await Promise.all([...manager.runs.values()].map(item=>item.done));await manager.close();await fs.rm(root,{recursive:true,force:true});});
  const write=record=>child.stdout.write(JSON.stringify(record)+'\n');
  return {manager,child,run,id:summary.id,write,fake};
}
function snapshot(sequence) {
  const record=structuredClone(nativeRecords[0]);
  record.sequence=sequence;record.elapsed_ms=sequence;return record;
}
function resize(overrides={}) {
  return {type:'buffer_resize',snapshot_sequence:1,success:false,deferred:true,stale:false,
    reason:'Native fixture reason',streams:[{stream_id:0,previous_capacity:8,requested_capacity:4,actual_capacity:8}],...overrides};
}

test('sustained native snapshots respect simultaneous record and serialized byte bounds',async t=>{
  const f=await fixture(t,{telemetryLimit:7,maxTelemetryBytes:3500});
  for(let sequence=1;sequence<=500;sequence++) {
    f.write(snapshot(sequence));
    assert.ok(f.run.events.length<=7);
    assert.ok(f.run.eventBytes<=3500);
    assert.equal(f.run.eventBytes,f.run.events.reduce((sum,event)=>sum+Buffer.byteLength(JSON.stringify(event)),0));
    assert.equal(f.run.eventSizes.length,f.run.events.length);
  }
  const retained=f.manager.telemetry(f.id,{after:0});
  assert.equal(retained.truncated,true);
  assert.equal(retained.records.at(-1).index,500);
  assert.ok(retained.records.every(event=>event.record.sequence===event.index));
});

test('count eviction and paginated cursors visit every retained event exactly once',async t=>{
  const f=await fixture(t,{telemetryLimit:5});
  for(let sequence=1;sequence<=8;sequence++)f.write(snapshot(sequence));
  let after=0;const indexes=[];
  for(let pageNumber=0;pageNumber<4;pageNumber++) {
    const page=f.manager.telemetry(f.id,{after,limit:2});
    if(pageNumber===0){assert.equal(page.truncated,true);assert.equal(page.oldestCursor,4);}
    indexes.push(...page.records.map(event=>event.index));
    assert.ok(page.nextCursor>=after);after=page.nextCursor;
  }
  assert.deepEqual(indexes,[4,5,6,7,8]);
  assert.equal(f.manager.telemetry(f.id,{after}).truncated,false);
});

test('oversized retained event is evicted without pinning cursor or destroying final result',async t=>{
  const f=await fixture(t,{maxTelemetryBytes:1});
  for(const record of nativeRecords)f.write(record);
  f.child.finish();await f.run.done;
  const page=f.manager.telemetry(f.id,{after:0});
  assert.deepEqual(page.records,[]);assert.equal(page.nextCursor,3);assert.equal(page.oldestCursor,4);assert.equal(page.truncated,true);
  assert.equal(f.manager.result(f.id).total_consumed,3);
  const copy=f.manager.result(f.id);copy.streams[0].total_consumed=999;
  assert.equal(f.manager.result(f.id).streams[0].total_consumed,3);
});

test('future cursors reject safely while issued and stale cursors remain usable',async t=>{
  const f=await fixture(t,{telemetryLimit:1});
  assert.throws(()=>f.manager.telemetry(f.id,{after:1}),error=>error.status===400&&error.code==='INVALID_CURSOR');
  for(let sequence=1;sequence<=3;sequence++)f.write(snapshot(sequence));
  for(const after of [4,1000,Number.MAX_SAFE_INTEGER,NaN,Infinity,-1,0.5])
    assert.throws(()=>f.manager.telemetry(f.id,{after}),error=>error.status===400&&error.code==='INVALID_CURSOR');
  const stale=f.manager.telemetry(f.id,{after:1});
  assert.equal(stale.truncated,true);assert.deepEqual(stale.records.map(event=>event.index),[3]);
  assert.equal(f.manager.telemetry(f.id,{after:3}).nextCursor,3);
});

test('simultaneous run telemetry pages and returned copies cannot contaminate one another',async t=>{
  const a=await fixture(t), second=await a.manager.create(normalized()), child=a.fake.children[1];
  child.start();a.write(snapshot(1));child.stdout.write(JSON.stringify(snapshot(1))+'\n');child.stdout.write(JSON.stringify(snapshot(2))+'\n');
  const page=a.manager.telemetry(a.id,{after:0});
  page.records[0].record.streams[0].capacity=999;page.records.push({index:999});
  assert.equal(a.manager.telemetry(a.id).records.length,1);
  assert.equal(a.manager.telemetry(a.id).records[0].record.streams[0].capacity,8);
  assert.deepEqual(a.manager.telemetry(second.id).records.map(event=>event.index),[1,2]);
});

test('empty, partial, deferred, stale and rejected attempts retain literal outcomes',async t=>{
  const f=await fixture(t,{},2), baseline=snapshot(1);
  const second=structuredClone(baseline.streams[0]);second.stream_id=1;baseline.streams.push(second);baseline.global.capacity=16;f.write(baseline);
  const attempts=[resize({streams:[]}),resize(),resize({deferred:false,stale:true}),resize({deferred:false,reason:'Rejected by native fixture'})];
  for(const attempt of attempts)f.write(attempt);
  assert.equal(f.run.requestedState,undefined);
  assert.deepEqual(f.manager.telemetry(f.id).records.slice(1).map(event=>event.record),attempts);
  assert.equal(f.run.capacities.get(0),8);
});

for(const [label,streams] of [
  ['unknown stream',[{stream_id:999,previous_capacity:8,requested_capacity:4,actual_capacity:8}]],
  ['previous capacity drift',[{stream_id:0,previous_capacity:9,requested_capacity:4,actual_capacity:8}]],
  ['unapplied actual capacity drift',[{stream_id:0,previous_capacity:8,requested_capacity:4,actual_capacity:4}]],
])test(`unsuccessful resize rejects ${label} without retaining contradictory data`,async t=>{
  const f=await fixture(t);f.write(snapshot(1));f.write(resize({streams}));
  assert.equal(f.run.requestedState,'failed');
  assert.equal(f.run.failure.code,'NATIVE_PROTOCOL_ERROR');
  f.child.finish(null,'SIGTERM');await f.run.done;
  assert.equal(f.manager.get(f.id).status,'failed');
  assert.equal(f.manager.telemetry(f.id).records.length,1);
  assert.throws(()=>f.manager.result(f.id),error=>error.status===409);
});

test('duplicate snapshot/completion and regressing native sequence never produce successful results',async t=>{
  for(const records of [[snapshot(1),snapshot(1)],[snapshot(1),snapshot(3),snapshot(2)],[...nativeRecords,nativeRecords.at(-1)]]) {
    const f=await fixture(t);for(const record of records)f.write(record);
    f.child.finish();await f.run.done;
    assert.equal(f.manager.get(f.id).status,'failed');
    assert.throws(()=>f.manager.result(f.id),error=>error.status===409);
  }
});

test('record line limits count UTF-8 bytes and reject malformed trailing or incomplete encodings',()=>{
  const record=resize({reason:'µ'.repeat(40),streams:[]});const line=JSON.stringify(record);
  const limited=new NdjsonParser({maxLineBytes:line.length+1});
  assert.throws(()=>limited.write(Buffer.from(line+'\n')));
  for(const bytes of [Buffer.from('{"type":'),Buffer.from([0xc3])]) {
    const parser=new NdjsonParser();parser.write(bytes);assert.throws(()=>parser.end());
  }
  const received=[];const parser=new NdjsonParser({onRecord:value=>received.push(value)});
  const bytes=Buffer.from(line+'\n');for(let offset=0;offset<bytes.length;offset++)parser.write(bytes.subarray(offset,offset+1));
  parser.end();assert.deepEqual(received,[record]);
});
