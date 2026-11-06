'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {createTermination}=require('../src/process-termination');

function fixture(signalProcess,extra={}) {
  const child=new EventEmitter();child.pid=12345;child.kill=()=>true;
  const timers=new Map();let next=0;
  const options={graceMs:20,forceWaitMs:30,tree:false,signalProcess,
    setTimer:(fn,delay)=>{const id=++next;timers.set(id,{fn,delay});return id;},
    clearTimer:id=>timers.delete(id),...extra};
  const controller=createTermination(child,options);
  const fire=delay=>{const entry=[...timers].find(([,value])=>value.delay===delay);assert.ok(entry,`timer ${delay}`);timers.delete(entry[0]);entry[1].fn();};
  return {child,controller,timers,fire};
}
test('graceful close is verified, memoized and clears every helper timer/listener',async()=>{
  const calls=[];const f=fixture((child,signal)=>{calls.push(signal);child.emit('close',null,signal);});
  const pending=f.controller.stop();assert.equal(f.controller.stop(),pending);
  const result=await pending;assert.equal(result.confirmed,true);assert.equal(result.forced,false);assert.deepEqual(calls,['SIGTERM']);
  f.controller.dispose();f.controller.dispose();assert.equal(f.timers.size,0);assert.equal(f.child.listenerCount('close'),0);
});
test('ignored or throwing graceful request escalates and verifies forced close',async()=>{
  const calls=[];const f=fixture((child,signal)=>{calls.push(signal);if(signal==='SIGTERM')throw new Error('not accepted');child.emit('close',null,signal);});
  const pending=f.controller.stop();f.fire(20);const result=await pending;
  assert.equal(result.confirmed,true);assert.equal(result.forced,true);assert.deepEqual(calls,['SIGTERM','SIGKILL']);assert.equal(result.errors.length,1);
  f.controller.dispose();assert.equal(f.timers.size,0);
});
test('successful signal return is not exit proof and final wait is bounded',async()=>{
  const signals=[];const f=fixture((child,signal)=>signals.push(signal));const pending=f.controller.stop();f.fire(20);f.fire(30);
  const result=await pending;assert.equal(result.confirmed,false);assert.equal(result.forced,true);assert.deepEqual(signals,['SIGTERM','SIGKILL']);
  f.controller.dispose();assert.equal(f.timers.size,0);assert.equal(f.child.listenerCount('close'),0);
  f.child.emit('close',null,'SIGKILL');assert.equal(result.confirmed,false,'late close cannot rewrite retained result');
});
test('already observed natural close requires no signal and disposal is safe before stop',async()=>{
  const f=fixture(()=>assert.fail('must not signal'));f.child.emit('close',0,null);
  assert.equal((await f.controller.stop()).confirmed,true);f.controller.dispose();
  const g=fixture(()=>assert.fail('must not signal'));g.controller.dispose();assert.equal((await g.controller.stop()).confirmed,false);
});
test('Unix group survivors receive force even if the direct child closes after TERM',async()=>{
  const signals=[];let groupAlive=true;
  const f=fixture((child,signal)=>{signals.push(signal);if(signal==='SIGTERM')child.emit('close',null,signal);else groupAlive=false;},{tree:true,platform:'linux',groupExists:()=>groupAlive});
  const pending=f.controller.stop();f.fire(20);f.fire(30);const result=await pending;
  assert.equal(result.confirmed,true);assert.equal(result.forced,true);assert.deepEqual(signals,['SIGTERM','SIGKILL']);f.controller.dispose();
});
test('unconfirmed process group is not called terminated even after direct child exit',async()=>{
  const f=fixture(child=>child.emit('close',0,null),{tree:true,platform:'linux',groupExists:()=>true});
  const pending=f.controller.stop();f.fire(20);f.fire(30);assert.equal((await pending).confirmed,false);f.controller.dispose();
});
test('invalid termination bounds are rejected',()=>{
  for(const value of [0,-1,Infinity,30001])assert.throws(()=>createTermination(new EventEmitter(),{graceMs:value}));
});
