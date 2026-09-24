import {repairBudget,LEGACY_REPAIR_BUDGET} from './repair-budget';
import {existsSync,readFileSync,mkdirSync,copyFileSync} from 'node:fs';
import {join,dirname,relative} from 'node:path';
import {read,save,digest,runDir,event} from '../store';
import {parseModelJson} from '../provider';
import {applyRefinement} from './refinement';
import {validateRepairGoals,assertPlannedRepair} from './repair-goals';
import {applyOpeningObservation} from './opening-observations';
import {assertRefinementFocus} from './refinement-focus';
import {comparableAssessment} from './refinement-baseline';
import {compileGeometryProgram} from './program';
import {resolveTextureReuse} from './texture-library';

const folder='generation/refinement';
const required=['job.json','plan.json',...['source.json','repair-goals.json','scene-refine-parsed.json','scene-refine-response.txt','scene-refine-receipt.json','scene-refine-input-receipt.json','scene-refine-execution.json'].map(f=>folder+'/'+f)];
const optional=['focus.json','openings/observations.json','openings/receipt.json','baseline/baseline.json','baseline/review.json','baseline/quality.json','camera-change.json','visibility.json','visibility-context.json','visibility-receipt.json',...Array.from({length:6},(_,i)=>`visibility-${i+1}.png`)].map(f=>folder+'/'+f);
const assert=(ok:unknown,message:string)=>{if(!ok)throw Error('已保存修改恢复：'+message)};
const same=(a:any,b:any)=>JSON.stringify(a)===JSON.stringify(b);
export type SavedRefinement={sourceJobId:string;hashes:Record<string,string>};
/** 这里只说明完整输出可重验，不把存在文件当作契约通过或画面通过。 */
export function hasSavedRefinement(job:any,dir=runDir(job.id)){
 return job.refineScene===true&&job.refinementMode!=='camera-alignment'&&!!job.reuseSceneFrom&&required.every(f=>existsSync(join(dir,f)));
}
export function freezeSavedRefinement(job:any,dir=runDir(job.id)):SavedRefinement{
 assert(hasSavedRefinement(job,dir),'缺少完整修改输出或来源证据');
 return {sourceJobId:job.id,hashes:Object.fromEntries([...required,...optional.filter(f=>existsSync(join(dir,f)))].map(f=>[f,digest(readFileSync(join(dir,f)))]))};
}
export function validateSavedRefinement(snapshot:SavedRefinement,target:any,plan:any,images:{path:string;mime:string}[],locate=runDir){
 const dir=locate(snapshot.sourceJobId),paths=Object.keys(snapshot.hashes);
 assert(required.every(f=>paths.includes(f))&&paths.every(f=>[...required,...optional].includes(f)),'快照文件清单无效');
 for(const f of paths)assert(digest(readFileSync(join(dir,f)))===snapshot.hashes[f],'保存后来源文件发生变化：'+f);
 const prior=read(join(dir,'job.json')),meta=read(join(dir,folder,'source.json')),patch=read(join(dir,folder,'scene-refine-parsed.json'));
 assert(!['running','queued','passed'].includes(prior.status)&&hasSavedRefinement(prior,dir),'来源必须是已结束的未完成修正');
 assert(prior.id===snapshot.sourceJobId&&meta.sourceJobId===prior.reuseSceneFrom&&target.reuseSceneFrom===meta.sourceJobId&&meta.sourceIteration==null,'来源场景身份不一致');
 assert(same(prior.prompt,target.prompt)&&same((prior.images??[]).map((i:any)=>[i.id,i.mime]),(target.images??[]).map((i:any)=>[i.id,i.mime]))&&prior.complexity===target.complexity&&same(prior.policy,target.policy),'输入、参考图或验收标准变化');
 assert(same(prior.modelSettings,target.modelSettings)&&comparableAssessment(prior,target),'模型、评审或运行配置变化，不能继承修正基线');
 assert(prior.profile.engineSha===target.profile.engineSha&&prior.profile.generatorSha===target.profile.generatorSha,'引擎或生成器版本变化');
 assert(same(read(join(dir,'plan.json')),plan),'冻结需求变化');
 const baseDir=locate(meta.sourceJobId),original=read(join(baseDir,'generated-scene.json'));
 assert(digest(JSON.stringify(original))===meta.sourceDigest,'原始场景摘要不符');
 const refs=images.map(i=>digest(readFileSync(i.path)));assert(same(refs,meta.referenceSha256)&&same(refs,(target.images??[]).map((i:any)=>i.id)),'参考图片内容变化');
 const trace=read(join(dir,folder,'scene-refine-execution.json')),receipt=read(join(dir,folder,'scene-refine-receipt.json')),input=read(join(dir,folder,'scene-refine-input-receipt.json'));
 assert(trace.status==='completed'&&trace.exitCode===0&&trace.endedAt&&receipt.stopReason==='completed'&&receipt.role==='scene-refine','调用没有完整结束，不能恢复半份输出');
 for(const r of [receipt,input])assert(r.requestedModel===target.modelSettings.model&&r.requestedReasoning===target.modelSettings.reasoningEffort,'输出模型身份不一致');
 assert(same(parseModelJson(readFileSync(join(dir,folder,'scene-refine-response.txt'),'utf8')),patch),'解析数据与模型原始输出不一致');
 const runtime=read(join(baseDir,'runtime/runtime.json'));
 assert(Array.isArray(meta.frameNames)&&meta.frameNames.length>0&&meta.frameNames.every((n:any)=>typeof n==='string'&&/^[a-zA-Z0-9_-]+\.png$/.test(n)&&runtime.images.includes(n)),'来源运行画面不完整');
 const frames=meta.frameNames.map((n:string)=>({sha256:digest(readFileSync(join(baseDir,'runtime',n))),mime:'image/png'}));
 frames.forEach((f:any,k:number)=>assert(f.sha256===runtime.hashes[runtime.images.indexOf(meta.frameNames[k])],'来源运行画面摘要变化'));
 const diagnostics:{sha256:string;mime:string}[]=[];
 if(paths.includes(folder+'/visibility-receipt.json')){
  for(const name of ['visibility.json','visibility-context.json'])assert(paths.includes(folder+'/'+name),'可见性来源证据缺失');
  const evidence=read(join(dir,folder,'visibility-receipt.json')),context=read(join(dir,folder,'visibility-context.json'));
  assert(evidence.sourceProgramSha256===digest(JSON.stringify(original.program))&&evidence.sourceCamerasSha256===digest(JSON.stringify(original.cameras)),'可见性诊断不属于原场景');
  assert(evidence.reportSha256===snapshot.hashes[folder+'/visibility.json']&&evidence.contextSha256===digest(JSON.stringify(context))&&same(evidence.images,context.diagnosticImages),'可见性报告摘要或图片清单不一致');
  assert(Array.isArray(evidence.images)&&evidence.images.length>0&&evidence.images.length<=6,'可见性图片数量无效');
  for(const [index,item] of evidence.images.entries()){
   const file=folder+`/visibility-${index+1}.png`,at=runtime.images.indexOf(item.actualFrame);
   assert(item.file===`visibility-${index+1}.png`&&paths.includes(file)&&snapshot.hashes[file]===item.sha256,'可见性图片缺失、顺序或摘要不一致');
   assert(meta.frameNames.includes(item.actualFrame)&&at>=0&&runtime.hashes[at]===item.actualFrameSha256,'可见性图片对应的实际帧不一致');
   diagnostics.push({sha256:item.sha256,mime:'image/png'});
  }
 }
 assert(same(input.images.map((i:any)=>({sha256:i.sha256,mime:i.mime})),[...images.map((i,k)=>({sha256:refs[k],mime:i.mime})),...frames,...diagnostics]),'修改调用所见图片或顺序不一致');
 let source=original;
 if(source.spatialOpenings===undefined){
  const observation=read(join(dir,folder,'openings/observations.json')),evidence=read(join(dir,folder,'openings/receipt.json'));
  assert(paths.includes(folder+'/openings/observations.json')&&paths.includes(folder+'/openings/receipt.json')&&evidence.sourceDigest===meta.sourceDigest&&evidence.observationsDigest===digest(JSON.stringify(observation)),'历史开口观察证据缺失或变化');
  source=applyOpeningObservation(source,observation,refs.length);
 }
 const editBudget=patch.version==='scene-refinement-v3'?repairBudget(target.complexity):LEGACY_REPAIR_BUDGET;
 if(patch.version==='scene-refinement-v3')assert(same(meta.repairBudget,editBudget),'保存的编辑额度与复杂度不一致');
 const goals=validateRepairGoals(read(join(dir,folder,'repair-goals.json')),source,plan,refs.length,meta.frameNames,editBudget);
 const next=applyRefinement(source,patch,plan,refs.length,target.complexity);resolveTextureReuse(next,refs);
 const changes=assertPlannedRepair(source,next,goals);
 if(paths.includes(folder+'/focus.json'))assertRefinementFocus(source,next,read(join(dir,folder,'focus.json')));
 compileGeometryProgram({...next.program,materials:next.program.materials.map((m:any)=>({...m,textureId:null}))});
 return {dir,prior,meta,source,next,patch,goals,changes,receipt};
}
export function restoreSavedRefinement(job:any,plan:any,images:{path:string;mime:string}[],generationDir:string,signal:AbortSignal){
 signal.throwIfAborted();const snapshot=job.reuseRefinementOutput as SavedRefinement;
 const result=validateSavedRefinement(snapshot,job,plan,images),out=join(generationDir,'refinement');mkdirSync(out,{recursive:true});
 for(const f of Object.keys(snapshot.hashes)){const dest=join(out,'recovered-source',f);mkdirSync(dirname(dest),{recursive:true});copyFileSync(join(result.dir,f),dest);}
 const unchanged=result.source.program.templates.filter((t:any)=>same(t,result.next.program.templates.find((n:any)=>n.id===t.id))).length;
 save(join(out,'source.json'),result.meta);save(join(out,'patch.json'),result.patch);save(join(out,'scene.json'),result.next);save(join(out,'repair-goals.json'),result.goals);save(join(out,'repair-goals-result.json'),result.changes);
 const recovery={...snapshot,sourceVersion:result.prior.pipelineVersion,modelCalls:0,originalCallDurationMs:result.receipt.durationMs,quality:'not-assessed',scope:'重新校验已保存的完整修改，未重新选择目标或调用模型生成；需重新构建、运行及独立验收'};
 const removedInstances=(result.patch.removeInstances??[]).map((r:any)=>({instanceId:r.instanceId,reason:r.reason}));
 save(join(out,'output-recovery.json'),recovery);save(join(out,'receipt.json'),{sourceJobId:result.meta.sourceJobId,sourceDigest:result.meta.sourceDigest,sceneDigest:digest(JSON.stringify(result.next)),unchangedTemplates:unchanged,changedTemplates:result.source.program.templates.length-unchanged,addedTemplates:result.next.program.templates.length-result.source.program.templates.length,removedInstances,quality:'not-assessed',modelReceipt:result.receipt,recovery});
 job.refinementOutputRecovery=recovery;job.repairGoals={...result.goals,artifactPath:relative(runDir(job.id),join(out,'repair-goals.json'))};
 job.visualRefinement={sourceJobId:result.meta.sourceJobId,sourceScore:result.meta.qualityBefore.score,originalSourceScore:result.meta.originalQuality.score,unchangedTemplates:unchanged,changedTemplates:result.source.program.templates.length-unchanged,addedTemplates:result.next.program.templates.length-result.source.program.templates.length,removedInstances};
 if(result.prior.refinementBaseline)job.refinementBaseline=structuredClone(result.prior.refinementBaseline);
 event(job,'refinement-output-recovered','已重新校验并复用保存的完整修改，继续 Engine 构建与实际画面验收；原失败记录和原评分保留');
 return result.next;
}
