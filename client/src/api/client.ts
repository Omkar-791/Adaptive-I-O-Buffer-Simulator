import type {CreateRun,RunSummary,TelemetryEnvelope,Result,Health} from '../types/api';
export class ApiError extends Error {constructor(public status:number,public code:string,message:string){super(message)}}
async function request<T>(path:string,options:RequestInit={}):Promise<T>{
 let response:Response;
 try{response=await fetch(`${import.meta.env.VITE_API_BASE_URL || '/api/v1'}${path}`,{...options,headers:{...(options.body?{'Content-Type':'application/json'}:{}),...options.headers}})}catch(error){if(options.signal?.aborted || (typeof error==='object'&&error!==null&&'name' in error&&error.name==='AbortError'))throw error;throw new ApiError(0,'NETWORK_ERROR','Cannot reach the backend. Check its connection and retry.')}
 let data;try {data=await response.json()}catch{throw new ApiError(response.status,'INVALID_RESPONSE','The backend returned an unreadable response.')}
 if(!response.ok)throw new ApiError(response.status,data.error?.code??'HTTP_ERROR',data.error?.message??`Request failed (${response.status})`);
 return data as T;
}
export const api={health:(signal?:AbortSignal)=>request<Health>('/health',{signal}),runs:(signal?:AbortSignal)=>request<{runs:RunSummary[]}>('/runs?limit=100',{signal}),run:(id:string,signal?:AbortSignal)=>request<RunSummary>(`/runs/${encodeURIComponent(id)}`,{signal}),create:(body:CreateRun)=>request<RunSummary>('/runs',{method:'POST',body:JSON.stringify(body)}),telemetry:(id:string,after:number,signal?:AbortSignal)=>request<TelemetryEnvelope>(`/runs/${encodeURIComponent(id)}/telemetry?after=${after}&limit=100`,{signal}),result:(id:string,signal?:AbortSignal)=>request<Result>(`/runs/${encodeURIComponent(id)}/result`,{signal}),cancel:(id:string,signal?:AbortSignal)=>request<RunSummary>(`/runs/${encodeURIComponent(id)}/cancel`,{method:'POST',signal})};

