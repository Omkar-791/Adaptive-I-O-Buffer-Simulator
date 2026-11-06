'use strict';
const {createApp}=require('./app');const {RunManager}=require('./run-manager');const {readConfig}=require('./config');
async function start(){
 const config=readConfig(),manager=new RunManager(config.manager),app=createApp({manager,allowedOrigin:config.allowedOrigin});
 const server=app.listen(config.port,config.host,()=>console.log(`Adaptive IO backend listening on ${config.host}:${server.address().port}`));
 server.on('error',()=>{console.error('Backend listener failed.');process.exitCode=1;});
 server.headersTimeout=10000;server.requestTimeout=15000;server.keepAliveTimeout=5000;
 let stopPromise;
 function stop(){
  if(stopPromise)return stopPromise;
  stopPromise=(async()=>{
   let deadline;
   const listenerClosed=new Promise(resolve=>server.close(resolve));
   try{await manager.close();}
   catch{console.error('Backend shutdown could not confirm native process termination.');process.exitCode=1;}
   finally{
    server.closeIdleConnections();
    // No new connections are accepted; end existing HTTP sockets after run cleanup.
    server.closeAllConnections();
    try{await Promise.race([listenerClosed,new Promise((_,reject)=>{deadline=setTimeout(()=>reject(new Error('HTTP shutdown deadline')),manager.shutdownTimeoutMs);})]);}
    catch{console.error('Backend HTTP shutdown exceeded its deadline.');process.exitCode=1;}
    finally{clearTimeout(deadline);process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
   }
  })();
  return stopPromise;
 }
 process.once('SIGINT',stop);process.once('SIGTERM',stop);return {server,manager,stop};
}
if(require.main===module)start().catch(()=>{console.error('Invalid backend startup configuration.');process.exitCode=1;});
module.exports={start};
