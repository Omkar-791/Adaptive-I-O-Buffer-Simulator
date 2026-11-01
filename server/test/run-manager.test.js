'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { RunManager } = require('../src/run-manager');
const { normalized, fixtureSpawner, waitTerminal, testRoot, delay } = require('./helpers');

async function managerFixture(t, scenario='success', overrides={}) {
  const root=await testRoot(); const fake=fixtureSpawner(scenario);
  const manager=new RunManager({ executablePath: process.execPath, cwd: path.resolve(__dirname, '../..'),
    tempRoot: root, spawn: fake.spawn, timeoutMs: 1000, ...overrides });
  t.after(async () => { await manager.close(); await fs.rm(root,{recursive:true,force:true}); });
  return { root, manager, fake };
}

test('process success requires validated final output and close; argv has shell disabled and isolated temp input', async t => {
  const {manager,fake,root}=await managerFixture(t);
  const run=await manager.create(normalized());
  const final=await waitTerminal(manager,run.id);
  assert.equal(final.status,'completed'); assert.equal(final.progress,null);
  assert.equal(manager.result(run.id).total_consumed,3);
  assert.equal(fake.calls.length,1);
  const call=fake.calls[0];
  assert.equal(call.executable,process.execPath); assert.equal(call.options.shell,false);
  assert.ok(call.args.includes('--config')&&call.args.includes('--telemetry'));
  assert.ok(call.options.cwd===path.resolve(__dirname,'../..')||path.dirname(call.options.cwd)===root);
  assert.equal(call.options.env.OPENAI_API_KEY,undefined);
  assert.deepEqual(await fs.readdir(root),[]);
});

test('spawn errors and nonzero exit fail with sanitized errors, never false completion', async t => {
  for (const scenario of ['launch-error','nonzero']) {
    const {manager}=await managerFixture(t,scenario);
    const run=await manager.create(normalized()); const final=await waitTerminal(manager,run.id);
    assert.equal(final.status,'failed'); assert.ok(final.error.code);
    assert.doesNotMatch(JSON.stringify(final.error),/private|secret-token|\/not\/public/);
    assert.throws(()=>manager.result(run.id),error=>error.status===409);
  }
});

test('malformed, missing, inconsistent and duplicate completion output cannot succeed', async t => {
  for (const scenario of ['malformed','missing-final','bad-count','duplicate-final']) {
    const {manager}=await managerFixture(t,scenario);
    const run=await manager.create(normalized()); const final=await waitTerminal(manager,run.id);
    assert.equal(final.status,'failed',scenario);
  }
});

test('timeout and explicit cancellation terminate process and keep truthful final states', async t => {
  const timed=await managerFixture(t,'pending',{timeoutMs:20});
  const first=await timed.manager.create(normalized());
  assert.equal((await waitTerminal(timed.manager,first.id)).status,'timed_out');
  assert.ok(['SIGTERM','SIGKILL'].includes(timed.fake.calls[0].child.lastSignal));
  const cancelled=await managerFixture(t,'pending');
  const second=await cancelled.manager.create(normalized());
  await cancelled.manager.cancel(second.id);
  assert.equal((await waitTerminal(cancelled.manager,second.id)).status,'cancelled');
  assert.ok(['SIGTERM','SIGKILL'].includes(cancelled.fake.calls[0].child.lastSignal));
  assert.throws(()=>cancelled.manager.result(second.id),error=>error.status===409);
});

test('concurrency reservations reject overload and runs remain isolated', async t => {
  const {manager,fake}=await managerFixture(t,'pending',{maxConcurrent:2});
  const created=await Promise.allSettled([manager.create(normalized()),manager.create(normalized()),manager.create(normalized())]);
  assert.equal(created.filter(x=>x.status==='fulfilled').length,2);
  const rejected=created.find(x=>x.status==='rejected');assert.ok([429,503].includes(rejected.reason.status));
  const ids=created.filter(x=>x.status==='fulfilled').map(x=>x.value.id);assert.notEqual(ids[0],ids[1]);
  assert.notEqual(fake.calls[0].args[fake.calls[0].args.indexOf('--config')+1],fake.calls[1].args[fake.calls[1].args.indexOf('--config')+1]);
  await manager.cancel(ids[0]);assert.equal((await waitTerminal(manager,ids[0])).status,'cancelled');
  assert.ok(['starting','running'].includes(manager.get(ids[1]).status));
});

