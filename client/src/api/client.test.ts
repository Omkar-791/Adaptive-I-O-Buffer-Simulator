import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {api,ApiError} from './client';
const fetchMock=vi.fn();
beforeEach(()=>vi.stubGlobal('fetch',fetchMock));
afterEach(()=>{vi.unstubAllGlobals();fetchMock.mockReset()});
function response(data:unknown,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}})}
describe('typed API transport',()=>{
 it('reads real health shape and forwards abort signal',async()=>{const body={status:'ok',native:{configured:true,available:true},activeRuns:0,concurrencyLimit:2};fetchMock.mockResolvedValue(response(body));const abort=new AbortController();expect(await api.health(abort.signal)).toEqual(body);expect(fetchMock).toHaveBeenCalledWith('/api/v1/health',expect.objectContaining({signal:abort.signal}))});
 it('serializes run creation using JSON',async()=>{const body={strategy:'fixed' as const,config:{num_streams:1,global_buffer_budget:8},metrics:{interval_ms:100,window_ms:1000}};fetchMock.mockResolvedValue(response({id:'real-returned-id'},202));expect((await api.create(body)).id).toBe('real-returned-id');expect(fetchMock).toHaveBeenCalledWith('/api/v1/runs',expect.objectContaining({method:'POST',body:JSON.stringify(body),headers:expect.objectContaining({'Content-Type':'application/json'})}))});
 it.each([
  ['history',()=>api.runs(),'/api/v1/runs?limit=100'],
  ['status',()=>api.run('a/b'),'/api/v1/runs/a%2Fb'],
  ['telemetry',()=>api.telemetry('abc',42),'/api/v1/runs/abc/telemetry?after=42&limit=100'],
  ['result',()=>api.result('abc'),'/api/v1/runs/abc/result'],
  ['cancel',()=>api.cancel('abc'),'/api/v1/runs/abc/cancel'],
 ] as const)('uses established %s endpoint',async(_label,call,path)=>{fetchMock.mockResolvedValue(response({}));await call();expect(fetchMock.mock.calls[0][0]).toBe(path);if(_label==='cancel')expect(fetchMock.mock.calls[0][1].method).toBe('POST')});
 it('preserves safe backend validation details',async()=>{fetchMock.mockResolvedValue(response({error:{code:'INVALID_CONFIGURATION',message:'Invalid capacity'}},422));await expect(api.create({strategy:'fixed',config:{global_buffer_budget:0},metrics:{interval_ms:100,window_ms:1000}})).rejects.toMatchObject({status:422,code:'INVALID_CONFIGURATION',message:'Invalid capacity'})});
 it('reports unreadable backend response',async()=>{fetchMock.mockResolvedValue(new Response('not-json',{status:502}));await expect(api.health()).rejects.toBeInstanceOf(ApiError)});
 it('does not turn network errors into successful data',async()=>{fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));await expect(api.health()).rejects.toThrow()});
 it('propagates cancellation of a request',async()=>{const abort=new AbortController();abort.abort();fetchMock.mockRejectedValue(new DOMException('Aborted','AbortError'));await expect(api.run('abc',abort.signal)).rejects.toMatchObject({name:'AbortError'})});
});
