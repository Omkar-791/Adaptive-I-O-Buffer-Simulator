'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const {RunManager}=require('../src/run-manager');
const {validateRequest}=require('../src/validation');
const {normalized,testRoot,fixtureSpawner,waitTerminal}=require('./helpers');
const {controlledSpawner}=require('./fixtures/phase3-controlled');

async function controlled(t,options={}) {
  const root=await testRoot(),fake=controlledSpawner();
  const manager=new RunManager({executablePath:process.execPath,tempRoot:root,spawn:fake.spawn,timeoutMs:1000,...options});
  t.after(async()=>{
    for(const child of fake.children)if(child.listenerCount('close'))child.finish(null,'SIGKILL');
    try{await manager.close();}catch(error){if(error.code!=='SHUTDOWN_INCOMPLETE')throw error;}
    await fs.rm(root,{recursive:true,force:true});
  });
  return {manager,fake,root};
}
const turn=()=>new Promise(setImmediate);

test('simultaneous reservations stop at the exact concurrency boundary before asynchronous setup',async t=>{
  const {manager,fake}=await controlled(t,{maxConcurrent:3,maxHistory:3});
  const requests=Array.from({length:12},()=>manager.create(normalized()));
  assert.equal(manager.active,3,'Reservation is synchronous before filesystem awaits');
  const results=await Promise.allSettled(requests);
  const accepted=results.filter(result=>result.status==='fulfilled').map(result=>result.value);
  const rejected=results.filter(result=>result.status==='rejected');
  assert.equal(accepted.length,3);assert.equal(rejected.length,9);
  assert.equal(new Set(accepted.map(run=>run.id)).size,3);
  assert.ok(rejected.every(result=>result.reason.status===503&&result.reason.code==='CONCURRENCY_LIMIT'));
  assert.equal(fake.children.length,3);assert.equal(manager.runs.size,3);
  const orderedChildren=accepted.map(run=>manager.runs.get(run.id).child);
  for(const child of orderedChildren)child.start();
  orderedChildren[0].output();
  assert.equal(manager.telemetry(accepted[0].id).records.length,3);
  for(const run of accepted.slice(1))assert.equal(manager.telemetry(run.id).records.length,0);
  for(let i=0;i<orderedChildren.length;i++){
    if(i!==0)orderedChildren[i].output();
    orderedChildren[i].finish();
    const run=manager.runs.get(accepted[i].id);
    await run.done;
    assert.equal(manager.active,2-i);
    await manager._finish(run,0,null);
    assert.equal(manager.active,2-i,'Repeated cleanup cannot release twice');
  }
  assert.equal((await manager.health()).activeRuns,0);
});

test('invalid manager input does not evict completed history or consume a reservation',async t=>{
  const {manager,fake}=await controlled(t,{maxConcurrent:1,maxHistory:1});
  const accepted=await manager.create(normalized());fake.children[0].start();fake.children[0].output();fake.children[0].finish();
  await manager.runs.get(accepted.id).done;
  const history=manager.list();
  await assert.rejects(manager.create({config:{streams:[]}}),error=>error.status===400&&error.code==='INVALID_CONFIGURATION');
  assert.deepEqual(manager.list(),history);assert.equal(manager.active,0);assert.equal(fake.children.length,1);
  assert.equal(manager.result(accepted.id).success,true);
});

test('admission overload cannot evict an accepted run and shutdown retains error priority',async t=>{
  const {manager,fake}=await controlled(t,{maxConcurrent:1,maxHistory:1});
  const accepted=await manager.create(normalized());fake.children[0].start();
  await assert.rejects(manager.create({config:{streams:[]}}),error=>error.code==='CONCURRENCY_LIMIT');
  assert.equal(manager.list()[0].id,accepted.id);assert.equal(manager.active,1);
  const closing=manager.close();
  await assert.rejects(manager.create(normalized()),error=>error.code==='SERVER_STOPPING');
  assert.equal(manager.active,1,'Reservation persists until termination is verified');
  fake.children[0].finish(null,'SIGTERM');await closing;
  assert.equal(manager.active,0);assert.equal(manager.get(accepted.id).status,'cancelled');
});

for(const scenario of ['success','nonzero','launch-error']) {
  test(`${scenario} releases its reservation exactly once`,async t=>{
    const root=await testRoot(),fake=fixtureSpawner(scenario);
    const manager=new RunManager({executablePath:process.execPath,tempRoot:root,spawn:fake.spawn,timeoutMs:1000,maxConcurrent:1});
    t.after(async()=>{await manager.close();await fs.rm(root,{recursive:true,force:true});});
    const created=await manager.create(normalized());const final=await waitTerminal(manager,created.id);
    assert.equal(final.status,scenario==='success'?'completed':'failed');
    assert.equal(manager.active,0);assert.equal((await manager.health()).activeRuns,0);
    const internal=manager.runs.get(created.id);
    await manager._finish(internal,0,null);await manager._finish(internal,null,'SIGTERM');
    assert.equal(manager.active,0);assert.equal(manager.list().length,1);
  });
}

