import {crossTaskReuse} from './reuse-mode';
import {existsSync,mkdirSync,readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {DATA,digest,read,save} from './store';
const roles=new Set(['plan','scene-observation','scene-space','scene-surface','scene-blockout','geometry-asset']);
export const stable=(v:any):string=>JSON.stringify(v,(_k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
export function validatedKey(input:any,identity:any){return digest(stable({identity,role:input.role,system:input.system,text:input.text,schemaContext:input.schemaContext??null,maxTokens:input.maxTokens,modelSettings:input.modelSettings,images:(input.images??[]).map(i=>({mime:i.mime,sha256:digest(readFileSync(i.path))}))}));}
/** Single-flight within the coordinator. Disk artifacts survive restart; failures are never cached. */
export class ValidatedCache{
 private active=new Map<string,Promise<any>>();
 constructor(readonly root:string){}
 get(key:string,validate:(v:any)=>any){try{const row=read(join(this.root,key+'.json'));if(row.key!==key||digest(stable(row.result))!==row.sha256)return null;validate(structuredClone(row.result.value));return row;}catch{return null;}}
 async use(key:string,validate:(v:any)=>any,compute:()=>Promise<any>,source:any,signal?:AbortSignal){
  signal?.throwIfAborted();const hit=this.get(key,validate);if(hit)return {result:structuredClone(hit.result),reuse:{...hit.source,key,kind:'validated-cache'}};
  const pending=this.active.get(key);
  if(pending){let abort:()=>void=()=>{};try{await Promise.race([pending,new Promise((_,reject)=>{abort=()=>reject(signal?.reason??Error('CANCELLED'));signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();})]);signal?.throwIfAborted();const row=this.get(key,validate);if(row)return {result:structuredClone(row.result),reuse:{...row.source,key,kind:'shared-inflight'}};}finally{signal?.removeEventListener('abort',abort);}}
  const work=(async()=>{const result=await compute();signal?.throwIfAborted();validate(result.value);try{mkdirSync(this.root,{recursive:true});save(join(this.root,key+'.json'),{key,result,sha256:digest(stable(result)),source,createdAt:Date.now()});}catch{/* Cache storage failure cannot discard a valid generated output. */}return result;})();
  this.active.set(key,work);try{return {result:await work,reuse:null};}finally{if(this.active.get(key)===work)this.active.delete(key);}
 }
}
export const validatedCache=new ValidatedCache(join(DATA,'validated-output-cache-v1'));
export function cacheEnabled(job:any,role:string){return job?.optimizationPolicy?.reuse===true&&crossTaskReuse(job)&&!job.refineScene&&roles.has(role);}
export function persistValidatedReuse(dir:string,role:string,result:any,reuse:any,startedAt:number){
 const originalReceipt=result.receipt,receipt={...originalReceipt,durationMs:Date.now()-startedAt,reused:true,reusedFrom:reuse,originalReceipt};
 writeFileSync(join(dir,role+'-response.txt'),JSON.stringify(result.value));save(join(dir,role+'-parsed.json'),result.value);save(join(dir,role+'-receipt.json'),receipt);save(join(dir,role+'-reuse.json'),reuse);
 const file=join(dir,role+'-attempts.json'),attempts=existsSync(file)?read(file):[];attempts.push({index:attempts.length+1,role,status:'passed',startedAt,endedAt:Date.now(),durationMs:Date.now()-startedAt,reused:true,source:reuse});save(file,attempts);return {...result,receipt,reuse};
}
export function reuseSummary(dir:string,jobId:string){
 const items:any[]=[];const walk=(path:string,depth=0)=>{if(depth>7)return;for(const f of readdirSync(path,{withFileTypes:true})){const file=join(path,f.name);if(f.isDirectory()&&f.name!=='project'&&f.name!=='runtime'&&f.name!=='attempts')walk(file,depth+1);else if(f.isFile()&&(f.name.endsWith('-reuse.json')||f.name==='checkpoint.json')){try{const row=read(file),source=f.name==='checkpoint.json'?row.reusedFrom:row;if(source&&(source.jobId||source.sourceJobId))items.push({file,sourceJobId:source.jobId??source.sourceJobId});}catch{}}}};
 if(existsSync(dir))walk(dir);return {hits:items.length,crossJobHits:items.filter(i=>i.sourceJobId!==jobId).length,items};
}
