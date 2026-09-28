import {writeFileSync,appendFileSync} from 'node:fs';
/** 持久化实时日志与终态；超时不丢掉已返回的错误或部分输出。 */
export async function captureCodexProcess(options:{args:string[];cwd:string;env:Record<string,string>;input:string;prefix:string;timeoutMs:number;maxTimeoutMs?:number;activityWindowMs?:number;extensionMs?:number;signal?:AbortSignal}){
 options.signal?.throwIfAborted();
 const {args,cwd,env,input,prefix,timeoutMs,signal}=options,started=Date.now();
 const p=Bun.spawn(args,{cwd,env,stdin:'pipe',stdout:'pipe',stderr:'pipe'});
 const maxTimeoutMs=Math.max(timeoutMs,options.maxTimeoutMs??timeoutMs);
 const trace:any={pid:p.pid,startedAt:new Date(started).toISOString(),timeoutMs,maxTimeoutMs,extensions:[],deadlineAt:new Date(started+timeoutMs).toISOString(),status:'running',stdoutBytes:0,stderrBytes:0,firstStdoutAt:null,lastActivityAt:null,exitCode:null};
 const update=()=>writeFileSync(prefix+'execution.json',JSON.stringify(trace,null,2)+'\n');
 writeFileSync(prefix+'stdout.log','');writeFileSync(prefix+'cli.log','');update();
 let timedOut=false,stdout='',stderr='';
 const kill=()=>{if(p.exitCode===null)p.kill('SIGKILL')};
 let timer:ReturnType<typeof setTimeout>;
 const deadline=()=>{const now=Date.now(),last=Date.parse(trace.lastActivityAt??'');if(p.exitCode===null&&now<started+maxTimeoutMs&&Number.isFinite(last)&&now-last<=(options.activityWindowMs??0)){
  const next=Math.min(started+maxTimeoutMs,now+(options.extensionMs??timeoutMs));trace.extensions.push({at:now,nextDeadlineAt:next,reason:'仍有模型输出，自动延长当前调用'});trace.deadlineAt=new Date(next).toISOString();update();timer=setTimeout(deadline,next-now);return;
 }timedOut=true;trace.timeoutReason=now>=started+maxTimeoutMs?'absolute-limit':'inactive-at-deadline';kill();};
 timer=setTimeout(deadline,timeoutMs);signal?.addEventListener('abort',kill,{once:true});
 if(signal?.aborted)kill();
 const pump=async(stream:ReadableStream<Uint8Array>,kind:'stdout'|'stderr')=>{
  const decoder=new TextDecoder();
  for await(const chunk of stream){appendFileSync(prefix+(kind==='stdout'?'stdout.log':'cli.log'),chunk);trace[kind+'Bytes']+=chunk.byteLength;trace.lastActivityAt=new Date().toISOString();if(kind==='stdout')trace.firstStdoutAt??=trace.lastActivityAt;update();const text=decoder.decode(chunk,{stream:true});if(kind==='stdout')stdout+=text;else stderr+=text;}
  const tail=decoder.decode();if(kind==='stdout')stdout+=tail;else stderr+=tail;
 };
 const readers=[pump(p.stdout,'stdout'),pump(p.stderr,'stderr')];
 try{
  p.stdin.write(input);await p.stdin.end();
  await Promise.all([p.exited,...readers]);
  trace.status=signal?.aborted?'cancelled':timedOut?'timed_out':p.exitCode===0?'completed':'failed';
  return {code:p.exitCode,timedOut,cancelled:signal?.aborted??false,stdout,stderr,trace};
 }catch(error){trace.status='failed';trace.error=String(error);throw error;}
 finally{clearTimeout(timer);signal?.removeEventListener('abort',kill);kill();await p.exited;await Promise.allSettled(readers);trace.exitCode=p.exitCode;trace.durationMs=Date.now()-started;trace.endedAt=new Date().toISOString();update();}
}
