'use strict';
const {createApp}=require('./app');const {RunManager}=require('./run-manager');const {readConfig}=require('./config');
async function start(){
 const config=readConfig(),manager=new RunManager(config.manager),app=createApp({manager,allowedOrigin:config.allowedOrigin});
 const server=app.listen(config.port,config.host,()=>console.log(`Adaptive IO backend listening on ${config.host}:${server.address().port}`));
 server.on('error',()=>{console.error('Backend listener failed.');process.exitCode=1;});
 server.headersTimeout=10000;server.requestTimeout=15000;server.keepAliveTimeout=5000;
 let stopping=false;
 async function stop(){if(stopping)return;stopping=true;server.close();try{await manager.close();server.closeIdleConnections();}catch{console.error('Backend shutdown could not confirm native process termination.');process.exitCode=1;}}
 process.once('SIGINT',stop);process.once('SIGTERM',stop);return {server,manager,stop};
}
if(require.main===module)start().catch(()=>{console.error('Invalid backend startup configuration.');process.exitCode=1;});
module.exports={start};
