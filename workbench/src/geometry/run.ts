import {assertSpatialAccepted} from './spatial-order';
import {acceptSpatialLayout} from './blockout';
import {improvement} from '../improvement-governance';
import {restoreSavedRefinement} from './refinement-recovery';
import {inspectOpenings,openingSummary} from './openings';
import {boundedIterations} from './iteration-policy';
import {capturePlan} from './capture-plan.mjs';
import {snapshotIteration,restoreIteration} from './iteration-snapshots';
import {refineScene} from './refinement';
import {alignCameras} from './camera-alignment';
import {join} from 'node:path';
import {mkdirSync,existsSync,cpSync,readFileSync} from 'node:fs';
import {ROOT,UPLOADS,save,read,runDir,saveJob,event,digest} from '../store';
import {validateScene,semanticCounts} from './scene-contract';
import {assembleScene,validateAsset} from './layout';
import {checkpoints} from './checkpoints';
import {resolveTextureReuse} from './texture-library';
import {assetWorkers} from './asset-workers';
import {generateLayout,generateOneAsset,generationProvenance} from './generate';
import {hasBudget} from '../provider';
import {prepareGeometryProject} from './prepare';
import {COMPLEXITIES} from '../complexity';
import {executionSettings} from '../execution-settings';
import {generationPhase,finishGeneration} from '../timing';
import {assetCache,assetKey,cacheCheckpointAssets} from './asset-cache';
export function sceneComplexity(scene:any,level:keyof typeof COMPLEXITIES,parts:number){const p=COMPLEXITIES[level],entities=scene.entities.filter((e:any)=>e.role!=='ground'),kinds=[...new Set(entities.map((e:any)=>e.category))];const checks=[{id:'entityBudget',passed:entities.length>=(Array.isArray(scene.observedBindings)?1:p.minEntities)&&entities.length<=p.maxEntities,actual:entities.length,expected:[p.minEntities,p.maxEntities]},{id:'kindVariety',passed:kinds.length>=(Array.isArray(scene.observedBindings)?1:p.minKinds),actual:kinds.length,expected:p.minKinds},{id:'partBudget',passed:parts<=p.maxParts,actual:parts,expected:p.maxParts},{id:'materialBudget',passed:scene.program.materials.length<=p.maxMaterials,actual:scene.program.materials.length,expected:p.maxMaterials}];return {level,label:p.label,entityCount:entities.length,kindCount:kinds.length,kinds,partCount:parts,checks,passed:checks.every(c=>c.passed),method:'自由语义类别、实例与部件预算；丰富度和还原效果由真实画面独立评估'};}

