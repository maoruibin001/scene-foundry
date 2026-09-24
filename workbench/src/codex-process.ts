import {writeFileSync,appendFileSync} from 'node:fs';
/** 持久化实时日志与终态；超时不丢掉已返回的错误或部分输出。 */
export async function captureCodexProcess(options:{args:string[];cwd:string;env:Record<string,string>;input:string;prefix:string;timeoutMs:number;signal?:AbortSignal}){
 options.signal?.throwIfAborted();
 const {args,cwd,env,input,prefix,timeoutMs,signal}=options,started=Date.now();
 const p=Bun.spawn(args,{cwd,env,stdin:'pipe',stdout:'pipe',stderr:'pipe'});
 const trace:any={pid:p.pid,startedAt:new Date(started).toISOString(),timeoutMs,status:'running',stdoutBytes:0,stderrBytes:0,firstStdoutAt:null,lastActivityAt:null,exitCode:null};
 const update=()=>writeFileSync(prefix+'execution.json',JSON.stringify(trace,null,2)+'\n');
 writeFileSync(prefix+'stdout.log','');writeFileSync(prefix+'cli.log','');update();
 let timedOut=false,stdout='',stderr='';
 const kill=()=>{if(p.exitCode===null)p.kill('SIGKILL')};
 const timer=setTimeout(()=>{timedOut=true;kill()},timeoutMs);signal?.addEventListener('abort',kill,{once:true});
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