test('telemetry retention is bounded, cursors expose truncation and final result remains separate', async t => {
  const {manager}=await managerFixture(t,'retention',{telemetryLimit:2,maxTelemetryBytes:65536});
  const run=await manager.create(normalized());assert.equal((await waitTerminal(manager,run.id)).status,'completed');
  const view=manager.telemetry(run.id,{after:0,limit:2});
  assert.ok(view.records.length<=2);assert.equal(view.truncated,true);
  assert.ok(view.records.every(item=>Number.isInteger(item.index)&&typeof item.receivedAt==='string'&&item.record.type));
  assert.equal(manager.result(run.id).type,'simulation_completed');
});

test('stdout floods are failed and stderr is bounded without leaking into public state', async t => {
  const flooded=await managerFixture(t,'output-flood',{maxOutputBytes:2048,maxLineBytes:1024});
  const run=await flooded.manager.create(normalized());assert.equal((await waitTerminal(flooded.manager,run.id)).status,'failed');
  const stderr=await managerFixture(t,'stderr-flood',{maxStderrBytes:16});
  const successful=await stderr.manager.create(normalized());assert.equal((await waitTerminal(stderr.manager,successful.id)).status,'completed');
  assert.ok(JSON.stringify(stderr.manager.get(successful.id)).length<4096);
});

test('manager shutdown terminates active children and history stays bounded', async t => {
  const {manager}=await managerFixture(t,'success',{maxHistory:2});
  for(let i=0;i<4;i++){const run=await manager.create(normalized());await waitTerminal(manager,run.id);}
  const listed=manager.list(2); const runs=Array.isArray(listed)?listed:listed.runs;
  assert.ok(runs.length<=2);
  const pending=await managerFixture(t,'pending');const active=await pending.manager.create(normalized());
  await pending.manager.close();assert.equal(pending.manager.get(active.id).status,'cancelled');
});


test('byte-only telemetry eviction advances cursor without losing final metrics', async t => {
  const {manager}=await managerFixture(t,'success',{maxTelemetryBytes:1});
  const run=await manager.create(normalized());assert.equal((await waitTerminal(manager,run.id)).status,'completed');
  const page=manager.telemetry(run.id,{after:0,limit:1});
  assert.deepEqual(page.records,[]);assert.ok(page.nextCursor>0);assert.equal(page.truncated,true);
  assert.equal(manager.result(run.id).total_consumed,3);
});

test('cancellation escalates to kill if the child ignores initial termination', async t => {
  const {manager,fake}=await managerFixture(t,'pending',{killGraceMs:20});
  const run=await manager.create(normalized());const signals=[];
  fake.calls[0].child.kill=signal=>{signals.push(signal);if(signal==='SIGKILL')setImmediate(()=>fake.calls[0].finish(null,signal));return true;};
  manager.cancel(run.id);assert.equal((await waitTerminal(manager,run.id)).status,'cancelled');
  assert.ok(signals.includes('SIGTERM'));assert.ok(signals.includes('SIGKILL'));
});

test('unconfirmed native termination reports shutdown failure rather than claiming completion', async t => {
  const {manager,fake}=await managerFixture(t,'pending',{shutdownTimeoutMs:20,killGraceMs:5});
  const run=await manager.create(normalized());fake.calls[0].child.kill=()=>false;
  await assert.rejects(manager.close(),error=>error.code==='SHUTDOWN_INCOMPLETE');
  assert.ok(['starting','running'].includes(manager.get(run.id).status));
  assert.equal((await manager.health()).activeRuns,1);
  fake.calls[0].finish(null,'SIGKILL');assert.equal((await waitTerminal(manager,run.id)).status,'cancelled');
});


test('final native configuration echoes must match the submitted effective settings', async t => {
  for(const field of ['random_seed','name','producer_interval_ms','consumer_processing_ms','workload_type']) {
    const {manager}=await managerFixture(t,'wrong-'+field);
    const run=await manager.create(normalized());
    assert.equal((await waitTerminal(manager,run.id)).status,'failed',field);
  }
});

test('public effective configuration remains available and immutable after completion', async t => {
  const {manager}=await managerFixture(t);
  const input=normalized(),run=await manager.create(input);
  await waitTerminal(manager,run.id);
  const first=manager.get(run.id);
  assert.equal(first.configuration.strategy,'fixed');
  assert.equal(first.configuration.config.streams[0].num_requests,3);
  first.configuration.config.streams[0].num_requests=999;
  first.configuration.metrics.interval_ms=999;
  input.config.streams[0].random_seed=999;
  const again=manager.get(run.id);
  assert.equal(again.configuration.config.streams[0].num_requests,3);
  assert.equal(again.configuration.config.streams[0].random_seed,42);
  assert.equal(again.configuration.metrics.interval_ms,10);
});