function prepareScene(job:any,plan:any,dir:string,value:any,textures:any,provenance:any){
 const result={value};save(join(dir,'generated-scene.json'),result.value);job.sceneProgram={version:result.value.version,file:'generated-scene.json'};
  const prepared=prepareGeometryProject(join(dir,'project'),result.value.program,textures,{id:'scene-'+job.id,summary:plan.summary,scene:result.value,provenance:{pipelineVersion:job.pipelineVersion,references:(job.images??[]).map((i:any)=>i.id),textures:provenance,modelSettings:job.modelSettings}});
  job.bounds=prepared.bounds;job.objectCount=prepared.meshes;job.entityCount=result.value.program.instances.length;job.complexityReport=sceneComplexity(result.value,job.complexity,prepared.meshes);
  job.structure={passed:true,semanticCounts:semanticCounts(result.value.entities),checks:[{id:'geometry-contract',passed:true},{id:'requirement-bindings',passed:true},{id:'texture-provenance',passed:true}],geometry:{triangles:prepared.triangles,suspects:[],scope:'仅证明网格契约、来源和需求绑定；空间接触、遮挡和穿插由实际画面验收，未冒充碰撞检测'},assumptions:result.value.assumptions};
  const openingReport=inspectOpenings(result.value);job.structure.openings=openingSummary(openingReport);save(join(dir,'spatial-openings.json'),openingReport);
  const openingIssues=job.structure.openings.checks.filter((c:any)=>c.status!=='clear');if(openingIssues.length)event(job,'spatial-openings','网格诊断发现 '+openingIssues.length+' 处开口/后景疑点，将连同真实画面用于视觉修正');
  save(join(dir,'structure.json'),job.structure);save(join(dir,'complexity.json'),job.complexityReport);save(join(dir,'recipe.json'),{name:result.value.program.name,objects:prepared.objects,materials:result.value.program.materials,semanticEntities:result.value.entities});return result.value;
}
export async function runGeneralScene({job,plan,dir,signal,stage,command,preview,resetPreview,evaluate}:any){
 const images=(job.images??(job.image?[job.image]:[])).map((i:any)=>({path:join(UPLOADS,i.file),mime:i.mime}));
 job.generationMethod='general-geometry-v3';job.stageTrackingVersion='exclusive-stages-v1';job.iteration=0;
 const scene=await (async()=>{
  const validate=(value:any)=>{const s=validateScene(value,plan,images.length),parts=s.program.instances.reduce((n,i)=>n+s.program.templates.find(t=>t.id===i.template)!.parts.length,0),c=sceneComplexity(s,job.complexity,parts);if(!c.passed)throw Error('所选复杂度未满足：'+JSON.stringify(c.checks));return s;};
  const source=job.reuseSceneFrom?join(runDir(job.reuseSceneFrom),'generated-scene.json'):null;
  const progress=(phase:string,completed:number,total:number,current:string|null)=>{generationPhase(job,phase);job.generationProgress={phase,completed,total,current};event(job,'generation-progress',phase+(total?' '+completed+'/'+total:'')+(current?' · '+current:''));};
  const generationDir=join(dir,'generation'),ctx:any={job,plan,images,dir:generationDir,signal,stage,onProgress:(phase:string)=>progress(phase,0,0,null)};
  progress(source?(job.refineScene?'根据真实画面反馈修正场景':'复用完整场景'):'规划共享布局',0,0,null);
  const restored=job.reuseCheckpoint?checkpoints.restore(job.reuseCheckpoint,job,generationDir):null;
  let layout:any=null;
  try{
  ctx.acceptSpace=(space:any)=>acceptSpatialLayout(space,ctx,command,stage);
  layout=source?null:restored?.layout??await generateLayout(ctx);saveJob(job);const reused=source?validate(job.reuseRefinementOutput?restoreSavedRefinement(job,plan,images,generationDir,signal):job.refineScene?await (job.refinementMode==='camera-alignment'?alignCameras:refineScene)(job,plan,images,generationDir,signal):read(source)):null;
  if(restored){const sourceObservation=join(runDir(restored.manifest.sourceJobId),'generation/reference-observations.json');if(existsSync(sourceObservation))ctx.observation=read(sourceObservation);const checked=await ctx.acceptSpace(restored.layout);if(JSON.stringify(checked.program.instances)!==JSON.stringify(restored.layout.program.instances)||JSON.stringify(checked.cameras)!==JSON.stringify(restored.layout.cameras))throw Error('SPATIAL_GATE_FAILED：检查点布局已修改，不能继续复用旧布局资产，请从确认基准重新生成');}
  if(reused){const original=read(join(runDir(job.reuseSceneFrom),'job.json'));const prior=original.blockout?.space;if(!prior)throw Error('REFERENCE_SPATIAL_REPLAN_REQUIRED：历史候选缺少空间关系基准，请从已确认图片重新生成');await acceptSpatialLayout({...prior,program:{...prior.program,instances:reused.program.instances},cameras:reused.cameras,entities:reused.entities},{...ctx,existingScene:reused},command,stage);}
  if(layout){save(join(generationDir,'plan.json'),plan);for(const image of images)if(!(job.images??(job.image?[job.image]:[])).some((i:any)=>join(UPLOADS,i.file)===image.path&&i.id===digest(readFileSync(image.path))))throw Error('参考图片内容与检查点来源不一致');}
  assertSpatialAccepted(job,layout??reused);
  const steps=layout?.program.templates.map(t=>({id:t.id,label:t.label,status:'pending'}))??[],checkpoint=layout?{...generationProvenance(ctx,layout),steps}:null;
  if(checkpoint)save(join(generationDir,'checkpoints.json'),checkpoint);
  const materials=join(dir,'materials');mkdirSync(materials,{recursive:true});save(join(materials,'texture-request.json'),{references:images,textures:(layout??reused)!.textures,reused:resolveTextureReuse((layout??reused)!,images.map(i=>digest(readFileSync(i.path))))});
  progress('提取并记录材质来源',0,layout?.program.templates.length??0,null);
  const {textures,provenance}=await stage('materials',async()=>{await command([join(ROOT,'data/reconstruction-env/bin/python'),join(ROOT,'src/geometry/textures.py'),materials]);return {textures:read(join(materials,'texture-registry.json')),provenance:read(join(materials,'texture-provenance.json'))};});
  let value=reused;
  if(layout){
   const assets=await stage('assets',async()=>{assertSpatialAccepted(job,layout);
   const assets=restored?.assets.map((a:any)=>validateAsset(a.value,layout.program.templates.find(t=>t.id===a.id)!,layout,textures).value)??[];
   const ready=new Set(assets.map((a:any)=>a.template.id));for(const step of steps)if(ready.has(step.id))step.status='reused';
   cacheCheckpointAssets(job,plan,layout,textures,checkpoints.matching(job).slice(0,8).flatMap(c=>{try{return [checkpoints.load(c.id,job)]}catch{return []}}));
   for(const brief of layout.program.templates){if(ready.has(brief.id))continue;const cached=assetCache.get(assetKey(job,plan,layout,brief,textures),brief,layout,textures);if(!cached)continue;const folder=join(generationDir,'assets',brief.id);mkdirSync(folder,{recursive:true});save(join(folder,'geometry.json'),cached.value);save(join(folder,'checkpoint.json'),{status:'passed',...generationProvenance(ctx,layout),geometrySha256:digest(JSON.stringify(cached.value)),reusedFrom:cached.source,reusedAt:Date.now(),durationMs:0,quality:'not-assessed'});assets.push(cached.value);ready.add(brief.id);steps.find(s=>s.id===brief.id)!.status='reused';}
   const pending=layout.program.templates.filter(t=>!ready.has(t.id)),active=new Map<string,string>();let completed=assets.length;
   if(!hasBudget(pending.length+1))throw Error('MODEL_BUDGET_EXHAUSTED：缺少 '+pending.length+' 类资产，剩余预算不足以完成资产和一次评估');
   const concurrency=executionSettings(job.executionSettings).assetConcurrency,phase='生成资产（最多并发 '+concurrency+' 类）',readyAt=Date.now();
   job.generationLimits={assetConcurrency:concurrency,assetStageTimeoutMs:90*60*1000};
   const persistCheckpoint=()=>{try{const cp=checkpoints.register({job,planFile:join(dir,'plan.json'),generationDir,textureFile:join(dir,'materials/texture-registry.json'),provenance:{kind:'asset-progress',pipelineVersion:job.pipelineVersion,parentCheckpoint:job.reuseCheckpoint??null}});job.checkpointId=cp.id;saveJob(job);}catch(error){event(job,'checkpoint-error','进度文件已保存，检查点登记失败：'+String(error));}};
   save(join(generationDir,'checkpoints.json'),checkpoint);progress(phase,completed,steps.length,null);persistCheckpoint();
   const assetSignal=AbortSignal.any([signal,AbortSignal.timeout(job.generationLimits.assetStageTimeoutMs)]);
   const generated=await assetWorkers(pending,job.generationLimits.assetConcurrency,assetSignal,async(brief,_index,workerSignal)=>{
    const step=steps.find(s=>s.id===brief.id)!;step.status='running';active.set(brief.id,brief.label);save(join(generationDir,'checkpoints.json'),checkpoint);progress(phase,completed,steps.length,[...active.values()].join('、'));
    try{const asset=await generateOneAsset({...ctx,readyAt,signal:workerSignal},layout,brief,textures);step.status='passed';completed++;persistCheckpoint();return asset;}
    catch(error){step.status=workerSignal.aborted?'cancelled':'failed';throw error;}
    finally{active.delete(brief.id);save(join(generationDir,'checkpoints.json'),checkpoint);progress(phase,completed,steps.length,[...active.values()].join('、')||null);}
   });assets.push(...generated);return assets;});
   progress('组装并检查完整场景',steps.length,steps.length,null);return await stage('assembly',async()=>{assertSpatialAccepted(job,layout);value=validate(assembleScene(layout,assets,plan,images.length));return prepareScene(job,plan,dir,value!,textures,provenance);});
  }
  return await stage('assembly',async()=>{assertSpatialAccepted(job,value);return prepareScene(job,plan,dir,value!,textures,provenance);});
  }finally{finishGeneration(job,job.structure?.passed?'passed':signal.aborted?'cancelled':'failed');if(layout&&existsSync(join(dir,'materials/texture-registry.json'))){try{const cp=checkpoints.register({job,planFile:join(dir,'plan.json'),generationDir,textureFile:join(dir,'materials/texture-registry.json'),provenance:{kind:job.reuseCheckpoint?'continuation':'job',pipelineVersion:job.pipelineVersion,parentCheckpoint:job.reuseCheckpoint??null}});job.checkpointId=cp.id;event(job,'checkpoint','已保存可续跑检查点：'+cp.assets.length+'/'+cp.total+' 类资产');}catch(error){event(job,'checkpoint-error','检查点未保存：'+String(error));}}}
 })();
 const proto=join(ROOT,'../prototype/bin/pipeline.ts'),maxRepairs=Math.min(job.iterationPolicy?.maxVisualRepairs??0,improvement.remaining(job.improvementId));
 let lastIndex=0;
 try{
 const result=await boundedIterations({maxRepairs,firstStartedAt:job.startedAt,signal,canRefine:()=>hasBudget(3)&&improvement.remaining(job.improvementId)>0,
 evaluate:async(index)=>{job.iteration=index;job.status='running';lastIndex=index;saveJob(job);
 await stage('export',async()=>{await command(['bun',proto,'generate']);await command(['bun',join(ROOT,'src/geometry/export.ts'),join(dir,'project')]);});
 await stage('build',async()=>{await command(['bun',join(ROOT,'src/sync-bindings.ts'),join(dir,'project')]);await command(['bun',proto,'build']);});
 await stage('verify',async()=>{await command(['bun',proto,'verify']);});
 const runtime=await stage('runtime',async()=>{job.capturePlan=capturePlan(read(join(dir,'project/game/assets/scene-audit.json')).views.length);saveJob(job);job.previewUrl=await preview(job.id);const output=join(dir,'runtime');mkdirSync(output,{recursive:true});await command(['node',join(ROOT,'src/geometry/capture.mjs'),join(dir,'project/game'),job.previewUrl,output],job.capturePlan.stageTimeoutMs);const r=read(join(output,'runtime.json'));if(r.distManifestDigest!==read(join(dir,'project/evidence/run-report.json')).distManifestDigest)throw Error('运行证据与构建产物不一致');job.runtime=r;return r;});
 await evaluate(runtime);
 return {status:job.status,score:job.quality?.score??null};
 },
 snapshot:async(cycle)=>{snapshotIteration(dir,job,cycle);},
 onProgress:(cycles,bestIndex)=>{job.visualIterations={cycles,bestIndex,maxRepairs,status:'running'};job.firstDraft??=structuredClone(cycles[0]);saveJob(job);},
 refine:async(sourceIndex,index)=>{job.status='running';await stage('repair',async()=>{
  improvement.reserveRepair(job.improvementId,'final',job.review?.summary??'依据本轮真实画面的具体失败项修正');
  event(job,'visual-repair','自动视觉修正 '+index+'/'+maxRepairs+'；复用第 '+sourceIndex+' 轮的最佳候选');
  const next=await refineScene(job,plan,images,join(dir,'generation','iteration-'+index),signal,{dir:join(dir,'iterations',String(sourceIndex)),jobId:job.id,version:job.pipelineVersion,iteration:sourceIndex});
  validateScene(next,plan,images.length);
  const parts=next.program.instances.reduce((n,i)=>n+next.program.templates.find(t=>t.id===i.template)!.parts.length,0);
  if(!sceneComplexity(next,job.complexity,parts).passed)throw Error('修正未满足原复杂度');
  const materials=join(dir,'materials');mkdirSync(materials,{recursive:true});save(join(materials,'texture-request.json'),{references:images,textures:next.textures,reused:resolveTextureReuse(next,images.map(i=>digest(readFileSync(i.path))))});
  await command([join(ROOT,'data/reconstruction-env/bin/python'),join(ROOT,'src/geometry/textures.py'),materials]);
  resetPreview(job.id);job.previewUrl=null;
  prepareScene(job,plan,dir,next,read(join(materials,'texture-registry.json')),read(join(materials,'texture-provenance.json')));
 });}
 });
 job.visualIterations={...result,maxRepairs,status:'completed'};
 if(result.bestIndex!==lastIndex){resetPreview(job.id);restoreIteration(dir,job,result.bestIndex);job.previewUrl=await preview(job.id);}
 job.selectedIteration=result.bestIndex;
 signal.throwIfAborted();event(job,'complete',maxRepairs?'有限迭代结束：'+({passed:'已通过全部门槛',limit:'达到修正轮数上限',budget:'预算不足以继续修正','no-improvement':'本轮提升不足，保留此前最佳候选'}[result.stopReason])+'；首稿 '+job.firstDraft.score+' 分，最佳 '+job.quality.score+' 分':job.validationKind==='visual-refinement'?'视觉反馈修正结束；原评分保留，本次不计首轮认证':job.validationKind==='checkpoint-continuation'?'检查点续跑结束；本次结果不计首轮认证':job.status==='passed'?'首轮生成通过全部门槛':'首轮生成未通过质量门槛；保留结果，不自动改写首轮成绩');
 }catch(error){
  if(job.visualIterations?.cycles?.length){resetPreview(job.id);restoreIteration(dir,job,job.visualIterations.bestIndex);job.visualIterations.status='interrupted';event(job,'candidate-retained','执行中断，保留已验收的最佳候选及全部轮次；本次交付未完成');}
  throw error;
 }
}
