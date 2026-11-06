'use strict';
const fs = require('node:fs/promises');
const { constants: fsConstants } = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawn: nativeSpawn } = require('node:child_process');
const { NdjsonParser } = require('./telemetry');
const { TERMINAL, transition, publicStatus } = require('./run-lifecycle');
const { createTermination } = require('./process-termination');
class BridgeError extends Error {
  constructor(status, code, message) { super(message); this.status=status; this.code=code; }
}
const clone = value => JSON.parse(JSON.stringify(value));
const sameIds = (streams, expected) => streams.length === expected.size && streams.every(s => expected.has(s.stream_id));
const now = () => new Date().toISOString();
function limit(value, fallback, maximum, name) {
  value=value ?? fallback;
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new TypeError(`Invalid ${name}`);
  return value;
}
class RunManager {
  constructor(options={}) {
    this.executablePath=options.executablePath ? path.resolve(options.executablePath) : null;
    this.cwd=path.resolve(options.cwd || process.cwd());
    this.tempRoot=path.resolve(options.tempRoot || path.join(this.cwd,'server','.runs'));
    this.maxConcurrent=limit(options.maxConcurrent,2,32,'concurrency');
    this.maxHistory=limit(options.maxHistory,20,1000,'history');
    if (this.maxHistory < this.maxConcurrent) throw new TypeError('History must cover active concurrency');
    this.telemetryLimit=limit(options.telemetryLimit,100,10000,'telemetry retention');
    this.maxTelemetryBytes=limit(options.maxTelemetryBytes,1024*1024,64*1024*1024,'telemetry bytes');
    this.timeoutMs=limit(options.timeoutMs ?? options.maxDurationMs,30000,3600000,'timeout');
    this.killGraceMs=limit(options.killGraceMs,250,10000,'kill grace');
    this.forceWaitMs=limit(options.forceWaitMs,1000,10000,'forced termination wait');
    this.cleanupTimeoutMs=limit(options.cleanupTimeoutMs,1000,10000,'artifact cleanup timeout');
    this.realSpawn=!options.spawn;
    this.shutdownTimeoutMs=limit(options.shutdownTimeoutMs,5000,30000,'shutdown timeout');
    this.maxOutputBytes=limit(options.maxOutputBytes,16*1024*1024,256*1024*1024,'output bytes');
    this.maxStderrBytes=limit(options.maxStderrBytes,8192,1024*1024,'stderr bytes');
    this.maxLineBytes=limit(options.maxLineBytes,65536,1024*1024,'line bytes');
    this.spawn=options.spawn || nativeSpawn;
    this.runs=new Map(); this.active=0; this.closed=false;
  }
  async health() {
    let available=false;
    if(this.executablePath) try {
      const stat=await fs.stat(this.executablePath);
      if(stat.isFile()) {await fs.access(this.executablePath,fsConstants.X_OK);available=true;}
    } catch {}
    // Finished lifecycle work may still have unconfirmed OS resources. Count that
    // uncertainty once without retaining process handles or changing admission.
    const unresolved=[...this.runs.values()].filter(run=>!run.active&&(run.terminationUnconfirmed||run.cleanupFailed)).length;
    return {status:this.closed?'stopping':'ok',native:{configured:Boolean(this.executablePath),available},activeRuns:this.active+unresolved,concurrencyLimit:this.maxConcurrent};
  }
  _run(id) {
    const run=this.runs.get(id);
    if(!run) throw new BridgeError(404,'RUN_NOT_FOUND','Run not found.');
    return run;
  }
  _summary(run) {
    return {id:run.id,status:publicStatus(run.status),createdAt:run.createdAt,startedAt:run.startedAt,
      endedAt:run.endedAt,progress:null,error:run.error ? {...run.error}:null,
      cancellationMode:'terminate',cancellationRequested:Boolean(run.requestedState==='cancelled'),
      configuration:clone({strategy:run.adaptive?'adaptive':'fixed',
        config:{...run.configRoot,streams:[...run.expected.values()]},
        metrics:{interval_ms:run.metricsIntervalMs,window_ms:run.metricsWindowMs}})};
  }
  get(id) {return this._summary(this._run(id));}
  list(count=20) {
    if(!Number.isSafeInteger(count)||count<1||count>1000) throw new BridgeError(400,'INVALID_LIMIT','Invalid history limit.');
    return [...this.runs.values()].reverse().slice(0,Math.min(count,this.maxHistory)).map(run=>this._summary(run));
  }
  telemetry(id,{after=0,limit:count=this.telemetryLimit}={}) {
    const run=this._run(id);
    if(!Number.isSafeInteger(after)||after<0||after>run.eventIndex||!Number.isSafeInteger(count)||count<1||count>10000)
      throw new BridgeError(400,'INVALID_CURSOR','Invalid telemetry cursor or limit.');
    const records=run.events.filter(event=>event.index>after).slice(0,count);
    const oldestCursor=run.events[0]?.index ?? run.eventIndex+1;
    return {records:clone(records),nextCursor:records.at(-1)?.index ?? Math.max(after,oldestCursor-1),oldestCursor,
      truncated:after < oldestCursor-1};
  }
  result(id) {
    const run=this._run(id);
    if(run.status!=='completed') throw new BridgeError(409,'RESULT_UNAVAILABLE','A successful final result is not available.');
    return clone(run.result);
  }
  _retain(run,record) {
    const event={index:++run.eventIndex,receivedAt:now(),record};
    const bytes=Buffer.byteLength(JSON.stringify(event));
    run.events.push(event);run.eventSizes.push(bytes);run.eventBytes+=bytes;
    while(run.events.length>this.telemetryLimit || run.eventBytes>this.maxTelemetryBytes) {
      run.eventBytes-=run.eventSizes.shift();run.events.shift();
    }
  }
  _record(run,record) {
    if(run.completion) throw new Error('Native data after completion');
    if(record.type==='metrics_snapshot') {
      if(run.finalSnapshot || record.sequence<=run.lastSequence || record.elapsed_ms<run.lastElapsed || !sameIds(record.streams,run.expected))
        throw new Error('Invalid snapshot progression');
      if(run.lastSequence===0 && record.sequence!==1) throw new Error('Missing native baseline');
      let capacity=0;
      for(const stream of record.streams) {
        const expected=run.expected.get(stream.stream_id);
        if(stream.produced>expected.num_requests || stream.consumed>expected.num_requests ||
           stream.capacity!==run.capacities.get(stream.stream_id)) throw new Error('Unexpected native snapshot state');
        const previous=run.lastCounts.get(stream.stream_id);
        if(previous && (stream.produced<previous.produced || stream.consumed<previous.consumed || stream.bytes<previous.bytes))
          throw new Error('Nonmonotonic native counts');
        run.lastCounts.set(stream.stream_id,{produced:stream.produced,consumed:stream.consumed,bytes:stream.bytes});
        capacity+=stream.capacity;
      }
      if(capacity>run.budget) throw new Error('Native capacity budget exceeded');
      run.lastSequence=record.sequence;run.lastElapsed=record.elapsed_ms;
      if(record.final_sample) run.finalSnapshot=record;
    } else if(record.type==='buffer_resize') {
      if(!run.request.adaptive || run.finalSnapshot || !run.lastSequence || record.snapshot_sequence!==run.lastSequence)
        throw new Error('Unexpected native resize event');
      if(record.success) {
        if(!sameIds(record.streams,run.expected)) throw new Error('Resize topology mismatch');
        let total=0;
        for(const stream of record.streams) {
          const expected=run.expected.get(stream.stream_id);
          if(stream.previous_capacity!==run.capacities.get(stream.stream_id) || stream.actual_capacity<1 ||
             stream.actual_capacity>Math.max(64,expected.buffer_capacity)) throw new Error('Resize acknowledgement mismatch');
          total+=stream.actual_capacity;
        }
        if(total>run.budget) throw new Error('Resize budget exceeded');
        for(const stream of record.streams) run.capacities.set(stream.stream_id,stream.actual_capacity);
      } else {
        // Early native rejection may omit streams or report only a partial list.
        // Every capacity that is reported must still describe this run's unchanged allocation.
        for(const stream of record.streams) {
          const capacity=run.capacities.get(stream.stream_id);
          if(!run.expected.has(stream.stream_id)||stream.previous_capacity!==capacity||stream.actual_capacity!==capacity)
            throw new Error('Unapplied resize acknowledgement mismatch');
        }
      }
    } else {
      if(!run.finalSnapshot || !record.success || !sameIds(record.streams,run.expected) || record.global_buffer_budget!==run.budget)
        throw new Error('Final result does not match native execution');
      for(const stream of record.streams) {
        const expected=run.expected.get(stream.stream_id), observed=run.finalSnapshot.streams.find(s=>s.stream_id===stream.stream_id);
        const baseWorkload=expected.workload || expected;
        const workloads=[baseWorkload,...(baseWorkload.phases || [])];
        const minimum=Math.min(...workloads.map(w=>w.min_payload_bytes ?? expected.min_payload_bytes ?? 512));
        const maximum=Math.max(...workloads.map(w=>w.max_payload_bytes ?? expected.max_payload_bytes ?? 4096));
        if(stream.name!==expected.name || stream.random_seed!==expected.random_seed ||
           stream.producer_interval_ms!==expected.producer_interval_ms || stream.consumer_processing_ms!==expected.consumer_processing_ms ||
           stream.workload_type!==String(expected.workload?.type || 'STEADY').toUpperCase())
          throw new Error('Final configuration differs from submitted workload');
        if(!stream.success || stream.target_requests!==expected.num_requests || stream.total_produced!==expected.num_requests ||
           stream.total_consumed!==expected.num_requests || stream.buffer_capacity!==observed.capacity ||
           stream.total_bytes!==observed.bytes || stream.total_bytes<minimum*stream.total_consumed ||
           stream.total_bytes>maximum*stream.total_consumed) throw new Error('Stream final result inconsistent');
      }
      for(const [summary,snapshot] of [['total_produced','produced'],['total_consumed','consumed'],['total_bytes','bytes']])
        if(record[summary]!==run.finalSnapshot.global[snapshot]) throw new Error('Global final result inconsistent');
      run.completion=record;
    }
    this._retain(run,record);
  }
  async create(request) {
    if(this.closed) throw new BridgeError(503,'SERVER_STOPPING','Backend is stopping.');
    if(this.active>=this.maxConcurrent) throw new BridgeError(503,'CONCURRENCY_LIMIT','Concurrent run limit reached.');
    const normalized=clone(request);
    if(!normalized.config || !Array.isArray(normalized.config.streams) || normalized.config.streams.length===0)
      throw new BridgeError(400,'INVALID_CONFIGURATION','Validated streams are required.');
    while(this.runs.size>=this.maxHistory) {
      const victim=[...this.runs.values()].find(run=>TERMINAL.has(run.status)&&!run.active);
      if(!victim) throw new BridgeError(503,'HISTORY_LIMIT','Run capacity reached.');
      this.runs.delete(victim.id);
    }
    const expected=new Map(normalized.config.streams.map(stream=>[stream.stream_id,stream]));
    const {streams:_streams,...configRoot}=normalized.config;
    const run={id:randomUUID(),status:'queued',createdAt:now(),startedAt:null,endedAt:null,error:null,
      request:normalized,configRoot,adaptive:normalized.adaptive,metricsIntervalMs:normalized.metricsIntervalMs,metricsWindowMs:normalized.metricsWindowMs,expected,capacities:new Map([...expected].map(([id,s])=>[id,s.buffer_capacity])),
      budget:normalized.config.global_buffer_budget,events:[],eventSizes:[],eventBytes:0,eventIndex:0,
      outputBytes:0,stderr:Buffer.alloc(0),stderrTruncated:false,lastSequence:0,lastElapsed:0,lastCounts:new Map(),active:true,listeners:[]};
    run.done=new Promise(resolve=>{run.resolveDone=resolve;});
    run.setupDone=new Promise(resolve=>{run.resolveSetup=resolve;});
    this.runs.set(run.id,run);this.active++;
    run.parser=new NdjsonParser({maxLineBytes:this.maxLineBytes,onRecord:record=>this._record(run,record)});
    run.timer=setTimeout(()=>this._stop(run,'timed_out','NATIVE_TIMEOUT','Native run exceeded the configured duration.'),this.timeoutMs);
    try {
      if(!this.executablePath) throw new Error('No executable configured');
      await fs.mkdir(this.tempRoot,{recursive:true});
      if(run.finished || run.finalizing) return this._summary(run);
      run.directory=await fs.mkdtemp(path.join(this.tempRoot,'run-'));
      if(run.finished || run.finalizing) { await this._removeDirectory(run.directory); return this._summary(run); }
      if(this.closed || run.requestedState) {this._settleSetup(run);await this._finish(run,null,null);return this._summary(run);}
      const input=path.join(run.directory,'config.json');
      await fs.writeFile(input,JSON.stringify(normalized.config),{encoding:'utf8',flag:'wx',mode:0o600});
      if(run.finished || run.finalizing) { await this._removeDirectory(run.directory); return this._summary(run); }
      if(this.closed || run.requestedState) {this._settleSetup(run);await this._finish(run,null,null);return this._summary(run);}
      const args=['--config',input,'--telemetry','--metrics-interval-ms',String(normalized.metricsIntervalMs),'--metrics-window-ms',String(normalized.metricsWindowMs)];
      if(normalized.adaptive) args.push('--adaptive');
      const env={};
      for(const key of ['PATH','Path','SystemRoot','SYSTEMROOT','WINDIR','TEMP','TMP','LD_LIBRARY_PATH','DYLD_LIBRARY_PATH'])
        if(typeof process.env[key]==='string') env[key]=process.env[key];
      const child=this.spawn(this.executablePath,args,{cwd:this.cwd,env,shell:false,windowsHide:true,stdio:['ignore','pipe','pipe'],...(this.realSpawn && process.platform!=='win32' ? {detached:true} : {})});
      run.child=child;
      run.termination=createTermination(child,{graceMs:this.killGraceMs,forceWaitMs:this.forceWaitMs,tree:this.realSpawn});
      this._listen(run,child,'spawn',()=>{
        if(run.finished || run.finalizing) return;
        transition(run,'running');run.startedAt=now();
        if(run.requestedState==='cancelled')transition(run,'cancelling');
        if(run.requestedState)this._terminate(run);
      },true);
      this._listen(run,child.stdout,'data',chunk=>{
        if(run.finished||run.finalizing||run.requestedState) return;
        run.outputBytes+=Buffer.byteLength(chunk);
        if(run.outputBytes>this.maxOutputBytes) {this._stop(run,'failed','NATIVE_OUTPUT_LIMIT','Native output exceeded the configured limit.');return;}
        try {run.parser.write(chunk);} catch {this._stop(run,'failed','NATIVE_PROTOCOL_ERROR','Native output was malformed or inconsistent.');}
      });
      this._listen(run,child.stderr,'data',chunk=>{
        if(run.finished||run.finalizing)return;
        const bytes=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);
        run.outputBytes+=bytes.length;
        if(run.outputBytes>this.maxOutputBytes) {this._stop(run,'failed','NATIVE_OUTPUT_LIMIT','Native output exceeded the configured limit.');return;}
        const remaining=this.maxStderrBytes-run.stderr.length;
        if(bytes.length>remaining)run.stderrTruncated=true;
        if(remaining>0)run.stderr=Buffer.concat([run.stderr,bytes.subarray(0,remaining)]);
      });
      for(const stream of [child.stdout,child.stderr]) this._listen(run,stream,'error',()=>{
        this._stop(run,'failed','NATIVE_IO_FAILED','Native process output could not be read.');
      });
      this._listen(run,child,'error',()=>{
        if(run.finished||run.finalizing)return;
        if(!child.pid) {
          run.failure={code:'NATIVE_LAUNCH_FAILED',message:'Native process could not be started.'};
          run.requestedState='failed';void this._finish(run,null,null);
        } else this._stop(run,'failed','NATIVE_LAUNCH_FAILED','Native process could not be started or controlled.');
      });
      this._listen(run,child,'exit',(code,signal)=>{
        run.exitObserved={code,signal};clearTimeout(run.timer);run.timer=null;
        // Descendants can inherit output pipes and delay close after the direct child exits.
        // Keep the drain wait bounded, without treating an exit alone as successful completion.
        if(!run.requestedState)run.closeTimer=setTimeout(()=>this._stop(run,'failed','NATIVE_CLOSE_UNCONFIRMED','Native output streams did not close within the configured bounds.'),this.forceWaitMs);
      },true);
      this._listen(run,child,'close',(code,signal)=>{
        run.processClosed=true;run.exitObserved={code,signal};
        if(!run.requestedState)void this._finish(run,code,signal);
        // A requested stop finishes through its single termination operation.
      },true);
    } catch {
      if(!run.finished&&!run.finalizing) {
        run.failure={code:'NATIVE_LAUNCH_FAILED',message:'Native process could not be started.'};
        run.requestedState='failed';this._settleSetup(run);await this._finish(run,null,null);
      }
    } finally {
      this._settleSetup(run);
    }
    return this._summary(run);
  }
  _settleSetup(run) {
    if(run.setupSettled)return;
    run.setupSettled=true;run.resolveSetup();run.resolveSetup=null;
  }
  async _waitForSetup(run) {
    if(run.setupSettled)return;
    let deadline;
    try {
      await Promise.race([run.setupDone,new Promise((_,reject)=>{
        deadline=setTimeout(()=>reject(new Error('Native artifact setup did not settle')),this.cleanupTimeoutMs);
      })]);
    } finally {clearTimeout(deadline);}
  }
  _listen(run,emitter,event,listener,once=false) {
    if(once)emitter.once(event,listener);else emitter.on(event,listener);
    run.listeners.push(()=>emitter.removeListener(event,listener));
  }
  _terminate(run) {
    if(!run.child||run.finished||run.finalizing||run.terminationPromise)return;
    run.terminationStarted=true;
    run.terminationPromise=run.termination.stop().then(outcome=>{
      run.terminationOutcome=outcome;
      return this._finish(run,outcome.code,outcome.signal,outcome.confirmed);
    },()=>this._finish(run,null,null,false));
  }
  _stop(run,state,code,message) {
    if(run.finished||run.finalizing||(run.exitObserved&&state!=='failed')||TERMINAL.has(run.status)||run.requestedState)return;
    // The first stop request owns the outcome. Later timeout/cancel/shutdown requests share it.
    run.requestedState=state;run.failure={code,message};
    clearTimeout(run.timer);run.timer=null;
    if(state==='cancelled'&&run.status==='running')transition(run,'cancelling');
    if(run.child)this._terminate(run);
    else void this._finish(run,null,null);
  }
  cancel(id) {
    const run=this._run(id);
    if(TERMINAL.has(run.status)||run.finalizing||run.exitObserved) throw new BridgeError(409,'RUN_TERMINAL','Run is terminal or finishing.');
    this._stop(run,'cancelled','RUN_CANCELLED','Run terminated by request; shutdown is not graceful.');
    return this._summary(run);
  }
  async _removeDirectory(directory) {
    const resolved=path.resolve(directory), root=path.resolve(this.tempRoot);
    if(path.dirname(resolved)!==root||!path.basename(resolved).startsWith('run-'))throw new Error('Unsafe cleanup path');
    let deadline;
    try {
      await Promise.race([fs.rm(resolved,{recursive:true,force:true,maxRetries:3,retryDelay:50}),new Promise((_,reject)=>{
        deadline=setTimeout(()=>reject(new Error('Artifact cleanup deadline exceeded')),this.cleanupTimeoutMs);
      })]);
    } finally {clearTimeout(deadline);}
  }
  async _finish(run,code,signal,confirmed=true) {
    if(run.finished||run.finalizing)return run.done;
    run.finalizing=true;
    clearTimeout(run.timer);run.timer=null;
    clearTimeout(run.closeTimer);run.closeTimer=null;
    run.termination?.dispose();run.termination=null;
    let status=run.requestedState || 'completed';
    if(!confirmed) {
      status='failed';run.terminationUnconfirmed=true;this.unconfirmedTermination=true;this.closed=true;
      run.failure={code:'NATIVE_TERMINATION_UNCONFIRMED',message:'Native termination could not be confirmed within its configured bounds. The backend will admit no further runs.'};
    } else if(!run.requestedState) {
      try {
        run.parser.end();
        if(code!==0||signal||run.failure||!run.completion||!run.finalSnapshot) throw new Error('Native execution did not complete');
      } catch {
        status='failed';
        run.failure=run.failure || {code:code!==0?'NATIVE_EXIT_FAILED':'NATIVE_PROTOCOL_ERROR',message:'Native process did not produce a valid successful result.'};
      }
    }
    try {await this._waitForSetup(run);} catch {
      status='failed';run.cleanupFailed=true;this.closed=true;
      run.failure={code:'ARTIFACT_SETUP_UNCONFIRMED',message:'Native artifact setup could not be confirmed within the configured bounds. The backend will admit no further runs.'};
    }
    if(run.status==='queued' && status==='timed_out') status='failed';
    // A queued child may close without its spawn event; success is never inferred in that case.
    if(run.status==='queued' && status==='completed') {
      status='failed';run.failure={code:'NATIVE_EXIT_FAILED',message:'Native process exited before startup was established.'};
    }
    if(run.directory) {
      try {await this._removeDirectory(run.directory);} catch {
        status='failed';run.cleanupFailed=true;this.closed=true;
        if(confirmed)run.failure={code:'ARTIFACT_CLEANUP_FAILED',message:'Native artifacts could not be cleaned up within the configured bounds.'};
      }
    }
    for(const remove of run.listeners)remove();run.listeners=[];
    if(run.child) {
      // No manager callbacks retain an unconfirmed child. Its IO handles must not hold shutdown open.
      run.child.stdout?.destroy();run.child.stderr?.destroy();
      if(!confirmed) {run.child.on('error',ignoreDetachedError);run.child.unref?.();}
    }
    if(!transition(run,status)) throw new Error(`Forbidden lifecycle transition: ${run.status} -> ${status}`);
    run.error=status==='completed'?null:run.failure;
    if(status==='completed')run.result=run.completion;
    run.endedAt=now();run.active=false;run.finished=true;this.active--;
    // Keep only bounded history/telemetry/effective configuration; release execution resources.
    run.stderr=Buffer.alloc(0);run.child=null;run.request=null;run.parser=null;
    run.completion=null;run.finalSnapshot=null;run.lastCounts.clear();run.resolveDone();run.resolveDone=null;
  }
  close() {
    if(this.closePromise)return this.closePromise;
    this.closed=true;
    const active=[...this.runs.values()].filter(run=>run.active);
    for(const run of active)this._stop(run,'cancelled','SERVER_SHUTDOWN','Run terminated during backend shutdown; shutdown is not graceful.');
    this.closePromise=(async()=>{
      let deadline;
      try {
        await Promise.race([Promise.all(active.map(run=>run.done)),new Promise(resolve=>{
          deadline=setTimeout(()=>{
            // Direct-child close is insufficient when a tree request is still unresolved.
            void Promise.all(active.filter(run=>!run.finished).map(run=>this._finish(run,null,null,!run.child||run.terminationOutcome?.confirmed===true))).then(resolve);
          },this.shutdownTimeoutMs);
        })]);
        if(this.unconfirmedTermination||[...this.runs.values()].some(run=>run.cleanupFailed))
          throw new BridgeError(503,'SHUTDOWN_INCOMPLETE','Native termination or artifact cleanup could not be confirmed.');
      } finally {clearTimeout(deadline);}
    })();
    return this.closePromise;
  }
}
// This handler retains neither the manager nor the child and only protects detached late OS errors.
function ignoreDetachedError() {}
module.exports={RunManager,BridgeError};
