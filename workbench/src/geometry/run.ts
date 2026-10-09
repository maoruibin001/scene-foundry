import {assetGeometryBasis,assetGeometryBasisMatches} from './asset-geometry-basis';
import {VOXEL_LIMITS} from '../voxel/program';
import {generateVoxelScene} from '../voxel/generate';
import {assertProceduralHandoff,assertProceduralBudget} from './procedural-handoff';
import {referenceComposition} from './reference-composition';
import {sceneVisibility} from './visibility';
import {assertStorageAvailable} from '../storage-preflight';
import {candidateEvidence} from './candidate-selection';
import {inspectContacts,contactSummary} from './contacts';
import {bindReferenceFrames} from './reference-framing';
import {crossTaskReuse} from '../reuse-mode';
import {fitAssemblyBudget} from './triangle-budget';
import {preserveOutput,saveDelivery,failureDisposition} from '../output-delivery';
import {provisionalScene} from './provisional-scene';
import {assetContextContract} from './asset-scene-context';
import {verifyAssetReview} from './asset-review';
import {referenceProjection} from './reference-projection';
import {surfaceAudit} from './surface-audit';
import {prioritizeAssets,selectAssetPreviews} from './asset-priority';
import {referencePixelSizes,textureSourceEvidence} from './texture-source';
import {refineWithEvidence} from './evidence-refinement';
import {assertFixedDependencies} from '../dependency-preflight';
import {assertSpatialAccepted} from './spatial-order';
import {checkpointSpatialInput,assertCheckpointSpace} from './checkpoint-space';
import {reusedSpatialBaseline} from './reused-space';
import {recoverSpatialAcceptance} from './spatial-recovery';
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
import {DATA,ROOT,UPLOADS,save,read,runDir,saveJob,event,digest} from '../store';
import {validateScene,semanticCounts} from './scene-contract';
import {assembleScene,validateAsset} from './layout';
import {checkpoints} from './checkpoints';
import {surfacePartBudget} from './surface-part-budget';
import {jobTextureReuse} from './texture-library';
import {collectAssetWorkers} from './asset-workers';
import {generateLayout,generateOneAsset,generationProvenance} from './generate';
import {hasBudget,hasSceneBudget} from '../provider';
import {standardJob,remainingProductionMs} from '../matching-level';
import {prepareGeometryProject} from './prepare';
import {COMPLEXITIES,complexityPolicy} from '../complexity';
import {executionSettings} from '../execution-settings';
import {generationPhase,finishGeneration} from '../timing';
import {assetCache,assetKey,cacheCheckpointAssets} from './asset-cache';
export function sceneComplexity(scene:any,level:keyof typeof COMPLEXITIES,parts:number,kind='scene'){const p=kind==='voxel'?{...complexityPolicy(level,true),maxEntities:VOXEL_LIMITS.entities,maxParts:2048,maxMaterials:VOXEL_LIMITS.palette}:complexityPolicy(level,Array.isArray(scene.observedBindings)),entities=scene.entities.filter((e:any)=>e.role!=='ground'),kinds=[...new Set(entities.map((e:any)=>e.category))];const checks=[{id:'entityBudget',passed:entities.length>=p.minEntities&&entities.length<=p.maxEntities,actual:entities.length,expected:[p.minEntities,p.maxEntities]},{id:'kindVariety',passed:kinds.length>=p.minKinds,actual:kinds.length,expected:p.minKinds},{id:'partBudget',passed:parts<=p.maxParts,actual:parts,expected:p.maxParts},{id:'materialBudget',passed:scene.program.materials.length<=p.maxMaterials,actual:scene.program.materials.length,expected:p.maxMaterials}];return {level,label:p.label,entityCount:entities.length,kindCount:kinds.length,kinds,partCount:parts,checks,passed:checks.every(c=>c.passed),method:'自由语义类别、实例与部件预算；丰富度和还原效果由真实画面独立评估'};}

