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
