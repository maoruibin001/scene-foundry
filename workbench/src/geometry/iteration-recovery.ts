import {existsSync,readFileSync,mkdirSync,copyFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {read,save,runDir,digest,event} from '../store';
import {stable} from '../validated-cache';
import {generationInput} from '../reference-input';
import {applyRefinement} from './refinement';
import {assertPlannedRepair,validateRepairGoals} from './repair-goals';
import {repairBudget} from './repair-budget';
import {comparableAssessment} from './refinement-baseline';
import {compileGeometryProgram} from './program';
import {assertCameraPreflight} from './camera-preflight';
import {resolveTextureReuse} from './texture-library';

export type SavedIteration={kind:'iteration';sourceJobId:string;iteration:number;sourceIteration:number;hashes:Record<string,string>};
const same=(a:any,b:any)=>stable(a)===stable(b);
const check=(ok:unknown,message:string)=>{if(!ok)throw Error('已保存自动修正恢复：'+message)};
const folder=(index:number)=>'generation/iteration-'+index+'/refinement';
const metadata=['source.json','patch.json','scene.json','receipt.json','repair-batches.json','repair-goals.json','repair-goals-result.json','camera-preflight.json'];
/** A saved final scene is distinct from a paid call still in progress or a preview candidate. */
export function pendingIteration(job:any,dir=runDir(job.id)){
 if(['running','queued','passed','cancelled'].includes(job.status)||job.visualIterations?.status!=='interrupted'||!Number.isSafeInteger(job.iteration))return null;
 const index=job.iteration+1,prefix=folder(index);
 if(existsSync(join(dir,'iterations',String(index),'candidate.json'))||!metadata.every(f=>existsSync(join(dir,prefix,f))))return null;
 try{const meta=read(join(dir,prefix,'source.json')),receipt=read(join(dir,prefix,'receipt.json'));
  return meta.sourceJobId===job.id&&Number.isSafeInteger(meta.sourceIteration)&&meta.sourceIteration>=0&&meta.sourceIteration<index&&same([receipt.sourceJobId,receipt.sourceIteration,receipt.sourceDigest],[job.id,meta.sourceIteration,meta.sourceDigest])?{index,sourceIteration:meta.sourceIteration}:null;
 }catch{return null;}
}
function filesFor(dir:string,index:number,sourceIteration:number){
 const prefix=folder(index),base='iterations/'+sourceIteration,files=['job.json','plan.json',base+'/candidate.json',base+'/generated-scene.json',base+'/runtime/runtime.json',...metadata.map(f=>prefix+'/'+f)];
 const meta=read(join(dir,prefix,'source.json')),batches=read(join(dir,prefix,'repair-batches.json')).batches;
 check(Array.isArray(meta.frameNames)&&meta.frameNames.length>0&&meta.frameNames.every((f:any)=>/^[\w-]+\.png$/.test(f)),'原机位清单无效');
 files.push(...meta.frameNames.map((f:string)=>base+'/runtime/'+f));
 check(Array.isArray(batches)&&batches.length>0&&batches.length<=3&&new Set(batches.map((b:any)=>b.id)).size===batches.length,'批次清单无效');
 for(const batch of batches){
  check(/^batch-[1-3]$/.test(batch.id),'批次路径无效');const path=prefix+'/'+batch.id;
  files.push(...['parsed.json','response.txt','receipt.json','execution.json','input-receipt.json'].map(f=>path+'/scene-refine-'+f));
  const raw=JSON.parse(readFileSync(join(dir,path,'scene-refine-response.txt'),'utf8'));
  if(raw.selectedPatchSha256){
   check(/^[a-f0-9]{64}$/.test(raw.selectedPatchSha256),'选择摘要无效');
   const audit=read(join(dir,path,'feedback/tool-audit.json')),selected=audit.attempts.findLast((a:any)=>a.name==='render_scene_patch'&&a.status==='passed'&&a.patchSha256===raw.selectedPatchSha256);
   check(selected&&Number.isSafeInteger(selected.index)&&selected.index>0,'选择项没有成功的真实预览');
   const preview=path+'/feedback/'+selected.index,receipt=read(join(dir,preview,'engine-preview-receipt.json'));
   files.push(path+'/feedback/tool-audit.json',preview+'/patch.json',preview+'/scene.json',preview+'/engine-preview-receipt.json');
   check(Array.isArray(receipt.frames)&&receipt.frames.length>0&&receipt.frames.every((f:any)=>/^[\w-]+\.png$/.test(f.file)),'预览机位路径无效');
   files.push(...receipt.frames.map((f:any)=>preview+'/capture/'+f.file));
  }
 }
 return [...new Set(files)];
}
export function freezeIteration(job:any,dir=runDir(job.id)):SavedIteration{
 const pending=pendingIteration(job,dir);check(pending,'没有完整的自动修正输出');
 const files=filesFor(dir,pending!.index,pending!.sourceIteration);
 return {kind:'iteration',sourceJobId:job.id,iteration:pending!.index,sourceIteration:pending!.sourceIteration,hashes:Object.fromEntries(files.map(f=>[f,digest(readFileSync(join(dir,f)))]))};
}
export function validateIteration(snapshot:SavedIteration,target:any,plan:any,images:{path:string;mime:string}[],locate=runDir){
 check(snapshot.kind==='iteration'&&Number.isSafeInteger(snapshot.iteration)&&snapshot.iteration>0&&Number.isSafeInteger(snapshot.sourceIteration)&&snapshot.sourceIteration>=0,'快照身份无效');
 const dir=locate(snapshot.sourceJobId),expected=filesFor(dir,snapshot.iteration,snapshot.sourceIteration);
 check(same(Object.keys(snapshot.hashes).sort(),expected.sort()),'快照文件清单不一致');
 for(const file of expected)check(digest(readFileSync(join(dir,file)))===snapshot.hashes[file],'原始文件发生变化：'+file);
 const prior=read(join(dir,'job.json')),p=pendingIteration(prior,dir),prefix=folder(snapshot.iteration),base=join(dir,'iterations',String(snapshot.sourceIteration));
 check(p?.index===snapshot.iteration&&p?.sourceIteration===snapshot.sourceIteration&&prior.id===snapshot.sourceJobId,'来源轮次已改变或仍在运行');
 check(target.reuseSceneFrom===prior.id&&target.executionRecoveryRoot===(prior.executionRecoveryRoot??prior.id),'不是同一执行恢复根');
 check(same(generationInput(prior),generationInput(target))&&same(prior.policy,target.policy)&&same(prior.modelSettings,target.modelSettings)&&comparableAssessment(prior,target),'输入、模型或评审契约发生变化');
 check(prior.profile.engineSha===target.profile.engineSha&&prior.profile.generatorSha===target.profile.generatorSha&&same(read(join(dir,'plan.json')),plan),'固定引擎或需求发生变化');
 const original=read(join(base,'generated-scene.json')),meta=read(join(dir,prefix,'source.json')),receipt=read(join(dir,prefix,'receipt.json')),patch=read(join(dir,prefix,'patch.json')),saved=read(join(dir,prefix,'scene.json'));
 const candidate=read(join(base,'candidate.json'));check(candidate.jobId===prior.id&&candidate.cycle.index===snapshot.sourceIteration&&candidate.pipelineVersionId===prior.pipelineVersion.id,'原始轮次身份不符');
 check(digest(JSON.stringify(original))===meta.sourceDigest&&receipt.sourceDigest===meta.sourceDigest,'原始场景摘要不符');
 const refs=images.map(i=>digest(readFileSync(i.path)));check(same(refs,meta.referenceSha256)&&same(refs,(target.images??[]).map((i:any)=>i.id)),'参考图发生变化');
 const runtime=read(join(base,'runtime/runtime.json')),frameHashes=meta.frameNames.map((name:string)=>{const hash=digest(readFileSync(join(base,'runtime',name)));check(hash===runtime.hashes[runtime.images.indexOf(name)],'来源画面摘要不符');return hash;});
 const batches=read(join(dir,prefix,'repair-batches.json')).batches;check(patch.version==='scene-refinement-batches-v1'&&patch.batches.length===batches.length,'合并补丁与完成批次数量不符');
 for(const [i,batch] of batches.entries()){
  const path=join(dir,prefix,batch.id),parsed=read(join(path,'scene-refine-parsed.json')),raw=JSON.parse(readFileSync(join(path,'scene-refine-response.txt'),'utf8')),trace=read(join(path,'scene-refine-execution.json')),r=read(join(path,'scene-refine-receipt.json')),input=read(join(path,'scene-refine-input-receipt.json'));
  check(trace.status==='completed'&&trace.exitCode===0&&trace.endedAt&&r.stopReason==='completed'&&r.role==='scene-refine','修改调用未完整结束');
  check(r.requestedModel===target.modelSettings.model&&r.requestedReasoning===input.requestedReasoning&&same(r.executionRoute,target.profile.executionRoute),'修改调用模型或路由不符');
  check(same(input.images.slice(0,refs.length+frameHashes.length).map((x:any)=>x.sha256),[...refs,...frameHashes]),'模型所见参考图或来源画面不符');
  check(same(parsed,patch.batches[i]),'最终合并补丁不是模型完成结果');
  if(raw.selectedPatchSha256){
   check(digest(stable(parsed))===raw.selectedPatchSha256,'选择摘要与实际修改不符');
   const audit=read(join(path,'feedback/tool-audit.json')),entry=audit.attempts.findLast((x:any)=>x.name==='render_scene_patch'&&x.status==='passed'&&x.patchSha256===raw.selectedPatchSha256),preview=join(path,'feedback',String(entry.index)),proof=read(join(preview,'engine-preview-receipt.json'));
   check(audit.sourceSha256===digest(stable(original))&&same(read(join(preview,'patch.json')),parsed),'预览来源或修改数据不符');
   for(const frame of proof.frames)check(digest(readFileSync(join(preview,'capture',frame.file)))===frame.sha256,'成功预览图片损坏');
  }else check(same(raw,parsed),'原始响应与解析修改不符');
 }
 check(same(meta.repairBudget,repairBudget(target.complexity)),'原编辑预算不符');
 const goals=validateRepairGoals(read(join(dir,prefix,'repair-goals.json')),original,plan,refs.length,meta.frameNames,meta.repairBudget),next=applyRefinement(original,patch,plan,refs.length,target.complexity);
 assertPlannedRepair(original,next,goals);resolveTextureReuse(next,refs);
 check(same(next,saved)&&digest(JSON.stringify(saved))===receipt.sceneDigest,'最终场景不是原补丁生成的完整结果');
 const geometry=compileGeometryProgram({...next.program,materials:next.program.materials.map((m:any)=>({...m,textureId:null,surfaceDetail:null}))});assertCameraPreflight(next,geometry);
 return {dir,next,prior,meta,receipt,goals};
}
export function restoreIterationOutput(snapshot:SavedIteration,job:any,plan:any,images:{path:string;mime:string}[],generationDir:string,signal:AbortSignal){
 signal.throwIfAborted();const result=validateIteration(snapshot,job,plan,images),out=join(generationDir,'refinement');mkdirSync(out,{recursive:true});
 for(const file of Object.keys(snapshot.hashes)){const dest=join(out,'recovered-source',file);mkdirSync(dirname(dest),{recursive:true});copyFileSync(join(result.dir,file),dest);}
 const recovery={...snapshot,modelCalls:0,quality:'not-assessed',sourceVersion:result.prior.pipelineVersion};
 save(join(out,'output-recovery.json'),recovery);save(join(out,'scene.json'),result.next);save(join(out,'receipt.json'),result.receipt);
 job.refinementOutputRecovery=recovery;job.repairGoals={...result.goals,artifactPath:'generation/refinement/recovered-source/'+folder(snapshot.iteration)+'/repair-goals.json'};
 event(job,'refinement-output-recovered','已核验并复用自动修正阶段保存的完整结果，零次重新生成；继续构建、实际运行与独立评分，原首稿及失败记录保留');
 return result.next;
}