function prepareScene(job:any,plan:any,dir:string,value:any,textures:any,provenance:any){
 assertStorageAvailable(undefined,2*1024**3);
 value=bindReferenceFrames(value,(job.images??[]).map((i:any)=>({path:join(UPLOADS,i.file)})));const result={value};save(join(dir,'generated-scene.json'),result.value);job.sceneProgram={version:result.value.version,file:'generated-scene.json'};
  const prepared=prepareGeometryProject(join(dir,'project'),result.value.program,textures,{id:'scene-'+job.id,summary:plan.summary,scene:result.value,provenance:{pipelineVersion:job.pipelineVersion,references:(job.images??[]).map((i:any)=>i.id),textures:provenance,modelSettings:job.modelSettings}});
  job.bounds=prepared.bounds;job.objectCount=prepared.meshes;job.entityCount=result.value.program.instances.length;job.complexityReport=sceneComplexity(result.value,job.complexity,prepared.meshes,job.sceneKind);
  job.structure={passed:true,semanticCounts:semanticCounts(result.value.entities),checks:[{id:'geometry-contract',passed:true},{id:'requirement-bindings',passed:true},{id:'texture-provenance',passed:true}],geometry:{triangles:prepared.triangles,suspects:[],scope:'仅证明网格契约、来源和需求绑定；空间接触、遮挡和穿插由实际画面验收，未冒充碰撞检测'},assumptions:result.value.assumptions};
  save(join(dir,'surface-audit.json'),surfaceAudit(value,textures));
  const observationPath=join(dir,'generation/reference-observations.json');save(join(dir,'reference-projection.json'),referenceProjection(value,existsSync(observationPath)?read(observationPath):null));
  save(join(dir,'reference-composition.json'),referenceComposition(value,existsSync(observationPath)?read(observationPath):null,sceneVisibility(value,textures)));
  const openingReport=inspectOpenings(result.value);job.structure.openings=openingSummary(openingReport);save(join(dir,'spatial-openings.json'),openingReport);
  const openingIssues=job.structure.openings.checks.filter((c:any)=>c.status!=='clear');if(openingIssues.length)event(job,'spatial-openings','网格诊断发现 '+openingIssues.length+' 处开口/后景疑点，将连同真实画面用于视觉修正');
  const contacts=inspectContacts(result.value);job.structure.contacts=contactSummary(contacts);save(join(dir,'spatial-contacts.json'),contacts);
  const contactIssues=contacts.checks.filter(c=>c.status!=='connected');if(contactIssues.length)event(job,'spatial-contacts','实际网格发现 '+contactIssues.length+' 处连接疑点；保留输出并随画面评分');
  save(join(dir,'structure.json'),job.structure);save(join(dir,'complexity.json'),job.complexityReport);save(join(dir,'recipe.json'),{name:result.value.program.name,objects:prepared.objects,materials:result.value.program.materials,semanticEntities:result.value.entities});return result.value;
}
export async function runGeneralScene({job,plan,dir,signal,stage,command,preview,resetPreview,evaluate}:any){
 const images=(job.images??(job.image?[job.image]:[])).map((i:any)=>({path:join(UPLOADS,i.file),mime:i.mime}));
 const legacyVoxel=job.sceneKind==='voxel'&&job.reuseSceneFrom&&!existsSync(join(runDir(job.reuseSceneFrom),'voxel-source-scene.json'));
 job.generationMethod=job.sceneKind==='voxel'?(legacyVoxel?'voxel-scene-v1':'voxel-geometry-v2'):'general-geometry-v3';job.stageTrackingVersion='exclusive-stages-v1';job.iteration=0;
 assertFixedDependencies();
 const finishScene=async(value:any,textures:any,provenance:any)=>{
  if(job.sceneKind==='voxel'&&!legacyVoxel){
   await stage('voxel',async()=>{
    const source={...bindReferenceFrames(value,images),voxelizationTarget:{version:'shared-geometry-v2',resolution:128,requirements:plan.requirements}};save(join(dir,'voxel-source-scene.json'),source);
    save(join(dir,'voxelization-input.json'),{source,plan,referenceCount:images.length,textures,options:{resolution:128}});
    await command(['bun',join(ROOT,'src/voxel/convert.ts'),dir],240000);
    const program=read(join(dir,'voxel-program.json')),metrics=read(join(dir,'voxel-metrics.json'));
    job.voxel={...metrics,program:'voxel-program.json',editable:'scene.vox',palette:program.palette};
    job.voxelPipelineVersion='shared-geometry-v2';value=read(join(dir,'voxelized-scene.json'));
    for(const template of value.program.templates){const folder=join(dir,'generation','voxel-assets',template.id);mkdirSync(folder,{recursive:true});save(join(folder,'geometry.json'),{version:'asset-geometry-v1',template});}
    provenance={...provenance,voxelization:{sourceSceneSha256:program.sourceSceneSha256,report:'voxelization-report.json',colorSource:'actual validated material colors and reference texture pixels',measuredColorRecovery:true}};
    event(job,'voxel-generated',`${metrics.cells} 个真实占用格；保留${metrics.entities}个实体，体素画面仍须独立原图验收`);saveJob(job);
   });
  }
  return stage('assembly',async()=>prepareScene(job,plan,dir,value,textures,provenance));
 };
 const scene=await (async()=>{
  if(legacyVoxel){
   const produced=await stage('voxel',()=>generateVoxelScene({job,plan,images,root:dir,dir:join(dir,'generation/voxel'),signal}));
   return stage('assembly',async()=>prepareScene(job,plan,dir,produced.scene,{},produced.provenance));
  }
  const validate=(value:any)=>{const s=validateScene(value,plan,images.length),parts=s.program.instances.reduce((n,i)=>n+s.program.templates.find(t=>t.id===i.template)!.parts.length,0),c=sceneComplexity(s,job.complexity,parts);if(!c.passed)throw Error('所选复杂度未满足：'+JSON.stringify(c.checks));return s;};
  const source=job.reuseSceneFrom?join(runDir(job.reuseSceneFrom),'generated-scene.json'):null;
  // 在任何模型调用前校验保存场景和关系，完整场景仍须重新通过真实灰模验收。
  const sourceScene=source?validate(read(job.sceneKind==='voxel'?join(runDir(job.reuseSceneFrom),'voxel-source-scene.json'):source)):null,baseline=source?reusedSpatialBaseline(read(join(runDir(job.reuseSceneFrom),'job.json')),sourceScene):null;
  if(baseline)save(join(dir,'spatial-reuse.json'),baseline.provenance);
  const progress=(phase:string,completed:number,total:number,current:string|null)=>{generationPhase(job,phase);job.generationProgress={phase,completed,total,current};event(job,'generation-progress',phase+(total?' '+completed+'/'+total:'')+(current?' · '+current:''));};
  const generationDir=join(dir,'generation'),ctx:any={job,plan,images,dir:generationDir,signal,stage,onProgress:(phase:string)=>progress(phase,0,0,null)};
  progress(source?(job.refineScene?'根据真实画面反馈修正场景':'复用完整场景'):'规划共享布局',0,0,null);
  const restored=job.reuseCheckpoint?checkpoints.restore(job.reuseCheckpoint,job,generationDir):null;
  let layout:any=null;
  try{
  ctx.acceptSpace=(space:any)=>acceptSpatialLayout(space,ctx,command,stage);
  layout=source?null:restored?.layout??await generateLayout(ctx);saveJob(job);const reused=source?validate(job.reuseRefinementOutput?restoreSavedRefinement(job,plan,images,generationDir,signal):job.refineScene?await stage('repair',()=> (job.refinementMode==='evidence-led'?refineWithEvidence:job.refinementMode==='camera-alignment'?alignCameras:refineScene)(job,plan,images,generationDir,signal)):sourceScene):null;
  if(restored){
   const localObservation=join(generationDir,'reference-observations.json'),sourceObservation=join(runDir(restored.manifest.sourceJobId),'generation/reference-observations.json');
   // 新检查点携带不可变观察；兼容旧检查点时也保存到本次产物，后续恢复不能再丢失。
   if(existsSync(localObservation))ctx.observation=read(localObservation);
   else if(existsSync(sourceObservation)){ctx.observation=read(sourceObservation);save(localObservation,ctx.observation);}
   const savedSpace=restored.manifest.files['space.json']?read(join(restored.folder,'space.json')):undefined;
   const checked=await ctx.acceptSpace(checkpointSpatialInput(restored.layout,savedSpace));
   assertCheckpointSpace(checked,restored.layout);
  }
  if(reused){const recovered=await stage('graybox',async()=>recoverSpatialAcceptance(job,reused,plan,generationDir));if(!recovered){const prior=baseline!.space;await acceptSpatialLayout({...prior,program:{...prior.program,instances:reused.program.instances},cameras:reused.cameras,entities:reused.entities},{...ctx,existingScene:reused},command,stage);}}
  if(layout){save(join(generationDir,'plan.json'),plan);for(const image of images)if(!(job.images??(job.image?[job.image]:[])).some((i:any)=>join(UPLOADS,i.file)===image.path&&i.id===digest(readFileSync(image.path))))throw Error('参考图片内容与检查点来源不一致');}
  assertSpatialAccepted(job,layout??reused);
  if(layout)save(join(generationDir,'surface-part-budget.json'),surfacePartBudget(layout,job.complexity));
  const steps=layout?.program.templates.map(t=>({id:t.id,label:t.label,status:'pending'}))??[],checkpoint=layout?{...generationProvenance(ctx,layout),steps}:null;
  if(checkpoint)save(join(generationDir,'checkpoints.json'),checkpoint);
  const materials=join(dir,'materials');mkdirSync(materials,{recursive:true});save(join(materials,'texture-request.json'),{references:images,textures:(layout??reused)!.textures,reused:jobTextureReuse(job,(layout??reused)!,images.map(i=>digest(readFileSync(i.path))))});
  progress('提取并记录材质来源',0,layout?.program.templates.length??0,null);
  const {textures,provenance}=await stage('materials',async()=>{await command([join(DATA,'reconstruction-env/bin/python'),join(ROOT,'src/geometry/textures.py'),materials]);return {textures:read(join(materials,'texture-registry.json')),provenance:read(join(materials,'texture-provenance.json'))};});
  ctx.referencePixelSizes??=referencePixelSizes(images);ctx.textureSourceEvidence=textureSourceEvidence((layout??reused)!,ctx.referencePixelSizes);save(join(materials,'texture-source-evidence.json'),ctx.textureSourceEvidence);
  let value=reused;
  if(layout){
   const assets=await stage('assets',async()=>{assertSpatialAccepted(job,layout);
   ctx.acceptedScene=read(join(generationDir,'blockout',String(job.blockout.currentRound??0),'scene.json'));
   save(join(generationDir,'procedural-budget.json'),assertProceduralBudget(ctx.acceptedScene,layout));
   if(job.optimizationPolicy?.assetContextViews===1)ctx.assetSceneContext={scene:ctx.acceptedScene,review:job.blockout.rounds.at(-1).review,observation:ctx.observation};
   const contextContract=ctx.assetSceneContext?assetContextContract(layout,ctx.assetSceneContext):undefined;
   const restoredBasis=(restored?.assets??[]).map((a:any)=>({templateId:a.id,source:a.source?.acceptedGeometrySha256??null,expected:assetGeometryBasis(ctx.acceptedScene,a.id)?.sha256??null,reusable:assetGeometryBasisMatches(a.source,ctx.acceptedScene,a.id)}));
   save(join(generationDir,'asset-geometry-reuse.json'),{version:'accepted-local-geometry-v1',assets:restoredBasis,scope:'仅判断局部结构依据是否匹配；缺失或不同来源不覆盖历史，需正常重新生成并独立验收'});
   for(const row of restoredBasis.filter(r=>!r.reusable)){const file=join(generationDir,'assets',row.templateId,'checkpoint.json');save(file,{...read(file),status:'pending',reuseRejected:{reason:'accepted-geometry-basis-mismatch',...row}});}
   const assets=restored?.assets.filter((a:any)=>restoredBasis.find(r=>r.templateId===a.id)?.reusable).map((a:any)=>validateAsset(a.value,layout.program.templates.find(t=>t.id===a.id)!,layout,textures).value)??[];
   const ranked=prioritizeAssets(layout.program.templates,layout,plan,ctx.observation),previewSelection=selectAssetPreviews(ranked,layout,job.optimizationPolicy?.assetVisualChecks??0),previewIds=new Set(previewSelection.map(r=>r.templateId)),previewProof=new Map();
   save(join(generationDir,'asset-preview-selection.json'),{version:contextContract?'subject-context-preview-v2':'subject-preview-v1',limit:job.optimizationPolicy?.assetVisualChecks??0,selected:previewSelection,contextViews:contextContract?1:0,scope:contextContract?'既有重点资产名额、两个候选上限不变；每候选2个独立机位加1个灰模上下文机位，不替代完整成品验收':'只改变既有预览名额覆盖；不增加模型调用或预览上限，不替代组装与成品验收'});
   const ready=new Set(assets.map((a:any)=>a.template.id));for(const step of steps)if(ready.has(step.id))step.status='reused';
   if(crossTaskReuse(job))cacheCheckpointAssets(job,plan,layout,textures,checkpoints.matching(job).slice(0,8).flatMap(c=>{try{return [checkpoints.load(c.id,job)]}catch{return []}}),assetCache,ctx.acceptedScene);
   for(const brief of layout.program.templates){if(!crossTaskReuse(job)||ready.has(brief.id))continue;const cached=assetCache.get(assetKey(job,plan,layout,brief,textures,ctx.acceptedScene),brief,layout,textures);if(!cached||!assetGeometryBasisMatches(cached.source,ctx.acceptedScene,brief.id))continue;try{assertProceduralHandoff(cached.value,ctx.acceptedScene);}catch{continue;}const folder=join(generationDir,'assets',brief.id);mkdirSync(folder,{recursive:true});save(join(folder,'geometry.json'),cached.value);save(join(folder,'accepted-geometry.json'),assetGeometryBasis(ctx.acceptedScene,brief.id));save(join(folder,'checkpoint.json'),{status:'passed',...generationProvenance(ctx,layout),geometrySha256:digest(JSON.stringify(cached.value)),acceptedGeometrySha256:assetGeometryBasis(ctx.acceptedScene,brief.id)?.sha256??null,reusedFrom:cached.source,reusedAt:Date.now(),durationMs:0,quality:'not-assessed'});assets.push(cached.value);previewProof.set(brief.id,cached.source?.assetVisualReview);ready.add(brief.id);steps.find(s=>s.id===brief.id)!.status='reused';}
   const reusableAssets=new Map();for(let n=assets.length-1;n>=0;n--){const asset=assets[n],id=asset.template.id;try{assertProceduralHandoff(asset,ctx.acceptedScene);}catch{assets.splice(n,1);ready.delete(id);steps.find(s=>s.id===id)!.status='pending';continue;}const proofFile=join(generationDir,'assets',id,'asset-visual-review.json'),proof=previewProof.get(id)??(existsSync(proofFile)?read(proofFile):null);if(previewIds.has(id)&&!verifyAssetReview(asset,proof,contextContract)){reusableAssets.set(id,asset);assets.splice(n,1);ready.delete(id);steps.find(s=>s.id===id)!.status='pending';}}
   save(join(generationDir,'asset-priority.json'),ranked.map(({brief,...row})=>({...row,templateId:brief.id,label:brief.label})));
   const pending=ranked.map(r=>r.brief).filter(t=>!ready.has(t.id)),active=new Map<string,string>();let completed=assets.length;
   const enoughBudget=standardJob(job)?hasSceneBudget(job,pending.length):hasBudget(pending.length+1); // A budget shortage preserves a local draft without starting more model requests.
   if(!enoughBudget)job.executionFault=(standardJob(job)?'SCORE_BUDGET_RESERVED':'MODEL_BUDGET_EXHAUSTED')+'：缺少 '+pending.length+' 类资产，剩余预算不足以完成资产和一次评估';
   const concurrency=executionSettings(job.executionSettings).assetConcurrency,phase='生成资产（最多并发 '+concurrency+' 类）',readyAt=Date.now();
   job.generationLimits={assetConcurrency:concurrency,assetStageTimeoutMs:job.productionWindow?.version==='quality-delivery-window-v3'?null:standardJob(job)?Math.max(1,Math.min(90*60*1000,remainingProductionMs(job,'geometry-asset'))):90*60*1000};
   const persistCheckpoint=()=>{try{const cp=checkpoints.register({job,planFile:join(dir,'plan.json'),generationDir,textureFile:join(dir,'materials/texture-registry.json'),provenance:{kind:'asset-progress',pipelineVersion:job.pipelineVersion,parentCheckpoint:job.reuseCheckpoint??null}});job.checkpointId=cp.id;saveJob(job);}catch(error){event(job,'checkpoint-error','进度文件已保存，检查点登记失败：'+String(error));}};
   save(join(generationDir,'checkpoints.json'),checkpoint);progress(phase,completed,steps.length,null);persistCheckpoint();
   const assetSignal=job.generationLimits.assetStageTimeoutMs===null?signal:AbortSignal.any([signal,AbortSignal.timeout(job.generationLimits.assetStageTimeoutMs)]);
   const generated=enoughBudget?await collectAssetWorkers(pending,job.generationLimits.assetConcurrency,assetSignal,async(brief,_index,workerSignal)=>{
    const step=steps.find(s=>s.id===brief.id)!;step.status='running';active.set(brief.id,brief.label);save(join(generationDir,'checkpoints.json'),checkpoint);progress(phase,completed,steps.length,[...active.values()].join('、'));
    try{const asset=await generateOneAsset({...ctx,readyAt,requiresAssetPreview:previewIds.has(brief.id),reusableAsset:reusableAssets.get(brief.id),signal:workerSignal},layout,brief,textures);step.status='passed';completed++;persistCheckpoint();return asset;}
    catch(error){step.status=workerSignal.aborted?'cancelled':'failed';throw error;}
    finally{active.delete(brief.id);save(join(generationDir,'checkpoints.json'),checkpoint);progress(phase,completed,steps.length,[...active.values()].join('、')||null);}
   },error=>['budget','external','configuration'].includes(failureDisposition(error).kind),{partialOnTimeout:standardJob(job)}):{values:[],failures:[],fatal:job.executionFault};
   assets.push(...generated.values);if(generated.fatal)job.executionFault=generated.fatal;
   job.assetFailures=generated.failures.map(f=>({templateId:pending[f.index].id,error:f.error}));
   if(assets.length<layout.program.templates.length){job.partialOutput={completed:assets.length,total:layout.program.templates.length,missing:layout.program.templates.filter(t=>!assets.some(a=>a.template.id===t.id)).map(t=>({id:t.id,label:t.label})),reason:generated.fatal??(generated.timedOut?'制作时间窗已到，保留成功资产并进入草稿评分':null)??'独立资产在有界修正后仍未完成；保留成功资产并交付明确标记的草稿'};event(job,'partial-output','详细资产未齐，交付本次已生成几何组成的草稿，缺失详情公开，继续细化需恢复未完成资产。');}
   return assets;});
   for(const asset of assets)assertProceduralHandoff(asset,ctx.acceptedScene);
   progress(job.partialOutput?'组装已完成资产与灰模草稿':'组装并检查完整场景',assets.length,steps.length,null);assertSpatialAccepted(job,layout);if(job.partialOutput){value=provisionalScene(layout,assets,read(join(generationDir,'blockout',String(job.blockout.currentRound??0),'scene.json')),plan,images.length).scene;}else{const raw={...layout,version:'scene-v1',program:{...layout.program,templates:layout.program.templates.map(t=>assets.find(a=>a.template.id===t.id)!.template)}};const fitted=fitAssemblyBudget(raw.program);save(join(dir,'assembly-budget.json'),fitted.report);if(fitted.report.changes.length){job.assemblyOptimization=fitted.report;event(job,'assembly-budget','旧资产总量超预算，已保留所有实例和结构，仅降低散布密度；原始资产保留，质量待验收。');}value=validate({...raw,program:fitted.program});}return await finishScene(value!,textures,provenance);
  }
  assertSpatialAccepted(job,value);return await finishScene(value!,textures,provenance);
  }finally{finishGeneration(job,job.structure?.passed?'passed':signal.aborted?'cancelled':'failed');if(layout&&existsSync(join(dir,'materials/texture-registry.json'))){try{const cp=checkpoints.register({job,planFile:join(dir,'plan.json'),generationDir,textureFile:join(dir,'materials/texture-registry.json'),provenance:{kind:job.reuseCheckpoint?'continuation':'job',pipelineVersion:job.pipelineVersion,parentCheckpoint:job.reuseCheckpoint??null}});job.checkpointId=cp.id;event(job,'checkpoint','已保存可续跑检查点：'+cp.assets.length+'/'+cp.total+' 类资产');}catch(error){event(job,'checkpoint-error','检查点未保存：'+String(error));}}}
 })();
 const proto=join(ROOT,'../prototype/bin/pipeline.ts'),maxRepairs=job.iterationPolicy?.maxVisualRepairs===null&&improvement.remaining(job.improvementId)>0?null:Math.min(job.iterationPolicy?.maxVisualRepairs??0,improvement.remaining(job.improvementId));
 const renderCurrent=async()=>{
 assertStorageAvailable(undefined,2*1024**3);
 await stage('export',async()=>{await command(['bun',proto,'generate']);await command(['bun',join(ROOT,'src/geometry/export.ts'),join(dir,'project')]);});
 await stage('build',async()=>{await command(['bun',join(ROOT,'src/sync-bindings.ts'),join(dir,'project')]);await command(['bun',proto,'build']);});
 await stage('verify',async()=>{await command(['bun',proto,'verify']);});
 const runtime=await stage('runtime',async()=>{job.capturePlan=capturePlan(read(join(dir,'project/game/assets/scene-audit.json')).views.length);saveJob(job);job.previewUrl=await preview(job.id);const output=join(dir,'runtime');mkdirSync(output,{recursive:true});await command(['node',join(ROOT,'src/geometry/capture.mjs'),join(dir,'project/game'),job.previewUrl,output],job.capturePlan.stageTimeoutMs);const r=read(join(output,'runtime.json'));if(r.distManifestDigest!==read(join(dir,'project/evidence/run-report.json')).distManifestDigest)throw Error('运行证据与构建产物不一致');job.runtime=r;return r;});

 preserveOutput(job,dir,'',job.partialOutput?'partial':'scene');saveDelivery(job,dir);return runtime;
 };
 if(job.partialOutput){const runtime=await renderCurrent();
 // A deadline-limited draft can receive an honest score; it remains a partial delivery, never a finished pass.
 if(standardJob(job)&&remainingProductionMs(job,'judge')>0&&hasSceneBudget(job,1,'judge')&&(!job.executionFault||job.executionFault.includes('SCORE_BUDGET_RESERVED'))){
  job.assessmentScope='partial';
  try{await evaluate(runtime);save(join(dir,'partial-assessment.json'),{scope:'partial',missing:job.partialOutput.missing,quality:job.quality,spec:job.spec,at:Date.now()});}
  catch(error){signal.throwIfAborted();job.partialAssessmentError=String(error);job.executionFault=String(error);event(job,'assessment-incomplete','草稿评分未完成：'+String(error));}
 }
 signal.throwIfAborted();job.status=job.executionFault?'blocked':'needs_review';job.error=job.executionFault??job.partialOutput.reason;job.stage='assets';saveDelivery(job,dir);saveJob(job);event(job,'complete',job.quality?'草稿已交付并评分；资产未齐，未记为成品成功':'草稿已交付；评分尚未完成，未记为成功');return;}

 let lastIndex=0;
 try{
 const result=await boundedIterations({maxRepairs,firstStartedAt:job.startedAt,signal,canRefine:()=>!job.runtime?.captureIssue&&hasBudget(3)&&improvement.remaining(job.improvementId)>0,
 refineBlockedReason:()=>job.runtime?.captureIssue?'runtime-evidence':!hasBudget(3)?'budget':improvement.get(job.improvementId).stopped?'no-improvement':'limit',
 evaluate:async(index)=>{job.iteration=index;job.status='running';lastIndex=index;saveJob(job);
 const runtime=await renderCurrent();
 await evaluate(runtime);
 return candidateEvidence(job);
 },
 snapshot:async(cycle)=>{snapshotIteration(dir,job,cycle);},
 onProgress:(cycles,bestIndex)=>{job.visualIterations={cycles,bestIndex,maxRepairs,status:'running'};job.firstDraft??=structuredClone(cycles[0]);saveJob(job);},
 refine:async(sourceIndex,index)=>{job.status='running';await stage('repair',async()=>{
  improvement.reserveRepair(job.improvementId,'final',job.review?.summary??'依据本轮真实画面的具体失败项修正');
   event(job,'visual-repair','自动视觉修正 '+index+(maxRepairs===null?'':'/'+maxRepairs)+'；复用第 '+sourceIndex+' 轮的最佳候选');
   if(legacyVoxel){
    const source=join(dir,'iterations',String(sourceIndex));
    const produced=await generateVoxelScene({job,plan,images,root:dir,dir:join(dir,'generation','iteration-'+index,'voxel'),signal},{folder:source,runtime:read(join(source,'runtime/runtime.json')),review:read(join(source,'review.json')),source:read(join(source,'voxel-program.json'))});
    resetPreview(job.id);job.previewUrl=null;prepareScene(job,plan,dir,produced.scene,{},produced.provenance);return;
   }
  const next=await refineScene(job,plan,images,join(dir,'generation','iteration-'+index),signal,{dir:join(dir,'iterations',String(sourceIndex)),jobId:job.id,version:job.pipelineVersion,iteration:sourceIndex});
  validateScene(next,plan,images.length);
  const parts=next.program.instances.reduce((n,i)=>n+next.program.templates.find(t=>t.id===i.template)!.parts.length,0);
  if(!sceneComplexity(next,job.complexity,parts).passed)throw Error('修正未满足原复杂度');
  const materials=join(dir,'materials');mkdirSync(materials,{recursive:true});save(join(materials,'texture-request.json'),{references:images,textures:next.textures,reused:jobTextureReuse(job,next,images.map(i=>digest(readFileSync(i.path))))});
  await command([join(DATA,'reconstruction-env/bin/python'),join(ROOT,'src/geometry/textures.py'),materials]);
  resetPreview(job.id);job.previewUrl=null;
  await finishScene(next,read(join(materials,'texture-registry.json')),read(join(materials,'texture-provenance.json')));
 });}
 });
 job.visualIterations={...result,maxRepairs,status:'completed'};
 if(result.bestIndex!==lastIndex){resetPreview(job.id);restoreIteration(dir,job,result.bestIndex);job.previewUrl=await preview(job.id);}
 job.selectedIteration=result.bestIndex;
 signal.throwIfAborted();event(job,'complete',maxRepairs!==0?'生成与修正结束：'+({passed:job.deliveryAssessment?.standard==='basic70'?'已通过70分基础交付，停止提分':'已通过全部门槛',limit:'达到修正轮数上限',budget:'预算不足以继续修正','no-improvement':'本轮提升不足，保留此前最佳候选','runtime-evidence':'场景与独立评分已保留；录屏证据未通过，停止无关的视觉重写，需修复运行采集'}[result.stopReason])+'；首稿 '+job.firstDraft.score+' 分，最佳 '+job.quality.score+' 分':job.validationKind==='visual-refinement'?'视觉反馈修正结束；原评分保留，本次不计首轮认证':job.validationKind==='checkpoint-continuation'?'检查点续跑结束；本次结果不计首轮认证':job.status==='passed'?'首轮生成通过全部门槛':'首轮生成未通过质量门槛；保留结果，不自动改写首轮成绩');
 }catch(error){
  if(job.visualIterations?.cycles?.length){resetPreview(job.id);restoreIteration(dir,job,job.visualIterations.bestIndex);job.visualIterations.status='interrupted';event(job,'candidate-retained','执行中断，保留已验收的最佳候选及全部轮次；本次交付未完成');}
  saveDelivery(job,dir);throw error;
 }
}
