/** Engine session owns browser cleanup. Keep teardown bounded and report failures. */
export async function closeCaptureResources(session,sink,step=()=>{},{timeoutMs=30000}={}){
 let timer;
 const cleanup=(async()=>{try{step('关闭录屏接收器');await sink?.close();}finally{step('关闭Engine采集会话');await session?.close();}})();
 try{await Promise.race([cleanup,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('CAPTURE_CLEANUP_TIMEOUT：采集资源关闭超时，保留画面及日志，不视为采集成功')),timeoutMs);})]);step('采集资源已关闭');}
 finally{clearTimeout(timer);}
}
/** 采集父进程超时或取消时先关闭浏览器，让其子进程与运行报告正常收尾。 */
export function captureShutdown(close){
 let pending=false,ready=false,closing;
 const cleanup=()=>closing??=Promise.resolve().then(close);
 const finish=()=>void cleanup().finally(()=>process.exit(143));
 const terminate=()=>{pending=true;if(ready)finish();};
 process.once('SIGTERM',terminate);
 return {
  ready(){ready=true;if(pending)finish();return pending;},
  async close(){try{await cleanup();}finally{process.removeListener('SIGTERM',terminate);}}
 };
}
