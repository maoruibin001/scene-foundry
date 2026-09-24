import {test,expect} from 'bun:test';
import {mkdtempSync,mkdirSync,writeFileSync,appendFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Source} from './source';
import {liveOutput} from './live-output';
const id='00000000-0000-0000-0000-000000000009';
function fixture(){const root=mkdtempSync(join(tmpdir(),'output-stream-')),dir=join(root,'runs',id);mkdirSync(dir,{recursive:true});writeFileSync(join(dir,'job.json'),JSON.stringify({id,status:'running',stages:{},events:[]}));writeFileSync(join(dir,'plan-execution.json'),JSON.stringify({status:'running'}));return {root,dir,source:new Source(root),key:'run:'+id};}
async function until(reader:ReadableStreamDefaultReader<Uint8Array>,text:string){let value='';const timeout=AbortSignal.timeout(3500);while(!value.includes(text)){const chunk=await Promise.race([reader.read(),new Promise<never>((_,reject)=>timeout.addEventListener('abort',()=>reject(Error('stream timeout')),{once:true}))]);if(chunk.done)break;value+=new TextDecoder().decode(chunk.value);}return value;}
test('SSE sends existing output then filesystem append deltas; disconnect does not own producer',async()=>{
 const f=fixture(),abort=new AbortController();try{writeFileSync(join(f.dir,'plan-cli.log'),'first\n');const response=liveOutput(f.source,f.key,'plan','log',abort.signal),reader=response.body!.getReader();expect(response.headers.get('content-type')).toContain('text/event-stream');expect(await until(reader,'first')).toContain('event: output');appendFileSync(join(f.dir,'plan-cli.log'),'second\n');const delta=await until(reader,'second');expect(delta).not.toContain('first');abort.abort();await until(reader,'never');appendFileSync(join(f.dir,'plan-cli.log'),'producer continues\n');expect(f.source.call(f.key,'plan','log').text).toContain('producer continues');}finally{abort.abort();rmSync(f.root,{recursive:true,force:true});}
});
test('empty startup followed by unicode bytes preserves decoder state and terminal status closes stream',async()=>{
 const f=fixture(),abort=new AbortController();try{const reader=liveOutput(f.source,f.key,'plan','stdout',abort.signal).body!.getReader();expect(await until(reader,'event: missing')).toContain('missing');writeFileSync(join(f.dir,'plan-stdout.log'),Buffer.from([228]));await until(reader,'event: reset');appendFileSync(join(f.dir,'plan-stdout.log'),Buffer.from([184,173]));expect(await until(reader,'中')).not.toContain('�');writeFileSync(join(f.dir,'plan-execution.json'),JSON.stringify({status:'completed'}));f.source.detailCache.clear();expect(await until(reader,'event: end')).toContain('completed');}finally{abort.abort();rmSync(f.root,{recursive:true,force:true});}
});
test('completed calls are explicitly ended and subscriptions reject arbitrary call or content paths',async()=>{
 const f=fixture(),abort=new AbortController();try{writeFileSync(join(f.dir,'plan-execution.json'),JSON.stringify({status:'completed'}));writeFileSync(join(f.dir,'plan-cli.log'),'old result');const text=await liveOutput(f.source,f.key,'plan','log',abort.signal).text();expect(text).toContain('old result');expect(text).toContain('event: end');expect(()=>liveOutput(f.source,f.key,'../secret','log',abort.signal)).toThrow();expect(()=>liveOutput(f.source,f.key,'plan','input',abort.signal)).toThrow();}finally{abort.abort();rmSync(f.root,{recursive:true,force:true});}
});
