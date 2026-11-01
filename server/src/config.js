'use strict';
const path=require('node:path');
function readConfig(env=process.env){
 const root=path.resolve(__dirname,'../..');
 function integer(name,def,min,max){const text=env[name];if(text===undefined)return def;if(!/^\d+$/.test(text)||!Number.isSafeInteger(+text)||+text<min||+text>max)throw new Error(`Invalid server setting ${name}`);return +text;}
 const host=env.HOST||'127.0.0.1';if(!['127.0.0.1','::1','localhost'].includes(host))throw new Error('HOST must be loopback');
 return {host,port:integer('PORT',3000,0,65535),allowedOrigin:env.BROWSER_ORIGIN||null,manager:{executablePath:env.NATIVE_EXECUTABLE?path.resolve(root,env.NATIVE_EXECUTABLE):null,cwd:root,tempRoot:path.join(root,'server','.runs'),maxConcurrent:integer('MAX_CONCURRENT_RUNS',2,1,8),maxHistory:integer('MAX_RUN_HISTORY',20,8,100),telemetryLimit:integer('TELEMETRY_RETENTION',100,1,500),maxTelemetryBytes:integer('TELEMETRY_BYTES',1048576,65536,1048576),timeoutMs:integer('RUN_TIMEOUT_MS',30000,100,300000)}};
}
module.exports={readConfig};
