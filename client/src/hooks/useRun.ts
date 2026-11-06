import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import type { RunSummary, Result, TelemetryEvent, TelemetryEnvelope } from '../types/api';

export const activeRun = (status: string) => status === 'starting' || status === 'running';
function validRecord(event: TelemetryEvent) {
 const record=event?.record;
 if(!record||!Array.isArray(record.streams))return false;
 const finite=(n:unknown)=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
 if(record.type==='metrics_snapshot')return finite(record.elapsed_ms)&&finite(record.window_ms)&&Number.isSafeInteger(record.sequence)&&!!record.global&&[record.global,...record.streams].every(s=>[s.stream_id,s.occupancy,s.capacity,s.consumed,s.produced,s.producer_wait_ms,s.throughput_req_per_sec,s.utilization_pct,s.avg_latency_ms].every(finite));
 if(record.type==='buffer_resize')return Number.isSafeInteger(record.snapshot_sequence)&&typeof record.reason==='string'&&typeof record.success==='boolean'&&typeof record.deferred==='boolean'&&typeof record.stale==='boolean'&&record.streams.every(s=>[s.stream_id,s.previous_capacity,s.requested_capacity,s.actual_capacity].every(finite));
 return record.type==='simulation_completed'&&[record.total_consumed,record.total_produced,record.simulation_time_sec,record.throughput_req_per_sec].every(finite);
}
/** Validate the complete page before committing its cursor. Invalid pages remain retryable. */
export function mergeTelemetry(previous:TelemetryEvent[],page:TelemetryEnvelope,cursor:number){
 if(!Number.isSafeInteger(page.nextCursor)||page.nextCursor<cursor||!Number.isSafeInteger(page.oldestCursor)||page.oldestCursor<0||typeof page.truncated!=='boolean'||!Array.isArray(page.records)||page.records.some(e=>!Number.isSafeInteger(e.index)||e.index<1||e.index>page.nextCursor||typeof e.receivedAt!=='string'||!Number.isFinite(Date.parse(e.receivedAt))||!validRecord(e)))throw new Error('The backend returned an invalid telemetry page.');
 const unique=new Map(previous.map(e=>[e.index,e]));
 for(const event of page.records)if(event.index>cursor)unique.set(event.index,event);
 const ordered=[...unique.values()].sort((a,b)=>a.index-b.index);
 return {records:ordered.slice(-600),cursor:page.nextCursor,clientTruncated:ordered.length>600};
}
export function useRun(id?:string){
 const [run,setRun]=useState<RunSummary>();const [records,setRecords]=useState<TelemetryEvent[]>([]);const [result,setResult]=useState<Result>();
 const [error,setError]=useState<string>();const [loading,setLoading]=useState(false);const [truncated,setTruncated]=useState(false);const [clientTruncated,setClientTruncated]=useState(false);const [cancelling,setCancelling]=useState(false);const [generation,setGeneration]=useState(0);
 const [cursorMetadata,setCursorMetadata]=useState<{nextCursor?:number;oldestCursor?:number}>({});
 const session=useRef<{id?:string;cursor:number;records:TelemetryEvent[]}>({cursor:0,records:[]});
 const cancellation=useRef<AbortController|undefined>(undefined);
 const cancelPending=useRef(false);
 const retry=useCallback(()=>setGeneration(n=>n+1),[]);
 useEffect(()=>{
  if(session.current.id!==id){session.current={id,cursor:0,records:[]};setRun(undefined);setRecords([]);setResult(undefined);setTruncated(false);setClientTruncated(false);setCursorMetadata({})}
  setError(undefined);setCancelling(false);cancelPending.current=false;setLoading(!!id&&session.current.cursor===0);
  if(!id)return;
  const current=session.current;
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;let failures=0;
  async function poll(){
   try{
    const summary=await api.run(id!,controller.signal);if(controller.signal.aborted)return;setRun(summary);
    let again:boolean;
    do{
     const page=await api.telemetry(id!,current.cursor,controller.signal);if(controller.signal.aborted)return;
     const before=current.cursor;const merged=mergeTelemetry(current.records,page,current.cursor);
     setCursorMetadata({nextCursor:page.nextCursor,oldestCursor:page.oldestCursor});
     current.records=merged.records;current.cursor=merged.cursor;setRecords(current.records);
     if(page.truncated)setTruncated(true);if(merged.clientTruncated)setClientTruncated(true);
     again=!activeRun(summary.status)&&page.records.length>=100&&current.cursor>before;
    }while(again);
    if(summary.status==='completed'){const final=await api.result(id!,controller.signal);if(controller.signal.aborted)return;setResult(final)}
    // Result retrieval is part of the transaction: failure must count toward the retry ceiling.
    failures=0;setLoading(false);setError(undefined);
    if(activeRun(summary.status))timer=setTimeout(poll,500);
   }catch(cause){
    if(controller.signal.aborted)return;setLoading(false);failures++;
    const message=cause instanceof Error?cause.message:'Run update failed.';
    if(failures<=3){setError(`${message} Displaying retained measurements; retrying (${failures}/3)…`);timer=setTimeout(poll,Math.min(4000,500*2**failures))}
    else setError(`${message} Automatic retries paused. Retained measurements may be stale.`);
   }
  }
  void poll();
  return()=>{controller.abort();if(timer)clearTimeout(timer);cancellation.current?.abort();cancelPending.current=false};
 },[id,generation]);
 const cancel=useCallback(async()=>{
  if(!id||cancelPending.current||!run||!activeRun(run.status))return;
  cancelPending.current=true;setCancelling(true);setError(undefined);
  const abort=new AbortController();cancellation.current=abort;
  try{const summary=await api.cancel(id,abort.signal);if(!abort.signal.aborted)setRun(summary)}
  catch(cause){if(!abort.signal.aborted)setError(cause instanceof Error?cause.message:'Cancellation request failed.')}
  finally{if(!abort.signal.aborted){cancelPending.current=false;setCancelling(false)}}
 },[id,run]);
 return {run,records,result,error,loading,truncated,clientTruncated,retry,cancel,cancelling,...cursorMetadata};
}
