import {assetGeometryBasis} from './asset-geometry-basis';
import {assertProceduralHandoff,proceduralSeeds,PROCEDURAL_HANDOFF_RULES} from './procedural-handoff';
import {loadSpatialRepairSeed} from '../spatial-diagnosis';
import {crossTaskReuse} from '../reuse-mode';
import {parallelPlanning} from './parallel-planning';
import {matchingGuidance,standardJob,firstPassCallEstimate} from '../matching-level';
import {hasSceneBudget} from '../provider';
import {validateAllocatedAsset} from './asset-validation';
import {assetPartCapacity} from './surface-part-budget';
import {assetSpatialHandoff,type AssetSceneContext} from './asset-scene-context';
import {createAssetReview} from './asset-review';
import {surfaceAudit} from './surface-audit';
import {assetSettings} from '../generation-policy';
import {savedStage,persistStageReuse} from './saved-stage';
import {observeReferences,bindObservedSpace} from './reference-observations';
import {scoringGuidance} from '../quality';
import {mkdirSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {callValidated} from '../contracts';
import {save,digest,read,runDir} from '../store';
import {SPEC} from '../spec';
import {ASSET_PROMPT,validateAsset,type SceneLayout,type AssetBrief} from './layout';
import {SPACE_PROMPT,SURFACE_PROMPT,validateSpace,applySurface} from './layout-stages';
import type {Texture} from './program';
import {jobTextureCandidates,jobTextureReuse} from './texture-library';
import {assetInput} from './asset-input';
import {referencePixelSizes,TEXTURE_SOURCE_GUIDANCE} from './texture-source';
import {prepareAssetEvidence} from './asset-evidence';
import {repairReusableTextureEvidence} from './repair-texture-evidence';
import {assetCache,assetKey} from './asset-cache';
export type GenerationContext={job:any;plan:any;images:{path:string;mime:string}[];dir:string;signal:AbortSignal;referencePixelSizes?:ReturnType<typeof referencePixelSizes>;textureSourceEvidence?:any[];readyAt?:number;requiresAssetPreview?:boolean;assetSceneContext?:AssetSceneContext;acceptedScene?:any;spatialRepairSeed?:any;reusableAsset?:any;onProgress?:(phase:string)=>void;stage?:(name:string,work:()=>Promise<any>)=>Promise<any>;observation?:any;acceptSpace?:(space:any)=>Promise<any>;revision?:{previousAsset:any;feedback:string;frames:{path:string;mime:string;name:string}[]}};
export async function generateLayout(ctx:GenerationContext){
 const {job,plan,images,dir,signal}=ctx;mkdirSync(dir,{recursive:true});
 if(!ctx.stage||!ctx.acceptSpace)throw Error('SPATIAL_GATE_REQUIRED：生成流程必须提供独立阶段记录和灰模验收');
 ctx.onProgress?.('逐图观察地标、遮挡与机位依据');ctx.observation=await ctx.stage('observe',()=>observeReferences(ctx));
 ctx.onProgress?.('规划空间与参考机位');
 const validateSavedSpace=(v:any)=>{if(!Array.isArray(v.spatialOpenings))throw Error('空间规划缺少开口声明');return bindObservedSpace(validateSpace(v,plan,images.length,job.complexity),ctx.observation)};
 let space=await ctx.stage('space',async()=>{if(job.spatialRepairSource){const source=read(join(runDir(job.spatialRepairSource.jobId),'job.json'));if(source.prompt!==job.prompt||JSON.stringify(source.images?.map(i=>i.id))!==JSON.stringify(job.images?.map(i=>i.id))||JSON.stringify(source.modelSettings)!==JSON.stringify(job.modelSettings)||JSON.stringify(source.plan)!==JSON.stringify(plan))throw Error('空间诊断来源的输入、模型或需求改变');ctx.spatialRepairSeed=loadSpatialRepairSeed(source,job.spatialRepairSource.round);const value=validateSavedSpace(ctx.spatialRepairSeed.space);save(join(dir,'spatial-diagnosis-source.json'),ctx.spatialRepairSeed.provenance);ctx.job.stages.space.reused=true;return {value,receipt:{kind:'spatial-diagnosis-basis',...ctx.spatialRepairSeed.provenance}};}const saved=savedStage(ctx,'scene-space',validateSavedSpace);if(saved){persistStageReuse(ctx,'scene-space',saved);ctx.job.stages.space.reused=true;return {value:saved.value,receipt:saved.receipt};}return callValidated({modelSettings:job.modelSettings,role:'scene-space',signal,maxTokens:9000,images,system:SPACE_PROMPT+'\n'+matchingGuidance(job),schemaContext:{requirementIds:plan.requirements.map((r:any)=>r.id)},text:JSON.stringify({input:job.prompt,scoring:scoringGuidance(job.policy),referenceImages:images.length,generationBrief:job.generationBrief,observation:ctx.observation,plan,productionRules:SPEC.rules})},dir,v=>{if(!Array.isArray(v.spatialOpenings))throw Error('新空间规划必须声明spatialOpenings；无开口时填空数组');if(!Array.isArray(v.spatialContacts))throw Error('新空间规划必须声明spatialContacts；无可见连接时填空数组');return bindObservedSpace(validateSpace(v,plan,images.length,job.complexity),ctx.observation)});});
 const estimate=firstPassCallEstimate(space.value.program.templates.length,job.matchingLevel??'detailed');
 save(join(dir,'call-estimate.json'),estimate);
 if(standardJob(job)&&!hasSceneBudget(job,estimate.grayboxCalls+estimate.assetCalls+2))throw Error('SCENE_BUDGET_INSUFFICIENT：空间计划已保存，余量不足以覆盖本场景灰模、材质、详细资产和评分预留');
 const originalSpace=structuredClone(space.value);
 ctx.referencePixelSizes??=referencePixelSizes(images);
 const planSurface=(frozenSpace:any,surfaceSignal=signal)=>ctx.stage!('surface',async()=>{
  const refs=images.map(i=>digest(readFileSync(i.path))),candidates=jobTextureCandidates(job,refs);
  const evidence=candidates.length?await repairReusableTextureEvidence(refs,join(dir,'surface-materials'),surfaceSignal,undefined,candidates.map(c=>c.id)):{images:[],context:[]};
  const request={modelSettings:job.modelSettings,role:'scene-surface',signal:surfaceSignal,maxTokens:6500,images:[...images,...evidence.images],system:SURFACE_PROMPT+'\n'+matchingGuidance(job)+'\n'+TEXTURE_SOURCE_GUIDANCE,text:JSON.stringify({input:job.prompt,referenceImages:images.length,referencePixelSizes:ctx.referencePixelSizes,plan,space:frozenSpace,materialBudget:job.generationBrief.budget.maximumMaterials,reusableTextures:evidence.context,materialImageOrder:'原始参考图在前，最后一张为实际候选颜色贴图表；表中asset编号与reusableTextures.sheetId对应，不是新的参考图。'})};
  const validateSurface=(v:any)=>{if(!Array.isArray(v.instanceSurfaces))throw Error('材质规划缺少逐实例表面配置 instanceSurfaces');const layout=applySurface(frozenSpace,v,plan,images.length,job.complexity);jobTextureReuse(job,layout,images.map(i=>digest(readFileSync(i.path))));return v;};
  const saved=savedStage(ctx,'scene-surface',validateSurface,false,undefined,request);
  if(saved){surfaceSignal.throwIfAborted();persistStageReuse(ctx,'scene-surface',saved);ctx.job.stages.surface.reused=true;return {value:saved.value,receipt:saved.receipt};}
  return callValidated(request,dir,validateSurface);
 });
 let surface:any;
 if(standardJob(job)&&!ctx.spatialRepairSeed){
  const accepted=await parallelPlanning(originalSpace,ctx.acceptSpace,planSurface,signal,(a,b)=>digest(JSON.stringify(a))===digest(JSON.stringify(b)));
  space={...space,value:accepted.space};surface=accepted.surface;
 }else{space={...space,value:await ctx.acceptSpace(originalSpace)};surface=await planSurface(space.value);}
 save(join(dir,'space.json'),space.value);
 save(join(dir,'surface.json'),surface.value);const result=applySurface(space.value,surface.value,plan,images.length,job.complexity);
 save(join(dir,'layout.json'),result);return result;
}
export function generationProvenance(ctx:GenerationContext,layout:SceneLayout){
 return {pipelineVersion:ctx.job.pipelineVersion,modelSettings:ctx.job.modelSettings,layoutSha256:digest(JSON.stringify(layout)),referenceSha256:ctx.images.map(i=>digest(readFileSync(i.path))),planSha256:digest(JSON.stringify(ctx.plan))};
}
export async function generateOneAsset(ctx:GenerationContext,layout:SceneLayout,brief:AssetBrief,textures:Record<string,Texture>){
 brief={...brief,maxParts:assetPartCapacity(layout,brief).maxParts};
 const folder=join(ctx.dir,'assets',brief.id);mkdirSync(folder,{recursive:true});
 const acceptedScene=ctx.acceptedScene??ctx.assetSceneContext?.scene,basis=assetGeometryBasis(acceptedScene,brief.id);
 const provenance={...generationProvenance(ctx,layout),acceptedGeometrySha256:basis?.sha256??null};save(join(folder,'input.json'),{...provenance,brief});if(basis)save(join(folder,'accepted-geometry.json'),basis);
 const started=Date.now(),readyAt=ctx.readyAt??started,key=assetKey(ctx.job,ctx.plan,layout,brief,textures,acceptedScene);save(join(folder,'checkpoint.json'),{status:'running',readyAt,startedAt:started,...provenance});
 try{
  const revision=ctx.revision;
  const evidence=await prepareAssetEvidence(ctx,layout,brief,textures,folder);
  if(revision)save(join(folder,'revision-input.json'),{previousAsset:revision.previousAsset,feedback:revision.feedback,frames:revision.frames.map(f=>({name:f.name,sha256:digest(readFileSync(f.path))}))});
  const assetReview=ctx.requiresAssetPreview?createAssetReview({brief,layout,textures,images:ctx.images,context:ctx.assetSceneContext,acceptedScene:ctx.acceptedScene,folder:join(folder,'visual-check'),signal:ctx.signal}):null;
  if(assetReview)await assetReview.restoreFailedPreview(ctx.job);
  const result=await callValidated({tools:assetReview?.kit,modelSettings:assetSettings(ctx.job,brief,layout),role:'geometry-asset',signal:ctx.signal,maxTokens:14000,images:[...ctx.images,...evidence.images,...(revision?.frames??[])],system:assetReview?ASSET_PROMPT.replace('不得调用工具，不生成代码。','仅调用本轮提供的 preview_asset 工具，不生成代码。')+'\n'+assetReview.kit.instructions:ASSET_PROMPT,text:JSON.stringify({matchingGuidance:matchingGuidance(ctx.job),...assetInput(ctx.job.prompt,ctx.plan,layout,brief,textures,acceptedScene),...evidence.context,proceduralStructure:proceduralSeeds(ctx.acceptedScene??ctx.assetSceneContext?.scene,brief.id),proceduralInstructions:PROCEDURAL_HANDOFF_RULES,...(ctx.assetSceneContext?{spatialHandoff:assetSpatialHandoff(brief,layout,ctx.assetSceneContext)}:{}),...(ctx.reusableAsset?{reusableAsset:ctx.reusableAsset,reuseInstructions:'已有资产结构合格；先直接预览已有数据，满足原图可见要求就原样选择，禁止为重复生成而重造。只有真实预览暴露具体缺陷时再修正。'}:{}),...(revision?{revisionContext:{previousAsset:revision.previousAsset,feedback:revision.feedback,referenceImageCount:ctx.images.length,additionalFrameNames:revision.frames.map(f=>f.name),instructions:'图片顺序见 imageOrder：原始参考图片、原图局部及贴图片段在前，实际生成反馈画面在最后。根据明确差距修正当前资产，保留正确部分；实际画面不是新的参考原图，不能继承其错误。共享布局、身份和边界不变，只修改当前资产。'}}:{})})},folder,v=>{assertProceduralHandoff(v,ctx.acceptedScene??ctx.assetSceneContext?.scene);const measured=validateAllocatedAsset(v,brief,layout,textures);const checked=measured.value;if(assetReview)assetReview.assertReviewed(checked);return checked;});
  const assetVisualReview=assetReview?.assertReviewed(result.value)??null;if(assetVisualReview)save(join(folder,'asset-visual-review.json'),assetVisualReview);
  ctx.signal.throwIfAborted();const checked=validateAsset(result.value,brief,layout,textures);save(join(folder,'surface-audit.json'),surfaceAudit({program:{...layout.program,templates:[result.value.template],instances:layout.program.instances.filter(i=>i.template===brief.id)}},textures));save(join(folder,'geometry.json'),result.value);save(join(folder,'spatial-openings.json'),checked.openings);save(join(folder,'spatial-contacts.json'),checked.contacts);save(join(folder,'surface-bindings.json'),{version:'surface-bindings-v1',checks:checked.surfaceBindings,visualQuality:'not-assessed'});
  save(join(folder,'checkpoint.json'),{status:'passed',readyAt,startedAt:started,endedAt:Date.now(),durationMs:Date.now()-started,...provenance,geometrySha256:digest(JSON.stringify(result.value)),bounds:checked.bounds,triangles:checked.triangles,quality:'not-assessed'});
  // 有画面反馈的候选仍须重新验收，不能仅凭几何合法覆盖原来的可复用资源。
  if(!revision&&crossTaskReuse(ctx.job))try{assetCache.put(key,result.value,{jobId:ctx.job.id,pipelineVersion:ctx.job.pipelineVersion,modelSettings:assetSettings(ctx.job,brief,layout),assetVisualReview,acceptedGeometrySha256:basis?.sha256??null,durationMs:Date.now()-started});}catch(error){save(join(folder,'cache-warning.json'),{error:String(error)});}
  return result.value;
 }catch(error){save(join(folder,'checkpoint.json'),{status:ctx.signal.aborted?'cancelled':'failed',readyAt,startedAt:started,endedAt:Date.now(),durationMs:Date.now()-started,...provenance,error:String(error)});throw error;}
}
