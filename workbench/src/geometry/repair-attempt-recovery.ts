import {existsSync,mkdirSync,copyFileSync,readFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {read,save,runDir,digest} from '../store';
import {stable} from '../validated-cache';
import {comparableAssessment} from './refinement-baseline';
import {pendingIterationRepair} from './pending-repair';
/** Reuse a failed worker's real previews, not its incomplete final response. */
export function restoreRepairAttempt(job:any,sourceJobId:string,source:any,plan:any,refs:string[],targetFolder:string,locate=runDir){
 if(!job.recoverySourceJobId)return null;
 const priorDir=locate(job.recoverySourceJobId),prior=read(join(priorDir,'job.json')),iteration=pendingIterationRepair(prior,priorDir),folder=iteration?.folder??[join(priorDir,'refinement'),join(priorDir,'generation/refinement')].find(f=>existsSync(join(f,'repair-batches.json')));
 if((!prior.refineScene&&!iteration)||!folder)return null;
 if(['running','queued','passed'].includes(prior.status))throw Error('只能恢复已经结束的未完成修复');
 const meta=read(join(folder,'source.json')),batches=read(join(folder,'repair-batches.json')).batches;
 const same=(a:any,b:any)=>stable(a)===stable(b);
 if(meta.sourceJobId!==sourceJobId||(iteration?prior.id!==sourceJobId:prior.reuseSceneFrom!==sourceJobId||meta.sourceIteration!=null)||!same(meta.referenceSha256,refs)||!same(read(join(priorDir,'plan.json')),plan)||!same(prior.policy,job.policy)||!same(prior.modelSettings,job.modelSettings)||!comparableAssessment(prior,job))throw Error('恢复工具预览的输入、来源或评估契约不一致');
 if(iteration){
  const goals=read(join(folder,'repair-goals.json')),parsed=read(join(folder,'scene-repair-plan-parsed.json')),receipt=read(join(folder,'scene-repair-plan-receipt.json'));
  if((prior.executionRecoveryRoot??prior.id)!==(job.executionRecoveryRoot??job.id)||meta.sourceDigest!==digest(JSON.stringify(source))||!same(Object.fromEntries(Object.keys(parsed).map(k=>[k,goals[k]])),parsed)||!same(goals.modelReceipt,receipt)||receipt.requestedModel!==job.modelSettings?.model)throw Error('恢复规划的场景、执行根或模型证据不一致');
 }
 if(!Array.isArray(batches)||!batches.length||batches.some((b:any)=>!/^batch-[1-3]$/.test(b.id)))throw Error('恢复批次清单无效');
 const manifests=batches.map((batch:any)=>{
  const dir=join(folder,batch.id,'feedback'),file=join(dir,'tool-audit.json');
  if(!existsSync(file))return iteration?{batch,dir,files:[]}:null;
  const audit=read(file);
  if(audit.sourceSha256!==digest(stable(source)))throw Error('工具预览来源场景摘要不一致');
  const rows=audit.attempts.filter((r:any)=>r.name==='render_scene_patch'&&r.status==='passed');
  if(!rows.length&&!iteration)return null;
  const files=['tool-audit.json'];
  for(const row of audit.attempts){
   if(!Number.isInteger(row.index)||row.index<1)throw Error('工具记录编号无效');
   for(const name of ['patch.json','scene.json'])if(existsSync(join(dir,String(row.index),name)))files.push(row.index+'/'+name);
  }
  for(const r of rows){
   if(!Number.isInteger(r.index)||r.index<1)throw Error('工具预览编号无效');
   const receipt=read(join(dir,String(r.index),'engine-preview-receipt.json'));
   for(const f of ['patch.json','scene.json','engine-preview-receipt.json'])files.push(r.index+'/'+f);
   for(const frame of receipt.frames){if(!/^[a-zA-Z0-9_-]+\.png$/.test(frame.file))throw Error('截图路径无效');files.push(r.index+'/capture/'+frame.file);}
  }
  return {batch,dir,files:[...new Set(files)]};
 });
 if(manifests.some(m=>m===null))return null;
 const copied:any[]=[];
 for(const m of manifests){for(const file of m!.files){
  const from=join(m!.dir,file),to=join(targetFolder,m!.batch.id,'feedback',file);mkdirSync(dirname(to),{recursive:true});copyFileSync(from,to);copied.push({path:m!.batch.id+'/feedback/'+file,sha256:digest(readFileSync(from))});
 }}
 const goals=read(join(folder,'repair-goals.json'));
 const recovery={sourceJobId:prior.id,sourceVersion:prior.pipelineVersion,files:copied,quality:'not-assessed',reason:iteration?'恢复同一自动修正的完整规划与工具记录；仅继续未完成步骤，保留累计工具额度，最后仍须独立验收。':'恢复已保存并实际预览的候选、修复目标和累计工具额度；模型只需选择候选，仍须重新校验及独立评分。'};
 mkdirSync(targetFolder,{recursive:true});save(join(targetFolder,'tool-recovery.json'),recovery);
 return {goals,batches,recovery};
}
