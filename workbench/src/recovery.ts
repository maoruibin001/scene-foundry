import {hasSavedRefinement} from './geometry/refinement-recovery';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {checkpoints,CheckpointStore,type Registration} from './geometry/checkpoints';
import {runDir} from './store';
export const activeJob=(j:any)=>['running','queued'].includes(j.status);
export function recoveryRegistration(job:any,dir=runDir(job.id)):Registration{return {job,planFile:join(dir,'plan.json'),generationDir:join(dir,'generation'),textureFile:join(dir,'materials/texture-registry.json'),skipInvalidAssets:true,provenance:{kind:'manual-recovery',pipelineVersion:job.pipelineVersion,parentCheckpoint:job.reuseCheckpoint??null}};}
/** Read-only inspection. It never registers data, starts a model or modifies the source job. */
export function recoveryInfo(job:any,all:any[],store:CheckpointStore=checkpoints,dir=runDir(job.id)){
 const followup=all.find(j=>j.recoverySourceJobId===job.id&&activeJob(j));
 if(followup)return {available:false,mode:'active',continuationId:followup.id,reason:'已有恢复任务正在执行'};
 if(activeJob(job)||job.status==='passed'||job.nativeCase)return {available:false,mode:'none',reason:activeJob(job)?'任务正在执行':'此记录不需要恢复'};
 if(job.runtime&&job.plan&&job.structure&&['judge','spec','gate'].includes(job.stage))return {available:true,mode:'assessment',reason:'完整场景和运行证据已保存，只需继续验收'};
 if(job.sceneProgram)return {available:true,mode:'scene',reason:'完整场景已保存；继续构建、运行和验收，不重复生成或修正调用'};
 if(hasSavedRefinement(job,dir))return {available:true,mode:'refinement-output',reason:'已有完整模型修改输出；先按当前契约重新校验，再构建、运行和评分。校验失败即停止，不重复生成修改'};
 if(job.refineScene)return {available:true,mode:'refinement',reason:'保留原始场景与验收反馈，重新执行未完成的修正步骤'};
 let scan:any=null,scanError:string|null=null;try{scan=store.inspect(recoveryRegistration(job,dir));}catch(error){scanError=String(error);}
 const saved=store.matching(job)[0],count=scan?.content.assets.length??-1,useLocal=!!scan&&count>=(saved?.completed??-1);
 const completed=useLocal?count:saved?.completed,total=useLocal?scan.content.total:saved?.total;
 if(total===undefined&&job.plan&&existsSync(join(dir,'plan-response.txt'))&&(['scene-observation-','scene-observation-invalid-'].some(prefix=>existsSync(join(dir,'generation',prefix+'response.txt'))&&existsSync(join(dir,'generation',prefix+'receipt.json')))))return {available:true,mode:'observation',completed:0,total:0,reason:'保留已完成需求和观察输出；重新校验图片编号与证据后从空间规划继续，不重复观察调用'};
 if(total===undefined&&job.plan&&existsSync(join(dir,'plan-response.txt')))return {available:true,mode:'plan',completed:0,total:0,reason:'复用已完成需求，从未完成的图片观察或空间步骤继续，不重复需求调用'};
 if(total===undefined)return {available:true,mode:'restart',completed:0,total:0,reason:'还没有可复用的完整布局；保留原始输入，重新开始生成',scanError};
 return {available:true,mode:'generation',source:useLocal?'local':'checkpoint',checkpointId:useLocal?null:saved?.id,completed:completed??0,total:total??0,missing:total===undefined?null:total-completed,issues:scan?.issues??[],reason:total===undefined?(scanError??'没有完整布局或可恢复检查点'):useLocal?'已检查磁盘中的完整资产':'使用已验证检查点',scanError};
}
export function registerRecovery(job:any,info:any,store:CheckpointStore=checkpoints,dir=runDir(job.id)){
 if(!info.available||info.mode!=='generation')throw Error(info.reason??'没有可恢复资产');
 const id=info.source==='local'?store.register(recoveryRegistration(job,dir)).id:info.checkpointId;
 store.load(id,job);return id as string;
}
/** Serialize requests per source record, including catalog validation and actual dispatch. */
export class RecoveryRequests{
 private pending=new Map<string,Promise<any>>();
 run<T>(id:string,action:()=>Promise<T>):Promise<T>{const existing=this.pending.get(id);if(existing)return existing;const result=Promise.resolve().then(action);this.pending.set(id,result);void result.finally(()=>{if(this.pending.get(id)===result)this.pending.delete(id);}).catch(()=>{});return result;}
}
export const recoveryRequests=new RecoveryRequests();
export async function dispatchRecovery(id:string,deps:{getJob:(id:string)=>any;listJobs:()=>any[];isExecuting:(id:string)=>boolean;resolveSettings:(job:any)=>Promise<any>;inspect?:(job:any,all:any[])=>any;register?:(job:any,info:any)=>string;create:(job:any,info:any,settings:any,checkpointId:string|null)=>any}){
 return recoveryRequests.run(id,async()=>{const inspect=deps.inspect??recoveryInfo;let source=deps.getJob(id),info=inspect(source,deps.listJobs());
  if(info.continuationId)return deps.getJob(info.continuationId);
  if(deps.isExecuting(id)||!info.available)throw Error(info.reason??'任务仍在停止执行');
  const settings=await deps.resolveSettings(source);source=deps.getJob(id);info=inspect(source,deps.listJobs());
  if(info.continuationId)return deps.getJob(info.continuationId);
  if(deps.isExecuting(id)||!info.available)throw Error('任务状态已变化，请刷新');
  const cp=info.mode==='generation'?(deps.register??registerRecovery)(source,info):null;
  return deps.create(source,info,settings,cp);
 });
}
