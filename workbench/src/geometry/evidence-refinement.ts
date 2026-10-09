import {sourceSceneFile} from './source-scene';
import {referenceComposition,COMPOSITION_PROMPT} from './reference-composition';
import {sceneVisibility} from './visibility';
import {repairPartContext} from './repair-part-context';
import {bindReferenceFrames} from './reference-framing';
import {renderRepairPreview} from './repair-engine-preview';
import {compactSurfaceAudit,supportDiagnostics} from './repair-diagnostics';
import {repairHistory} from './repair-history';
import {referenceProjection} from './reference-projection';
import {surfaceAudit} from './surface-audit';
import {correctedOpeningSource,OPENING_REFINEMENT_PROMPT} from './opening-refinement';
import {join} from 'node:path';
import {mkdirSync,readFileSync,existsSync} from 'node:fs';
import {optimizationState} from '../optimization-rounds';
import {improvement} from '../improvement-governance';
import {read,save,digest,runDir,event} from '../store';
import {callValidated} from '../contracts';
import {scoringGuidance} from '../quality';
import {refinementBaseline} from './refinement-baseline';
import {applyRefinement,REFINEMENT_PROMPT} from './refinement';
import {createRepairTools,REPAIR_TOOL_PROMPT} from './repair-tools';
import {repairTextureEvidence,repairReusableTextureEvidence} from './repair-texture-evidence';
import {repairBudget,repairGeometryBudget} from './repair-budget';
import {resolveTextureReuse} from './texture-library';
import {assertCameraPreflight} from './camera-preflight';
import {stable} from '../validated-cache';
export function editableSceneContext(source:any){
 const copy=structuredClone(source);copy.assumptions=copy.assumptions.slice(-8);
 for(const t of copy.program.templates)t.parts=t.parts.map((p:any)=>repairPartContext(p));
 return copy;
}
/** 同一个具备看图与实际预览能力的模型完成诊断、目标选择及关联修改。 */
export async function refineWithEvidence(job:any,plan:any,images:any[],dir:string,signal:AbortSignal){
 const sourceDir=runDir(job.reuseSceneFrom),sourceJob=read(join(sourceDir,'job.json'));
 const originalSource=read(sourceSceneFile(job,sourceDir)),sourceDigest=digest(JSON.stringify(originalSource)),source=bindReferenceFrames(originalSource,images),runtime=read(join(sourceDir,'runtime/runtime.json')),textures=read(join(sourceDir,'materials/texture-registry.json'));
 const refs=images.map(i=>digest(readFileSync(i.path))),frames=runtime.images.filter((f:string)=>/^reference-/.test(f));
 if(JSON.stringify(refs)!==JSON.stringify(job.images.map((i:any)=>i.id))||!frames.length)throw Error('参考输入或机位证据不完整');
 for(const f of frames)if(digest(readFileSync(join(sourceDir,'runtime',f)))!==runtime.hashes[runtime.images.indexOf(f)])throw Error('运行画面摘要不符');
 const folder=join(dir,'refinement');mkdirSync(folder,{recursive:true});
 const baseline=await refinementBaseline(job,sourceJob,sourceDir,folder,signal,3);
 const baselineFolder=join(folder,'framing-baseline');
 event(job,'refinement-baseline','先按原始参考图画幅采集现有场景；不消耗模型调用，历史评分和画面保持原样');
 await renderRepairPreview(source,images,refs,baselineFolder,signal);
 const baselineReceipt=read(join(baselineFolder,'engine-preview-receipt.json'));
 const currentFrames=baselineReceipt.frames.map((f:any)=>({referenceIndex:f.referenceIndex,path:join(baselineFolder,'capture',f.file),mime:'image/png',sha256:f.sha256}));
 const [used,reusable]=await Promise.all([repairTextureEvidence(source,textures,folder,signal,images),repairReusableTextureEvidence(refs,folder,signal)]);
 // 恢复任务可能只保存场景：沿同一输入的恢复链取原始观察，不能借用其他案例。
 let observation:any=null,observationJobId:string|null=null,cursor:any=sourceJob;const seen=new Set();
 while(cursor&&!seen.has(cursor.id)&&seen.size<20){seen.add(cursor.id);if(JSON.stringify(cursor.images?.map((i:any)=>i.id))!==JSON.stringify(refs))break;
  const file=join(runDir(cursor.id),'generation/reference-observations.json');if(existsSync(file)){observation=read(file);observationJobId=cursor.id;break;}
  const parent=cursor.recoverySourceJobId??cursor.reuseSceneFrom??(cursor.retryRoot!==cursor.id?cursor.retryRoot:null);cursor=parent&&existsSync(join(runDir(parent),'job.json'))?read(join(runDir(parent),'job.json')):null;
 }
 const support=supportDiagnostics(source);save(join(folder,'support-diagnostics.json'),support);save(join(folder,'surface-audit.json'),surfaceAudit(source,textures));
 const apply=(patch:any)=>applyRefinement(correctedOpeningSource(source,patch),patch,plan,images.length,job.complexity);
 const validate=(patch:any)=>{const scene=apply(patch);resolveTextureReuse(scene,refs);assertCameraPreflight(scene);return patch;};
 const feedback=createRepairTools({source,textures,observation,folder:join(folder,'feedback'),signal,images,refs,sourceFrames:currentFrames,validate,apply,onEvent:m=>event(job,'repair-feedback',m)});
 // 接续同一来源的已校验但因环境故障未完成的候选，先用真实预览核验，再交给模型。
 const priorRounds=optimizationState()?.rounds??[];
 const prior=priorRounds.filter((r:any)=>r.index<job.optimizationRound?.index&&r.sourceJobId===sourceJob.id).at(-1);
 const previousJob=prior?read(join(runDir(prior.jobId),'job.json')):null;
 if(prior&&!previousJob?.quality){const prev=join(runDir(prior.jobId),'generation/refinement'),auditFile=join(prev,'feedback/tool-audit.json');
  if(existsSync(auditFile)&&read(join(prev,'source.json')).sourceDigest===sourceDigest){
   const entry=read(auditFile).attempts.filter((r:any)=>r.name==='render_scene_patch').at(-1),patchFile=entry?join(prev,'feedback',String(entry.index),'patch.json'):null;
   if(patchFile&&existsSync(patchFile)){const patch=validate(read(patchFile));event(job,'refinement-reuse','复用上一轮未验收补丁，模型调用前先构建实际预览');
    const rendered=await feedback.kit.call('render_scene_patch',{patchJson:JSON.stringify(patch)});if(rendered.isError)throw Error('保存候选预览仍失败：'+rendered.content.filter((c:any)=>c.type==='text').map((c:any)=>c.text).join('\n'));
    save(join(folder,'candidate-reuse.json'),{sourceJobId:prior.jobId,patchSha256:digest(stable(patch)),quality:'not-assessed'});
   }
  }
 }
 const geometryBudget=repairGeometryBudget(source.program,job.complexity);
 const previousRepairs=repairHistory(job,originalSource,refs);save(join(folder,'repair-history.json'),previousRepairs);
 const priorRoundAudits=previousRepairs.attempts.map(attempt=>attempt.roundAudit);
 event(job,'repair-history','整体修正已读取 '+previousRepairs.attempts.length+' 份已核验历史；包括从当前保留候选出发但未被选优的尝试');
 const diagnosedStrategy=job.improvementId?improvement.get(job.improvementId).strategyRevisions?.at(-1)??null:null;
 const text={diagnosedStrategy,previousRepairs,priorRoundAudits,reflectionRule:'无明显提升或关键维度退步时，必须解释证据、表示能力、生成策略或评审粒度中的可验证原因，并改变对应机制。previousRepairs包含已核验但可能未被选优的修正，需结合实际改动和未解决项，不能仅调高思考深度或重试旧策略。',originalPrompt:job.prompt,requirements:plan.requirements,deliveryStandard:job.policy?.deliveryStandard??'strict',scoring:scoringGuidance(job.policy),sourceScore:baseline.quality,review:baseline.review,
  surfaceAudit:compactSurfaceAudit(source,textures),support,projection:referenceProjection(source,observation),referenceComposition:referenceComposition(source,observation,sceneVisibility(source,textures)),observationJobId,referenceFraming:{current:source.cameras.map((c:any)=>({name:c.name,frame:c.frame??{width:1600,height:900}})),historical:originalSource.cameras.map((c:any)=>({name:c.name,frame:c.frame??{width:1600,height:900}})),note:'当前附图来自修复后按原图比例重新采集的真实Engine预览；它没有重评，不替换历史得分。机位仍是原机位，构图缺陷需要结合原图修正，不能靠画幅修复宣称质量通过。'},experiment:job.optimizationRound,repairBudget:repairBudget(job.complexity),geometryBudget,
  sourceScene:editableSceneContext(source),actualFrameNames:currentFrames.map((f:any)=>f.path),textureEvidence:used.context,reusableTextures:reusable.context,
  contextRule:'所有模板、实例和材质都可按证据联动修改，无额外规划阶段冻结的局部范围。密集形状数组标注Omitted与来源哈希，需改具体几何时先用inspect_scene_parts读取；surfaceUpdates不需要顶点。原场景、图片、需求与评分不可更改。'};
 save(join(folder,'source.json'),{sourceJobId:sourceJob.id,sourceVersion:sourceJob.pipelineVersion,sourceCriteria:sourceJob.plan?.acceptanceCriteria??null,sourceDigest,referenceSha256:refs,frameNames:frames,qualityBefore:baseline.quality,originalQuality:sourceJob.quality,modelSettings:job.modelSettings,method:'evidence-led-v2',baselineProfile:job.profile,repairBudget:repairBudget(job.complexity)});
 save(join(folder,'evidence-input.json'),text);
 event(job,'refinement','合并诊断、选目标和修改：直接对照参考图与完整当前场景，在同次模型执行中通过工具看实际预览并选择候选');
 const system=REFINEMENT_PROMPT.replace('不删除或缩小sourceScene.spatialOpenings约束。','保留开口身份；推断尺寸可按本轮openingUpdates协议纠正。').replace('必须绑定到repairGoals已选materialIds或已获准新增几何的新材质。共享纹理的所有引用材质都必须在范围内，否则给已选材质建立独立声明，不改变其他表面；','必须绑定到本轮实际修改的材质。共享纹理的引用表面须一起核对，不适配时建立独立声明；')+'\n'+OPENING_REFINEMENT_PROMPT+'\n本轮采用证据驱动整体修正，不存在另一个模型预先锁定的repairGoals范围。你必须自行从画面与本轮假设选择最有价值的关联缺陷并实施可见改变；可以调整所有必要的已有模板与材质，但遵守相同最终场景预算。避免泛泛改色、缩放或堆小物体。采集、投影和预览现已沿用参考图画幅。先核对画面主结构占比、透视和垂直支承；不要把旧横图的占比照搬到竖图。surfaceAudit列出真实材质绑定和UV异常：颜色、alpha、roughness和metallic已进入Engine，不能假定未导出；结合纹理证据检查不合适的照片裁切、拉伸、透明表面后方遮挡及支承阴影。几何拼接需修改实际端点、交接面与轮廓，不能用改色掩盖缝隙。第一版先完成一个有明显视觉差异的完整候选，尽早真实预览；第二次仅纠正从预览确认的问题，不要求用完。不能把已经用过的失败策略重新包装。若本轮假设被原图否定，明确说明并选择有证据的替代改动。最终reason列明：问题归因、实际改动、预览观察及仍未解决项。如果关键需求缺少背侧或遮挡区域的观察证据，区分真实缺失和未取证；保留参考机位对齐，针对缺证据补充检查机位或调整已有检查机位，保持已覆盖区域的证据，在真实预览中核对，不再次只写暂缓。不要预测得分。\n'+REPAIR_TOOL_PROMPT;
 const result=await callValidated({role:'scene-refine',schemaContext:{repairComplexity:job.complexity},modelSettings:job.modelSettings,signal,maxTokens:16000,reservedCalls:2,images:[...images,...currentFrames,...used.images,...reusable.images],system,text:JSON.stringify(text),tools:feedback.kit},folder,v=>{validate(v);feedback.assertReviewed(v);return v;});
 const scene=apply(result.value);
 if(digest(JSON.stringify(read(sourceSceneFile(job,sourceDir))))!==sourceDigest)throw Error('来源场景在修改期间变化');
 const unchanged=source.program.templates.filter((t:any)=>stable(t)===stable(scene.program.templates.find((x:any)=>x.id===t.id))).length;
 save(join(folder,'patch.json'),result.value);save(join(folder,'scene.json'),scene);save(join(folder,'receipt.json'),{method:'evidence-led-v1',sourceJobId:sourceJob.id,sourceDigest,sceneDigest:digest(JSON.stringify(scene)),unchangedTemplates:unchanged,changedTemplates:source.program.templates.length-unchanged,modelReceipt:result.receipt,quality:'not-assessed'});
 job.visualRefinement={method:'evidence-led-v1',sourceJobId:sourceJob.id,sourceScore:baseline.quality.score,originalSourceScore:sourceJob.quality.score,unchangedTemplates:unchanged,changedTemplates:source.program.templates.length-unchanged,addedTemplates:scene.program.templates.length-source.program.templates.length};return scene;
}
