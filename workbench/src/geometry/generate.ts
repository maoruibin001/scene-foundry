import {observeReferences,bindObservedSpace} from './reference-observations';
import {scoringGuidance} from '../quality';
import {mkdirSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {callValidated} from '../contracts';
import {save,digest} from '../store';
import {SPEC} from '../spec';
import {ASSET_PROMPT,validateAsset,type SceneLayout,type AssetBrief} from './layout';
import {SPACE_PROMPT,SURFACE_PROMPT,validateSpace,applySurface} from './layout-stages';
import type {Texture} from './program';
import {textureCandidates,resolveTextureReuse} from './texture-library';
import {assetInput} from './asset-input';
import {assetCache,assetKey} from './asset-cache';
export type GenerationContext={job:any;plan:any;images:{path:string;mime:string}[];dir:string;signal:AbortSignal;readyAt?:number;onProgress?:(phase:string)=>void;stage?:(name:string,work:()=>Promise<any>)=>Promise<any>;observation?:any;acceptSpace?:(space:any)=>Promise<any>;revision?:{previousAsset:any;feedback:string;frames:{path:string;mime:string;name:string}[]}};
export async function generateLayout(ctx:GenerationContext){
 const {job,plan,images,dir,signal}=ctx;mkdirSync(dir,{recursive:true});
 if(!ctx.stage||!ctx.acceptSpace)throw Error('SPATIAL_GATE_REQUIRED：生成流程必须提供独立阶段记录和灰模验收');
 ctx.onProgress?.('逐图观察地标、遮挡与机位依据');ctx.observation=await ctx.stage('observe',()=>observeReferences(ctx));
 ctx.onProgress?.('规划空间与参考机位');
 let space=await ctx.stage('space',()=>callValidated({modelSettings:job.modelSettings,role:'scene-space',signal,maxTokens:9000,images,system:SPACE_PROMPT,schemaContext:{requirementIds:plan.requirements.map((r:any)=>r.id)},text:JSON.stringify({input:job.prompt,scoring:scoringGuidance(job.policy),referenceImages:images.length,generationBrief:job.generationBrief,observation:ctx.observation,plan,productionRules:SPEC.rules})},dir,v=>{if(!Array.isArray(v.spatialOpenings))throw Error('新空间规划必须声明spatialOpenings；无开口时填空数组');return bindObservedSpace(validateSpace(v,plan,images.length,job.complexity),ctx.observation)}));
 space={...space,value:await ctx.acceptSpace(space.value)};
 save(join(dir,'space.json'),space.value);ctx.onProgress?.('规划材质与光照');
 const surface=await ctx.stage('surface',()=>callValidated({modelSettings:job.modelSettings,role:'scene-surface',signal,maxTokens:6500,images,system:SURFACE_PROMPT,text:JSON.stringify({input:job.prompt,referenceImages:images.length,plan,space:space.value,materialBudget:job.generationBrief.budget.maximumMaterials,reusableTextures:textureCandidates(images.map(i=>digest(readFileSync(i.path))))})},dir,v=>{const layout=applySurface(space.value,v,plan,images.length,job.complexity);resolveTextureReuse(layout,images.map(i=>digest(readFileSync(i.path))));return v;}));
 save(join(dir,'surface.json'),surface.value);const result=applySurface(space.value,surface.value,plan,images.length,job.complexity);
 save(join(dir,'layout.json'),result);return result;
}
export function generationProvenance(ctx:GenerationContext,layout:SceneLayout){
 return {pipelineVersion:ctx.job.pipelineVersion,modelSettings:ctx.job.modelSettings,layoutSha256:digest(JSON.stringify(layout)),referenceSha256:ctx.images.map(i=>digest(readFileSync(i.path))),planSha256:digest(JSON.stringify(ctx.plan))};
}
export async function generateOneAsset(ctx:GenerationContext,layout:SceneLayout,brief:AssetBrief,textures:Record<string,Texture>){
 const folder=join(ctx.dir,'assets',brief.id);mkdirSync(folder,{recursive:true});
 const provenance=generationProvenance(ctx,layout);save(join(folder,'input.json'),{...provenance,brief});
 const started=Date.now(),readyAt=ctx.readyAt??started,key=assetKey(ctx.job,ctx.plan,layout,brief,textures);save(join(folder,'checkpoint.json'),{status:'running',readyAt,startedAt:started,...provenance});
 try{
  const revision=ctx.revision;
  if(revision)save(join(folder,'revision-input.json'),{previousAsset:revision.previousAsset,feedback:revision.feedback,frames:revision.frames.map(f=>({name:f.name,sha256:digest(readFileSync(f.path))}))});
  const result=await callValidated({modelSettings:ctx.job.modelSettings,role:'geometry-asset',signal:ctx.signal,maxTokens:14000,images:[...ctx.images,...(revision?.frames??[])],system:ASSET_PROMPT,text:JSON.stringify({...assetInput(ctx.job.prompt,ctx.plan,layout,brief,textures),...(revision?{revisionContext:{previousAsset:revision.previousAsset,feedback:revision.feedback,referenceImageCount:ctx.images.length,additionalFrameNames:revision.frames.map(f=>f.name),instructions:'原始参考图片在前，实际生成画面在后。根据明确差距修正当前资产，保留正确部分；实际画面不是新的参考原图，不能继承其错误。共享布局、身份和边界不变，只修改当前资产。'}}:{})})},folder,v=>validateAsset(v,brief,layout,textures).value);
  ctx.signal.throwIfAborted();const checked=validateAsset(result.value,brief,layout,textures);save(join(folder,'geometry.json'),result.value);save(join(folder,'spatial-openings.json'),checked.openings);
  save(join(folder,'checkpoint.json'),{status:'passed',readyAt,startedAt:started,endedAt:Date.now(),durationMs:Date.now()-started,...provenance,geometrySha256:digest(JSON.stringify(result.value)),bounds:checked.bounds,triangles:checked.triangles,quality:'not-assessed'});
  // 有画面反馈的候选仍须重新验收，不能仅凭几何合法覆盖原来的可复用资源。
  if(!revision)try{assetCache.put(key,result.value,{jobId:ctx.job.id,pipelineVersion:ctx.job.pipelineVersion,modelSettings:ctx.job.modelSettings,durationMs:Date.now()-started});}catch(error){save(join(folder,'cache-warning.json'),{error:String(error)});}
  return result.value;
 }catch(error){save(join(folder,'checkpoint.json'),{status:ctx.signal.aborted?'cancelled':'failed',readyAt,startedAt:started,endedAt:Date.now(),durationMs:Date.now()-started,...provenance,error:String(error)});throw error;}
}
