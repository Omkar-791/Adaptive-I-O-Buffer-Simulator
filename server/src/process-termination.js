'use strict';
const { spawn } = require('node:child_process');

// Only actual owned processes may enable tree mode. Injected fixture PIDs must not.
function windowsTree(pid, force, timeoutMs, abortSignal) {
  return new Promise(resolve => {
    let tool;
    let timer;
    let done=false;
    const finish=error=>{
      if(done)return;done=true;clearTimeout(timer);
      abortSignal?.removeEventListener('abort',onAbort);
      if(tool){tool.removeListener('close',onClose);tool.removeListener('error',onError);tool.once('error',()=>{});}
      resolve(error);
    };
    const onClose=code=>finish(code===0?null:new Error('Tree termination request failed.'));
    const onError=()=>finish(new Error('Tree termination command unavailable.'));
    const onAbort=()=>{try{tool?.kill();}catch{}tool?.unref();finish(new Error('Tree termination command abandoned.'));};
    try {
      tool=spawn('taskkill.exe',['/PID',String(pid),'/T',...(force?['/F']:[])],{shell:false,windowsHide:true,stdio:'ignore'});
      // A command timing out is not evidence that it succeeded.
      tool.once('close',onClose);tool.once('error',onError);
      abortSignal?.addEventListener('abort',onAbort,{once:true});
      if(abortSignal?.aborted){onAbort();return;}
      timer=setTimeout(()=>{try{tool.kill();}catch{}tool.unref();finish(new Error('Tree termination request timed out.'));},timeoutMs);
    } catch {finish(new Error('Tree termination command failed.'));}
  });
}

async function requestSignal(child,signal,{tree,platform,timeoutMs,abortSignal,isClosed}) {
  if(tree && Number.isSafeInteger(child.pid) && child.pid>0) {
    if(platform==='win32') {
      const error=await windowsTree(child.pid,signal==='SIGKILL',timeoutMs,abortSignal);
      if(!error)return;
      // Best effort direct-child fallback; tree confirmation is never inferred.
      if(!abortSignal.aborted&&!isClosed())try{child.kill(signal);}catch{}
      throw error;
    }
    try{process.kill(-child.pid,signal);return;}catch(error){
      if(error.code==='ESRCH')return;
      try{child.kill(signal);}catch{}
      throw error;
    }
  }
  if(child.kill(signal)===false)throw new Error('Process termination request was not accepted.');
}

/** Bounded, idempotent termination. A signal return value never establishes exit. */
function createTermination(child,options={}) {
  const graceMs=options.graceMs??250;
  const forceWaitMs=options.forceWaitMs??1000;
  for(const value of [graceMs,forceWaitMs])if(!Number.isSafeInteger(value)||value<1||value>30000)throw new TypeError('Invalid termination duration');
  const tree=options.tree===true;
  const platform=options.platform??process.platform;
  const setTimer=options.setTimer??setTimeout;
  const clearTimer=options.clearTimer??clearTimeout;
  const send=options.signalProcess??requestSignal;
  const groupRemains=options.groupExists??(()=>{
    if(!tree||platform==='win32'||!ownedChild?.pid)return false;
    try{process.kill(-ownedChild.pid,0);return true;}catch(error){return error.code!=='ESRCH';}
  });
  let ownedChild=child,closed=false,code=null,signal=null,forced=false,disposed=false;
  let graceTimer,finalTimer,promise,resolveStop,pending=0;
  const operations=new Set();
  const errors=[];
  const clear=()=>{clearTimer(graceTimer);clearTimer(finalTimer);graceTimer=finalTimer=undefined;};
  const outcome=()=>({confirmed:closed&&!groupRemains(),forced,code,signal,errors:[...errors],treeRequested:tree});
  const complete=(bounded=false)=>{
    if(!bounded && closed && (pending>0||groupRemains()))return;
    clear();if(resolveStop){const resolve=resolveStop;resolveStop=undefined;resolve(outcome());}
  };
  const onClose=(exitCode,exitSignal)=>{closed=true;code=exitCode;signal=exitSignal;complete();};
  child.once('close',onClose);
  function issue(requestedSignal) {
    const target=ownedChild;
    if(!target)return;
    const controller=new AbortController();operations.add(controller);pending++;
    try {
      Promise.resolve(send(target,requestedSignal,{tree,platform,timeoutMs:Math.min(forceWaitMs,1000),abortSignal:controller.signal,isClosed:()=>closed})).catch(()=>{errors.push(`${requestedSignal} request failed`);}).finally(()=>{pending--;operations.delete(controller);if(closed)complete();});
    } catch {pending--;operations.delete(controller);errors.push(`${requestedSignal} request failed`);if(closed)complete();}
  }
  function stop() {
    if(promise)return promise;
    if(disposed||(closed&&!groupRemains()))return promise=Promise.resolve(outcome());
    promise=new Promise(resolve=>{resolveStop=resolve;});
    // Install bounds before signalling: deterministic fixtures can close synchronously.
    graceTimer=setTimer(()=>{
      graceTimer=undefined;
      if(closed&&!groupRemains()){complete();return;}
      forced=true;
      finalTimer=setTimer(()=>{finalTimer=undefined;complete(true);},forceWaitMs);
      issue('SIGKILL');
    },graceMs);
    issue('SIGTERM');
    return promise;
  }
  function dispose() {
    if(disposed)return;disposed=true;
    for(const operation of operations)operation.abort();operations.clear();
    complete(true);
    ownedChild?.removeListener('close',onClose);
    ownedChild=null;
  }
  return {stop,dispose};
}
module.exports={createTermination};