test('synchronous spawn failure after reservation releases accounting without corrupting history',async t=>{
  const root=await testRoot();let calls=0;
  const manager=new RunManager({executablePath:process.execPath,tempRoot:root,spawn:()=>{calls++;throw new Error('private spawn detail');}});
  t.after(async()=>{await manager.close();await fs.rm(root,{recursive:true,force:true});});
  const run=await manager.create(normalized());
  assert.equal(run.status,'failed');assert.equal(calls,1);assert.equal(manager.active,0);
  assert.deepEqual(await fs.readdir(root),[]);assert.doesNotMatch(JSON.stringify(run),/private spawn detail/);
});

for(const operation of ['cancel','timeout','shutdown']) {
  test(`${operation} releases once only after confirmed termination`,async t=>{
    t.mock.timers.enable({apis:['setTimeout']});
    const {manager,fake}=await controlled(t,{timeoutMs:100});
    const created=await manager.create(normalized());const internal=manager.runs.get(created.id);fake.children[0].start();
    let closing;
    if(operation==='cancel'){manager.cancel(created.id);manager.cancel(created.id);}
    else if(operation==='timeout')t.mock.timers.tick(100);
    else closing=manager.close();
    assert.equal(manager.active,1);assert.equal((await manager.health()).activeRuns,1);
    assert.deepEqual(fake.children[0].signals,['SIGTERM']);
    fake.children[0].finish(null,'SIGTERM');await internal.done;if(closing)await closing;
    assert.equal(manager.active,0);assert.equal((await manager.health()).activeRuns,0);
    assert.equal(manager.get(created.id).status,operation==='timeout'?'timed_out':'cancelled');
    await manager._finish(internal,0,null);assert.equal(manager.active,0);
    t.mock.timers.tick(10000);assert.deepEqual(fake.children[0].signals,['SIGTERM']);
  });
}

test('unconfirmed termination is conservatively visible once without reopening admission',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const {manager,fake}=await controlled(t,{killGraceMs:10,forceWaitMs:20});
  const created=await manager.create(normalized());const internal=manager.runs.get(created.id);fake.children[0].start();
  manager.cancel(created.id);assert.equal((await manager.health()).activeRuns,1);
  t.mock.timers.tick(10);await turn();t.mock.timers.tick(20);await internal.done;
  assert.equal(manager.active,0,'Managed lifecycle reservation has been finalized');
  assert.equal(manager.get(created.id).status,'failed');
  assert.equal(manager.get(created.id).error.code,'NATIVE_TERMINATION_UNCONFIRMED');
  assert.equal((await manager.health()).activeRuns,1,'Unconfirmed resources must not be represented as zero');
  assert.equal((await manager.health()).status,'stopping');
  internal.cleanupFailed=true;
  assert.equal((await manager.health()).activeRuns,1,'Multiple uncertainty flags cannot double count one run');
  await assert.rejects(manager.create(normalized()),error=>error.code==='SERVER_STOPPING');
  await assert.rejects(manager.close(),error=>error.code==='SHUTDOWN_INCOMPLETE');
});

test('invalid and excessive public configurations reject before native creation or reservation',async t=>{
  const {manager,fake}=await controlled(t);
  const bad=[
    {num_streams:17},{num_requests:10001},{buffer_capacity:65},{global_buffer_budget:1025},
    {num_streams:16,num_requests:10000},{num_requests:-1},{num_requests:1.5},
    {num_requests:NaN},{num_requests:Infinity},{buffer_capacity:8,global_buffer_budget:1},
    {streams:[{stream_id:1},{stream_id:1}]},{unsupported:1},{workload:{type:'UNKNOWN'}},
  ];
  for(const config of bad){
    await assert.rejects(async()=>manager.create(validateRequest({config})),error=>error.status===422&&error.code==='INVALID_CONFIGURATION');
    assert.equal(manager.active,0);assert.equal(manager.runs.size,0);assert.equal(fake.children.length,0);
  }
});

test('failed artifact removal remains visible and blocks admission and misleading shutdown success',async t=>{
  const {manager,fake}=await controlled(t,{maxConcurrent:1,maxHistory:1});
  const created=await manager.create(normalized());
  const internal=manager.runs.get(created.id),directory=internal.directory;
  const remove=fs.rm;
  t.mock.method(fs,'rm',async(target,...options)=>{
    if(target===directory)throw new Error('private removal failure');
    return remove(target,...options);
  });
  fake.children[0].start();fake.children[0].output();fake.children[0].finish();
  await internal.done;
  assert.equal(manager.get(created.id).status,'failed');
  assert.equal(manager.get(created.id).error.code,'ARTIFACT_CLEANUP_FAILED');
  assert.equal((await fs.stat(directory)).isDirectory(),true,'A real owned artifact remains after failed removal');
  assert.equal(manager.active,0,'Managed lifecycle reservation is finalized exactly once');
  assert.equal((await manager.health()).activeRuns,1,'Unresolved artifact resources remain conservatively visible');
  assert.equal((await manager.health()).status,'stopping');
  await assert.rejects(manager.create(normalized()),error=>error.status===503&&error.code==='SERVER_STOPPING');
  assert.equal(manager.list()[0].id,created.id,'Failed admission must not evict the uncertain-resource evidence');
  assert.equal(fake.children.length,1);
  await manager._finish(internal,0,null);await manager._finish(internal,0,null);
  assert.equal(manager.active,0);assert.equal((await manager.health()).activeRuns,1);
  await assert.rejects(manager.close(),error=>error.status===503&&error.code==='SHUTDOWN_INCOMPLETE');
  assert.doesNotMatch(JSON.stringify(manager.get(created.id)),/private removal failure/);
});
