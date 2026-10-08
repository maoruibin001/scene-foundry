import {pendingIteration} from './geometry/iteration-recovery';
import {pendingIterationRepair} from './geometry/pending-repair';
import {improvement} from './improvement-governance';
import {qualityDecision,qualityFailure} from './quality-diagnosis';
import {hasSavedRefinement} from './geometry/refinement-recovery';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {checkpoints,CheckpointStore,type Registration} from './geometry/checkpoints';
import {runDir,read} from './store';
import {generationInput} from './reference-input';
import {isDeepStrictEqual} from 'node:util';
import {spatialRepairBasis} from './spatial-diagnosis';
export const activeJob=(j:any)=>['running','queued'].includes(j.status);
/** Preserve the typed spatial repair across its recorded recovery chain, never reinterpret a selection as a full layout. */
export function spatialRecoveryOptions(job:any,all:any[]){
 const seen=new Set<string>(),chain:any[]=[];let source=job;
 while(source){
  if(seen.has(source.id)||seen.size>=32)return null;seen.add(source.id);chain.push(source);
  if(source.spatialRepairSource){
   const basis=source.spatialRepairSource,diagnosis=source.spatialDiagnosis,seed=all.find(j=>j.id===basis.jobId);
   if(!seed||!diagnosis||!['graybox-space-repair-v2','graybox-space-repair-v3'].includes(diagnosis.contract)||diagnosis.sourceJobId!==basis.jobId||diagnosis.sourceRound!==basis.round||typeof diagnosis.reason!=='string'||diagnosis.reason.length<40||!/^[a-f0-9]{64}$/.test(diagnosis.revisionId??''))throw Error('局部空间恢复缺少匹配的来源与诊断');
   spatialRepairBasis(seed,basis.round);
   for(const record of [...chain,seed]){
    if(!isDeepStrictEqual(generationInput(job),generationInput(record))||!isDeepStrictEqual(job.policy,record.policy)||!isDeepStrictEqual(job.modelSettings,record.modelSettings)||(job.executionRecoveryRoot??job.id)!==(record.executionRecoveryRoot??record.id)||job.improvementId!==record.improvementId)throw Error('局部空间恢复不能跨输入、政策、模型或执行根');
    for(const key of ['engineSha','provider','model','judgeModel','executionRoute','assessmentProtocolSha256'])if(!isDeepStrictEqual(job.profile?.[key],record.profile?.[key]))throw Error('局部空间恢复的引擎、模型路由或评审协议不同');
   }
   return {spatialRepairSource:structuredClone(basis),spatialDiagnosis:structuredClone(diagnosis),reusePlanFrom:basis.jobId,executionRecoveryRoot:source.executionRecoveryRoot??source.id};
  }
  if(!source.recoverySourceJobId)return null;
  source=all.find(j=>j.id===source.recoverySourceJobId);
 }
 return null;
}
/** An interrupted continuation may not yet have copied the scene into its own run. */
export function continuationSceneSource(job:any,all:any[],directoryOf=runDir){
 if(!job.reuseSceneFrom||job.refineScene||job.partialOutput||!job.executionRecoveryRoot)return null;
 const source=all.find(j=>j.id===job.reuseSceneFrom);
 if(!source||activeJob(source)||source.partialOutput||source.sceneProgram?.file!=='generated-scene.json'||(source.executionRecoveryRoot??source.id)!==job.executionRecoveryRoot)return null;
 const seen=new Set<string>();let parent=job.recoverySourceJobId;
 while(parent&&parent!==source.id&&!seen.has(parent)){seen.add(parent);parent=all.find(j=>j.id===parent)?.recoverySourceJobId;}
 if(parent!==source.id)return null;
 if(!isDeepStrictEqual(generationInput(job),generationInput(source))||!isDeepStrictEqual(job.policy,source.policy))return null;
 for(const key of ['engineSha','generatorSha','provider','model','judgeModel','executionRoute'])if(!isDeepStrictEqual(job.profile?.[key],source.profile?.[key]))return null;
 try{const dir=directoryOf(source.id),scene=read(join(dir,'generated-scene.json')),plan=read(join(dir,'plan.json'));
  if(!scene.program?.templates?.length||!scene.program?.instances?.length||!scene.cameras?.length||!isDeepStrictEqual(plan,source.plan)||(job.plan&&!isDeepStrictEqual(job.plan,plan)))return null;
 }catch{return null;}
 return source.id;
}
export function recoveryRegistration(job:any,dir=runDir(job.id)):Registration{return {job,planFile:join(dir,'plan.json'),generationDir:join(dir,'generation'),textureFile:join(dir,'materials/texture-registry.json'),skipInvalidAssets:true,provenance:{kind:'manual-recovery',pipelineVersion:job.pipelineVersion,parentCheckpoint:job.reuseCheckpoint??null}};}
/** Read-only inspection. It never registers data, starts a model or modifies the source job. */
export function recoveryInfo(job:any,all:any[],store:CheckpointStore=checkpoints,dir=runDir(job.id),directoryOf=runDir){
 const followup=all.find(j=>j.recoverySourceJobId===job.id&&activeJob(j));
 if(followup)return {available:false,mode:'active',continuationId:followup.id,reason:'已有恢复任务正在执行'};
 if(activeJob(job)||job.status==='passed'||job.nativeCase)return {available:false,mode:'none',reason:activeJob(job)?'任务正在执行':'此记录不需要恢复'};
 if(pendingIteration(job,dir))return {available:true,mode:'iteration-output',reason:'自动修正已完成并保存，但后续执行中断；复用原修改构建和评分，不重做模型生成'};
 if(pendingIterationRepair(job,dir))return {available:true,mode:'repair-attempt',reason:'自动修正已有完整规划但执行中断；沿用本轮目标及已保存工具结果，从未完成的修改继续，不重做原场景或原评分'};
 if(job.reuseRefinementOutput?.kind==='iteration'&&!job.sceneProgram)return {available:true,mode:'refinement-output',reason:'继续同一份已保存自动修正，不重新生成'};
 if(job.improvementId&&qualityFailure(job)&&existsSync(improvement.path(job.improvementId))){const decision=qualityDecision(improvement.get(job.improvementId));if(decision.action==='diagnose')return {available:false,mode:'diagnosis',reason:decision.reason+'；先查看原因分析与优化方案，不能原样续跑'};}
 if(['input','plan','observe','space','graybox'].includes(job.stage)&&!job.sceneProgram){try{if(spatialRecoveryOptions(job,all))return {available:true,mode:'spatial-repair',reason:'保留同一灰模来源、局部修正诊断和累计记录；只继续未完成的局部补丁，不把候选摘要当完整空间规划'};}catch(error){return {available:false,mode:'invalid-spatial-continuation',reason:String(error)};}}
 if(job.runtime&&job.plan&&job.structure&&((!job.partialOutput&&['judge','spec','gate','complete'].includes(job.stage))||(job.partialOutput&&!job.quality)))return {available:true,mode:'assessment',reason:job.partialOutput?'已有真实草稿未完成评分，优先补齐评分；不重新生成资产':'完整场景和运行证据已保存，只需继续验收'};
 if(job.sceneProgram&&!job.partialOutput)return {available:true,mode:'scene',reason:'完整场景已保存；继续构建、运行和验收，不重复生成或修正调用'};
 if(job.reuseSceneFrom&&!job.refineScene&&!job.partialOutput){const sceneSourceJobId=continuationSceneSource(job,all,directoryOf);return sceneSourceJobId?{available:true,mode:'scene',sceneSourceJobId,reason:'同一恢复链的完整场景仍已保存；沿用原场景继续运行和评分，不重新制作'}:{available:false,mode:'invalid-continuation',reason:'上一次续接的场景来源尚不能核验；保留现有产物，不能自动退回从头生成'};}
 if(hasSavedRefinement(job,dir))return {available:true,mode:'refinement-output',reason:'已有完整模型修改输出；先按当前契约重新校验，再构建、运行和评分。校验失败即停止，不重复生成修改'};
 if(job.refineScene)return {available:true,mode:'refinement',reason:'保留原始场景与验收反馈；若有已验证候选，恢复目标、预览与累计额度，只继续未完成步骤'};
 let scan:any=null,scanError:string|null=null;try{scan=store.inspect(recoveryRegistration(job,dir));}catch(error){scanError=String(error);}
 const saved=store.matching(job)[0],count=scan?.content.assets.length??-1,useLocal=!!scan&&count>=(saved?.completed??-1);
 const completed=useLocal?count:saved?.completed,total=useLocal?scan.content.total:saved?.total;
 if(total===undefined&&job.plan&&existsSync(join(dir,'plan-response.txt'))&&((existsSync(join(dir,'generation','reference-observations.json'))&&existsSync(join(dir,'generation','observation-reuse.json')))||['scene-observation-','scene-observation-invalid-'].some(prefix=>existsSync(join(dir,'generation',prefix+'response.txt'))&&existsSync(join(dir,'generation',prefix+'receipt.json')))))return {available:true,mode:'observation',completed:0,total:0,reason:'复用已完成需求、观察和有效空间规划；只恢复未完成步骤，已有输出先校验再使用'};
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
