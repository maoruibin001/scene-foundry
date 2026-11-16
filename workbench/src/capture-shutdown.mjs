import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';import {join} from 'node:path';
/** Only this capture process and its descendants, never unrelated Chrome tasks. */
export function captureProcessTree(rootPid=process.pid){
 const rows=execFileSync('ps',['-axo','pid=,ppid=,etime=,%cpu=,rss=,command='],{encoding:'utf8',timeout:1500,maxBuffer:4*1024*1024}).split('\n').flatMap(line=>{const m=line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(\d+)\s+(.*)$/);return m?[{pid:Number(m[1]),ppid:Number(m[2]),elapsed:m[3],cpu:Number(m[4]),rssKiB:Number(m[5]),command:m[6]}]:[];});
 const owned=new Set([rootPid]);let changed=true;while(changed){changed=false;for(const r of rows)if(owned.has(r.ppid)&&!owned.has(r.pid)){owned.add(r.pid);changed=true;}}
 return rows.filter(r=>owned.has(r.pid)).map(r=>({...r,command:r.command.replace(/([?&](?:token|key|secret|authorization)=)[^&\s]+/gi,'$1[redacted]').slice(0,800)}));
}
/** Preserve the 30s gate and require the SDK's own closure receipt. */
export async function closeCaptureResources(session,sink,step=()=>{},{timeoutMs=30000,outputDir,releaseMedia}={}){
 const started=Date.now(),diag={version:'capture-close-diag-v1',capturePid:process.pid,startedAt:new Date().toISOString(),phase:'sink',sinkCloseMs:null,mediaReleaseMs:null,sessionCloseMs:null,closedAt:null,timeoutMs};let timer;
 const persist=()=>{if(outputDir){mkdirSync(outputDir,{recursive:true});writeFileSync(join(outputDir,'capture-close-diag.json'),JSON.stringify({...diag,elapsedMs:Date.now()-started},null,2));}};
 const cleanup=(async()=>{try{step('关闭录屏接收器');const t=Date.now();try{await sink?.close();}finally{diag.sinkCloseMs=Date.now()-t;persist();}}
 finally{try{diag.phase='media';const t=Date.now();try{diag.media=await releaseMedia?.()??null;if(releaseMedia&&session?.page&&!session.page.isClosed()&&(!diag.media||diag.media.chunks!==0||diag.media.objectUrlActive||diag.media.recorderActive||!diag.media.channelClosed))throw Error('CAPTURE_MEDIA_RELEASE_UNCONFIRMED');}finally{diag.mediaReleaseMs=Date.now()-t;persist();}}
 finally{diag.phase='session';step('关闭Engine采集会话');const t=Date.now();try{await session?.close();const report=session?.report?.();if(report?.schemaVersion&&report?.carrier&&!report.closedAt)throw Error('CAPTURE_CLOSE_UNCONFIRMED：Engine未确认会话关闭');diag.closedAt=report?.closedAt??null;diag.phase='closed';}finally{diag.sessionCloseMs=Date.now()-t;persist();}}}})();
 try{await Promise.race([cleanup,new Promise((_,reject)=>{timer=setTimeout(()=>{diag.phaseAtTimeout=diag.phase;diag.timedOutAt=new Date().toISOString();try{diag.processTree=captureProcessTree();}catch(error){diag.processTreeError=String(error);}persist();reject(Error('CAPTURE_CLEANUP_TIMEOUT：采集资源关闭超时，保留画面及日志，不视为采集成功'));},timeoutMs);})]);step('采集资源已关闭');return diag;}
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
