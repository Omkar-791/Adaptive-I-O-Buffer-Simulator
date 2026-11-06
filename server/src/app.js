'use strict';
const express=require('express');
const {validateRequest}=require('./validation');
const loopbacks=new Set(['localhost','127.0.0.1','::1','[::1]']);
function apiError(status,code,message){const e=new Error(message);e.status=status;e.code=code;return e;}
function createApp({manager,allowedOrigin=null}={}){
 if(!manager)throw new TypeError('Run manager required');
 if(allowedOrigin){const u=new URL(allowedOrigin);if(!loopbacks.has(u.hostname)||!['http:','https:'].includes(u.protocol)||u.origin!==allowedOrigin)throw new TypeError('Allowed origin must be a loopback origin');}
 const app=express();app.disable('x-powered-by');app.set('trust proxy',false);
 app.use((req,res,next)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  if(!loopbacks.has(req.hostname))return next(apiError(403,'HOST_NOT_ALLOWED','Only loopback hosts are supported.'));
  const origin=req.get('origin');const same=`${req.protocol}://${req.get('host')}`;
  if(origin&&origin!==same&&origin!==allowedOrigin)return next(apiError(403,'ORIGIN_NOT_ALLOWED','Request origin is not allowed.'));
  if(origin&&origin===allowedOrigin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type');}
  if(req.method==='OPTIONS')return res.sendStatus(204);
  next();
 });
 app.use(express.json({limit:131072,strict:true,inflate:false}));
 const route=fn=>(req,res,next)=>Promise.resolve().then(()=>fn(req,res)).catch(next);
 function query(req,allowed){if(Object.keys(req.query).some(k=>!allowed.includes(k)))throw apiError(400,'INVALID_QUERY','Unsupported query parameter.');}
 function number(value,def){if(value===undefined)return def;if(typeof value!=='string'||!/^\d+$/.test(value)||!Number.isSafeInteger(Number(value)))throw apiError(400,'INVALID_QUERY','Query values must be nonnegative integers.');return Number(value);}
 const view=run=>({...run,statusUrl:`/api/v1/runs/${run.id}`});
 app.get('/api/v1/health',route(async(req,res)=>res.json(await manager.health())));
 app.post('/api/v1/runs',route(async(req,res)=>{
  if(!req.is('application/json'))throw apiError(415,'UNSUPPORTED_MEDIA_TYPE','Use application/json.');
  const normalized=validateRequest(req.body);const run=await manager.create(normalized);res.status(202).json(view(run));
 }));
 app.get('/api/v1/runs',route((req,res)=>{query(req,['limit']);res.json({runs:manager.list(number(req.query.limit,20)).map(view)});}));
 app.get('/api/v1/runs/:id',route((req,res)=>res.json(view(manager.get(req.params.id)))));
 app.get('/api/v1/runs/:id/telemetry',route((req,res)=>{query(req,['after','limit']);res.json(manager.telemetry(req.params.id,{after:number(req.query.after,0),limit:number(req.query.limit,manager.telemetryLimit)}));}));
 app.get('/api/v1/runs/:id/result',route((req,res)=>res.json(manager.result(req.params.id))));
 app.post('/api/v1/runs/:id/cancel',route(async(req,res)=>{if(req.body!==undefined&&(typeof req.body!=='object'||req.body===null||Object.keys(req.body).length))throw apiError(422,'INVALID_CONFIGURATION','Cancellation accepts no fields.');res.status(202).json(view(await manager.cancel(req.params.id)));}));
 app.use((req,res,next)=>next(apiError(404,'NOT_FOUND','API endpoint not found.')));
 app.use((error,req,res,next)=>{
  if(res.headersSent)return next(error);
  if(error instanceof URIError)return res.status(400).json({error:{code:'INVALID_REQUEST',message:'Invalid URL encoding.'}});
  if(error.type==='entity.too.large')return res.status(413).json({error:{code:'BODY_TOO_LARGE',message:'JSON body exceeds 128 KiB.'}});
  if(['encoding.unsupported','charset.unsupported'].includes(error.type))return res.status(415).json({error:{code:'UNSUPPORTED_ENCODING',message:'Use uncompressed UTF-8 JSON.'}});
  if(['request.aborted','request.size.invalid'].includes(error.type))return res.status(400).json({error:{code:'INVALID_REQUEST',message:'Request body could not be read.'}});
  if(error.type==='entity.parse.failed')return res.status(400).json({error:{code:'INVALID_JSON',message:'Request body must be valid JSON.'}});
  const exposed=Number.isInteger(error.status)&&error.status>=400&&error.status<=599&&/^[A-Z_]+$/.test(error.code||'');
  res.status(exposed?error.status:500).json({error:{code:exposed?error.code:'INTERNAL_ERROR',message:exposed?error.message:'Backend operation failed.'}});
 });
 return app;
}
module.exports={createApp};
