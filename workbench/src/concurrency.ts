import {existsSync,readFileSync,writeFileSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {DATA,read,save,listJobs} from './store';

export const DEFAULT_LIMITS={scenes:3,models:8,renders:2};
export const MAX_LIMITS={scenes:8,models:16,renders:4};
export function validateLimits(value:any){
 const out={...DEFAULT_LIMITS,...value};
 for(const key of Object.keys(MAX_LIMITS))if(!Number.isInteger(out[key])||out[key]<1||out[key]>MAX_LIMITS[key])throw Error(key+' 并发上限必须为 1–'+MAX_LIMITS[key]);
 return {scenes:out.scenes,models:out.models,renders:out.renders};
}
type Waiter={id:string;resolve:(release:()=>void)=>void;reject:(error:any)=>void;signal?:AbortSignal;abort?:()=>void;at:number};
/** FIFO permits. Cancellation removes waiting work; lowering a limit only drains active work. */
export class PermitPool{
 active=new Map<string,number>();waiting:Waiter[]=[];
 constructor(public limit:number,readonly reserved:()=>number=()=>0){}
 acquire(id:string,signal?:AbortSignal):Promise<()=>void>{
  signal?.throwIfAborted();if(this.active.has(id)||this.waiting.some(w=>w.id===id))return Promise.reject(Error('重复资源申请 '+id));
  return new Promise((resolve,reject)=>{const w:Waiter={id,resolve,reject,signal,at:Date.now()};w.abort=()=>{this.waiting=this.waiting.filter(x=>x!==w);reject(signal?.reason??Error('CANCELLED'));this.drain();};signal?.addEventListener('abort',w.abort,{once:true});this.waiting.push(w);this.drain();});
 }
 drain(){while(this.waiting.length&&this.active.size+this.reserved()<this.limit){const w=this.waiting.shift()!;w.signal?.removeEventListener('abort',w.abort!);if(w.signal?.aborted){w.reject(w.signal.reason);continue;}this.active.set(w.id,Date.now());let released=false;w.resolve(()=>{if(released)return;released=true;this.active.delete(w.id);this.drain();});}}
 setLimit(limit:number){this.limit=limit;this.drain();}
 async use<T>(id:string,signal:AbortSignal|undefined,work:()=>Promise<T>){const release=await this.acquire(id,signal);try{signal?.throwIfAborted();return await work();}finally{release();}}
 snapshot(){return {limit:this.limit,active:this.active.size,reserved:this.reserved(),waiting:this.waiting.length,activeItems:[...this.active].map(([id,since])=>({id,since})),waitingItems:this.waiting.map(w=>({id:w.id,since:w.at}))};}
}
export class SceneQueue{
 active=new Set<string>();pending:{id:string;key:string;work:()=>Promise<void>}[]=[];keys=new Set<string>();paused:string|null=null;
 constructor(public limit:number,readonly external:()=>number=()=>0,readonly onError:(id:string,e:unknown)=>void=()=>{},readonly externalKeys:()=>string[]=()=>[]){}
 enqueue(id:string,key:string,work:()=>Promise<void>){if(this.active.has(id)||this.pending.some(x=>x.id===id))throw Error('任务已在调度队列');this.pending.push({id,key,work});this.drain();}
 cancel(id:string){this.pending=this.pending.filter(x=>x.id!==id);}
 drain(){if(this.paused)return;while(this.active.size+this.external()<this.limit){const i=this.pending.findIndex(x=>!this.keys.has(x.key)&&!this.externalKeys().includes(x.key));if(i<0)break;const entry=this.pending.splice(i,1)[0];this.active.add(entry.id);this.keys.add(entry.key);void Promise.resolve().then(entry.work).catch(e=>this.onError(entry.id,e)).finally(()=>{this.active.delete(entry.id);this.keys.delete(entry.key);this.drain();});}}
 setLimit(n:number){this.limit=n;this.drain();}
}
export const alive=(pid:number)=>{try{process.kill(pid,0);return true;}catch{return false;}};
export const owner={id:randomUUID(),pid:process.pid,root:import.meta.dirname,startedAt:new Date().toISOString()};
const settingsPath=join(DATA,'concurrency.json');
let limits=validateLimits(existsSync(settingsPath)?read(settingsPath):DEFAULT_LIMITS);
let legacyCache:{at:number;items:any[]}={at:0,items:[]};
export function legacyJobs(){
 if(Date.now()-legacyCache.at<500)return legacyCache.items;
 const file=join(DATA,'scheduler-handover.json'),handover=existsSync(file)?read(file):null;
 const items=handover&&alive(handover.pid)?listJobs().filter(j=>!j.executionOwner&&(!j.endedAt&&j.startedAt||j.status==='queued')&&j.pipelineVersion?.id===handover.pipelineVersionId).map(j=>({id:j.id,key:j.improvementId??j.id,status:j.startedAt?'running':j.status,modelReservation:j.executionSettings?.assetConcurrency??6,endpoint:handover.endpoint,pid:handover.pid})):[];
 legacyCache={at:Date.now(),items};return items;
}
export function ownerAlive(job:any){return job.executionOwner?alive(job.executionOwner.pid):legacyJobs().some(x=>x.id===job.id);}
export function claimCoordinator(){const path=join(DATA,'scheduler-owner.json');if(existsSync(path)){const prior=read(path);if(alive(prior.pid))throw Error('已有并行调度器运行，不能重复领取任务：'+prior.pid);unlinkSync(path);}writeFileSync(path,JSON.stringify(owner),{flag:'wx'});process.once('exit',()=>{if(existsSync(path)&&read(path).id===owner.id)unlinkSync(path);});}
const legacyActive=()=>legacyJobs().filter(j=>j.status==='running');
export const modelPool=new PermitPool(limits.models,()=>legacyActive().reduce((n,j)=>n+j.modelReservation,0));
export const renderPool=new PermitPool(limits.renders,()=>legacyActive().length?1:0);
export const sceneQueue=new SceneQueue(limits.scenes,()=>legacyJobs().length,(id,e)=>console.error('SCENE_SCHEDULER_ERROR',id,String(e)),()=>legacyJobs().map(j=>j.key));
const circuitPath=join(DATA,'scheduler-pause.json');
if(existsSync(circuitPath))sceneQueue.paused=read(circuitPath).reason;
export function pauseProvider(error:unknown){const s=String(error);if(!/MODEL_BUDGET_EXHAUSTED|MODEL_ROUTE_UNVERIFIED|PROVIDER_NOT_CONFIGURED|PROVIDER_HTTP_(?:401|402|403|429)|insufficient[_ ]quota|余额不足|额度耗尽|quota exceeded|usage limit/i.test(s))return;sceneQueue.paused=s;save(circuitPath,{reason:s,at:Date.now()});}
export function assertProviderOpen(){if(sceneQueue.paused)throw Error('PROVIDER_PAUSED：'+sceneQueue.paused);}
export function resumeScheduler(){sceneQueue.paused=null;if(existsSync(circuitPath))unlinkSync(circuitPath);sceneQueue.drain();}
export function updateConcurrency(value:any){limits=validateLimits(value);save(settingsPath,limits);modelPool.setLimit(limits.models);renderPool.setLimit(limits.renders);sceneQueue.setLimit(limits.scenes);return schedulerSnapshot();}
export function schedulerSnapshot(){return {limits,maxLimits:MAX_LIMITS,owner,paused:sceneQueue.paused,scenes:{limit:limits.scenes,active:[...sceneQueue.active],queued:sceneQueue.pending.map(x=>x.id),external:legacyJobs()},models:modelPool.snapshot(),renders:renderPool.snapshot()};}
export function startScheduling(){const timer=setInterval(()=>{sceneQueue.drain();modelPool.drain();renderPool.drain();},1000);timer.unref();}
