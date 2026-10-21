import {matchingGuidance} from '../matching-level';
import {GEOMETRY_SCOPES,validGeometryScope,validateVoxelLandmarkCoverage,STRICT_VOXEL_CONSTRUCTION,VOXEL_OBSERVATION_COVERAGE_GUIDANCE} from '../voxel/landmark-coverage';
import {validRect,contentBox} from './reference-projection';
import {savedStage,persistStageReuse} from './saved-stage';
import {RELATION_SCALES,relationScaleRule,VOXEL_RELATION_SCALE} from './voxel-acceptance';
import {parseModelJson} from '../provider';
import {callValidated} from '../contracts';
import {join} from 'node:path';
import {mkdirSync,existsSync,readFileSync} from 'node:fs';
import {save,read,runDir,digest} from '../store';
const str={type:'string'},num={type:'number'},obj=(properties:any)=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false}),arr=(items:any)=>({type:'array',items});
export type ObservationOptions={strictVoxel?:boolean;relationScale?:boolean};
export const OBSERVATION_LANDMARK_LIMIT=50,OBSERVATION_RELATION_LIMIT=24;
/** The caps are stated up front: a complex scene otherwise overruns both, and the single schema correction only ever saw the first violation. */
export const OBSERVATION_LIMIT_GUIDANCE=`landmarks 至多 ${OBSERVATION_LANDMARK_LIMIT} 项、relations 至多 ${OBSERVATION_RELATION_LIMIT} 项。物体多时把细小同类物（碎石、灌木、栅栏段、灯具等）合并为有证据的组地标，relations 只保留决定构图的关系，不要逐对罗列。`;
const capped=(schema:any,max:number)=>({...schema,minItems:1,maxItems:max});
export const RELATION_SCALE_GUIDANCE='relations 每项另设 scale：layout 是建筑/主体/大构件之间的左右前后、尺度比例、遮挡、通道、纵深与整体轮廓，灰模阶段必须做对；detail 是单个立面或单个物体上的窗洞与开口排布、招牌/外机/管线/灯具等附着小件的分布与叠放、店面与装饰等局部构造，由资产阶段实现。只按关系描述的尺度判断，不按重要性；同一关系同时含两类时拆成两条。至少一条关键关系为 layout。';
export const observationSchema=(count=5,options:ObservationOptions={})=>obj({landmarks:capped(arr(obj({id:str,label:str,critical:{type:'boolean'},...(options.strictVoxel?{geometryScope:{type:'string',enum:[...GEOMETRY_SCOPES]}}:{}),views:arr(obj({referenceIndex:{type:'integer',minimum:1,maximum:count},box:{type:'array',items:num,minItems:4,maxItems:4},extent:{type:'string',enum:['complete','occluded','partial']},evidence:str}))})),OBSERVATION_LANDMARK_LIMIT),relations:capped(arr(obj({id:str,description:str,critical:{type:'boolean'},...(options.relationScale?{scale:{type:'string',enum:[...RELATION_SCALES]}}:{}),landmarkIds:arr(str)})),OBSERVATION_RELATION_LIMIT),cameras:arr(obj({referenceIndex:{type:'integer',minimum:1,maximum:count},evidence:str,uncertainty:str,contentRect:{type:'array',items:num,minItems:4,maxItems:4}})),assumptions:arr(str)});
/** 仅在机位完整且明确覆盖 0..N-1 时转换旧输出的编号，不推断混合编号。 */
export function normalizeObservationIndices(value:any,count:number){const v=structuredClone(value),ids=v.cameras?.map(c=>c.referenceIndex);if(ids?.length===count&&new Set(ids).size===count&&ids.every(n=>Number.isInteger(n)&&n>=0&&n<count)&&v.landmarks?.every(l=>l.views?.every(r=>Number.isInteger(r.referenceIndex)&&r.referenceIndex>=0&&r.referenceIndex<count))){for(const c of v.cameras)c.referenceIndex++;for(const l of v.landmarks)for(const r of l.views)r.referenceIndex++;}return v;}
/** Both count violations go into one message so the single correction round can fix them together. */
function observationCountErrors(v:any){
 const errors=[];
 if(!v?.landmarks?.length||v.landmarks.length>OBSERVATION_LANDMARK_LIMIT||new Set(v.landmarks.map((l:any)=>l.id)).size!==v.landmarks.length)errors.push(`观察记录需要 1–${OBSERVATION_LANDMARK_LIMIT} 个不重复地标（当前 ${v?.landmarks?.length??0} 个）`);
 if(!v?.relations?.length||v.relations.length>OBSERVATION_RELATION_LIMIT||new Set(v.relations.map((r:any)=>r.id)).size!==v.relations.length)errors.push(`关系观察须为 1–${OBSERVATION_RELATION_LIMIT} 项（当前 ${v?.relations?.length??0} 项）`);
 return errors;
}
export function validateObservations(v:any,count:number,options:ObservationOptions={}){const countErrors=observationCountErrors(v),overflow=v?.landmarks?.length>OBSERVATION_LANDMARK_LIMIT||v?.relations?.length>OBSERVATION_RELATION_LIMIT;if(countErrors.length)throw Error(countErrors.join('；')+(overflow?'。合并细小同类物为组地标，只保留决定构图的关系，关系引用的地标 ID 须仍存在':''));for(const l of v.landmarks){if(options.strictVoxel&&!validGeometryScope(l.geometryScope))throw Error('严格体素观察需声明有效geometryScope：'+l.id);if(l.geometryScope!==undefined&&!validGeometryScope(l.geometryScope))throw Error('地标geometryScope无效：'+l.id);if(!l.label?.trim()||typeof l.critical!=='boolean'||!l.views?.length)throw Error('地标必须有图片证据');for(const r of l.views)if(!Number.isInteger(r.referenceIndex)||r.referenceIndex<1||r.referenceIndex>count||!r.evidence?.trim()||r.box?.length!==4||r.box.some(n=>!Number.isFinite(n)||n<0||n>1)||r.box[0]>=r.box[2]||r.box[1]>=r.box[3])throw Error('地标 '+l.id+' 的图片证据无效：referenceIndex 必须从 1 开始，第一张是 1，范围 1..'+count+'，当前为 '+r.referenceIndex+'；box 为 [左,上,右,下]，归一化且右>左、下>上');}for(const r of v.relations){if(!r.description?.trim()||!r.landmarkIds?.length||r.landmarkIds.some(id=>!v.landmarks.some(l=>l.id===id)))throw Error('关系须引用图中地标');if(options.relationScale&&!RELATION_SCALES.includes(r.scale))throw Error('关系需声明 scale=layout/detail：'+r.id);if(r.scale!==undefined&&!RELATION_SCALES.includes(r.scale))throw Error('关系 scale 无效：'+r.id);}if(options.relationScale&&!v.relations.some(r=>r.critical&&r.scale==='layout'))throw Error('至少一条关键关系须为 layout');if(v.cameras?.length!==count||new Set(v.cameras.map(c=>c.referenceIndex)).size!==count||v.cameras.some(c=>!Number.isInteger(c.referenceIndex)||c.referenceIndex<1||c.referenceIndex>count||!c.evidence?.trim()))throw Error('每张图必须有独立机位依据');for(const c of v.cameras){if(c.contentRect!==undefined&&!validRect(c.contentRect))throw Error('原图内容区无效');}for(const l of v.landmarks)for(const r of l.views){if(r.extent!==undefined&&!['complete','occluded','partial'].includes(r.extent))throw Error('地标完整性标记无效');const c=v.cameras.find(c=>c.referenceIndex===r.referenceIndex);if(c.contentRect)contentBox(r.box,c.contentRect);}return v;}
/** A recovery may save only its scene: walk the same-input recovery chain for the original observation, never another case's. */
export function chainedObservation(sourceJob:any,imageIds:any):{observation:any;jobId:string}|null{
 let cursor:any=sourceJob;const seen=new Set();
 while(cursor&&!seen.has(cursor.id)&&seen.size<20){seen.add(cursor.id);if(JSON.stringify(cursor.images?.map((i:any)=>i.id))!==JSON.stringify(imageIds))break;
  const file=join(runDir(cursor.id),'generation/reference-observations.json');if(existsSync(file))return {observation:read(file),jobId:cursor.id};
  const parent=cursor.recoverySourceJobId??cursor.reuseSceneFrom??(cursor.retryRoot!==cursor.id?cursor.retryRoot:null);cursor=parent&&existsSync(join(runDir(parent),'job.json'))?read(join(runDir(parent),'job.json')):null;
 }
 return null;
}
export async function observeReferences(ctx:any,request:typeof callValidated=callValidated){mkdirSync(ctx.dir,{recursive:true});
 const options:ObservationOptions={strictVoxel:ctx.job.voxelConstructionVersion===STRICT_VOXEL_CONSTRUCTION,relationScale:relationScaleRule(ctx.job)};
 // Read untagged so an observation saved before the relation-scale policy can still be reused; its relations are then tagged once.
 const untagged=(v:any)=>!options.relationScale||v.relations.every((r:any)=>r.scale===undefined);
 const saved=savedStage(ctx,'scene-observation',v=>{const x=validateObservations(normalizeObservationIndices(v,ctx.images.length),ctx.images.length,{...options,relationScale:false});return untagged(x)?x:validateObservations(x,ctx.images.length,options);},true);
 if(saved){persistStageReuse(ctx,'scene-observation',saved);save(join(ctx.dir,'observation-reuse.json'),{...saved.proof,indexNormalization:JSON.stringify(JSON.parse(saved.text))!==JSON.stringify(saved.value)?'0-based-to-1-based':'none'});if(ctx.job.stages?.observe)ctx.job.stages.observe.reused=true;
  const value=options.relationScale&&untagged(saved.value)?await tagRelationScales(ctx,saved,request,options):saved.value;save(join(ctx.dir,'reference-observations.json'),value);return value;}

 const r=await request({role:'scene-observation',modelSettings:ctx.job.modelSettings,signal:ctx.signal,maxTokens:9000,images:ctx.images,schemaContext:{referenceCount:ctx.images.length,...(options.strictVoxel?{strictVoxel:true}:{}),...(options.relationScale?{relationScale:true}:{})},system:matchingGuidance(ctx.job)+(options.strictVoxel?'\n'+VOXEL_OBSERVATION_COVERAGE_GUIDANCE:'')+(options.relationScale?'\n'+RELATION_SCALE_GUIDANCE:'')+'\n'+OBSERVATION_LIMIT_GUIDANCE+'\n先观察参考图，不设计或生成场景。逐张图记录可见地标与遮挡，再确认跨视角对应。同一物体的不同视角共用地标 ID；只看到一部分就只陈述可见部分，不能凭题材添加未见家具、房间或通道。landmarks 包含 id、中文 label、critical 和各 views，view 另含 extent=complete/occluded/partial（只在可见完整轮廓时标 complete），view 包含 referenceIndex（从 1 开始，第一张是 1、第二张是 2，禁止使用 0）、box=[左,上,右,下]（完整输入图归一化坐标，排除黑边与水印）、具体 evidence。覆盖建筑大结构、主要物体及地面；细小同类零散物可按有证据的组记录。relations 只包含图片能支持的前后左右、尺度比例、遮挡、开口与纵深；绑定 landmarkIds，关键构图关系设 critical。cameras 每张一项，记录观察方向、透视线与高度的可见依据和 uncertainty、contentRect=[左,上,右,下]（完整原图归一化，去掉黑边与水印后的实际场景内容区；无边框为[0,0,1,1]），暂不编造绝对坐标。看不见的背面与尺度猜测只记 assumptions。全部使用中文，只输出 JSON。',text:JSON.stringify({prompt:ctx.job.prompt,referenceCount:ctx.images.length,requirements:ctx.plan.requirements})},ctx.dir,v=>validateObservations(v,ctx.images.length,options));save(join(ctx.dir,'reference-observations.json'),r.value);return r.value;}
export const relationScaleTagSchema=()=>obj({relations:arr(obj({id:str,scale:{type:'string',enum:[...RELATION_SCALES]}}))});
/** Only adds scale to each frozen relation; ids, descriptions, criticality and landmarks stay as observed. */
export function applyRelationScales(observation:any,tags:any){
 const relations=observation.relations;
 if(!Array.isArray(tags?.relations)||tags.relations.length!==relations.length||new Set(tags.relations.map((t:any)=>t.id)).size!==relations.length)throw Error('须为每条冻结关系各给出一次 scale');
 return {...observation,relations:relations.map((r:any)=>{const t=tags.relations.find((t:any)=>t.id===r.id);if(!t)throw Error('缺少关系 scale：'+r.id);return {...r,scale:t.scale};})};
}
/**
 * A diagnosed continuation under the relation-scale policy keeps the source's frozen observation, which predates the scale field. One
 * text-only call tags those relations; a recovery of the continuation reuses the tags already saved on its chain instead of asking again.
 */
async function tagRelationScales(ctx:any,saved:any,request:typeof callValidated,options:ObservationOptions){
 const validate=(tags:any)=>validateObservations(applyRelationScales(saved.value,tags),ctx.images.length,options);
 for(const id of saved.proof.chain as string[]){
  const folder=join(runDir(id),'generation','relation-scale'),file=join(folder,'scene-observation-response.txt');
  if(!existsSync(file)||!existsSync(join(folder,'scene-observation-receipt.json')))continue;
  const text=readFileSync(file,'utf8');
  try{const value=validate(parseModelJson(text));save(join(ctx.dir,'relation-scale.json'),{version:VOXEL_RELATION_SCALE,reusedFrom:id,responseSha256:digest(text)});return value;}catch{}
 }
 const dir=join(ctx.dir,'relation-scale');mkdirSync(dir,{recursive:true});
 const r=await request({role:'scene-observation',modelSettings:ctx.job.modelSettings,signal:ctx.signal,maxTokens:3000,schemaContext:{relationScaleTags:true},
  system:RELATION_SCALE_GUIDANCE+'\n这些关系已从参考图观察并冻结。只为每条关系给出 scale，每个 id 恰好一次；不得新增、删除、拆分或改写关系。全部使用中文，只输出 JSON。',
  text:JSON.stringify({landmarks:saved.value.landmarks.map((l:any)=>({id:l.id,label:l.label})),relations:saved.value.relations.map((r:any)=>({id:r.id,description:r.description,critical:r.critical,landmarkIds:r.landmarkIds}))})},dir,validate);
 save(join(ctx.dir,'relation-scale.json'),{version:VOXEL_RELATION_SCALE,sourceObservation:saved.proof.sourceJobId});
 return r.value;
}
/** A seed space frozen before the policy takes the scales its own observation now carries; a space that already has them is left alone. */
export function withObservedRelationScales(space:any,observation:any){
 if(!observation?.relations?.some((r:any)=>r.scale!==undefined)||space.spatialRelations?.some((r:any)=>r.scale!==undefined))return space;
 return {...space,spatialRelations:space.spatialRelations.map((x:any)=>{const r=observation.relations.find((r:any)=>r.id===x.id);return r?.scale===undefined?x:{...x,scale:r.scale};})};
}
/** Walls the pipeline adds to close an interior (interior-enclosure.ts); no landmark binds them and the space assumption names them. */
export const INFERRED_ENCLOSURE_ID=/^enclosure_(floor_)?(pos|neg)[xy]$/;
export function bindObservedSpace(space:any,observation:any){const bindings=space.observedBindings;if(!Array.isArray(bindings)||bindings.length!==observation.landmarks.length||new Set(bindings.map(b=>b.landmarkId)).size!==bindings.length)throw Error('每个已观察地标都必须绑定空间实例');for(const l of observation.landmarks){const b=bindings.find(b=>b.landmarkId===l.id);if(!b?.instanceIds?.length||b.instanceIds.some(id=>!space.program.instances.some(i=>i.id===id)))throw Error('地标缺少真实实例绑定：'+l.id);}for(const i of space.program.instances)if(!bindings.some(b=>b.instanceIds.includes(i.id))&&!INFERRED_ENCLOSURE_ID.test(i.id))throw Error('实例没有原图地标依据，禁止凭空添加：'+i.id);if(space.spatialRelations?.length!==observation.relations.length)throw Error('不能删除或新增已冻结的空间关系');for(const r of observation.relations){const x=space.spatialRelations.find(x=>x.id===r.id);if(!x||x.critical!==r.critical||x.description!==r.description||x.scale!==r.scale)throw Error('不得更改观察关系或降低关键性：'+r.id);const expected=[...new Set(r.landmarkIds.flatMap(id=>bindings.find(b=>b.landmarkId===id).instanceIds))];if(JSON.stringify([...x.instanceIds].sort())!==JSON.stringify(expected.sort()))throw Error('关系实例必须对应原地标：'+r.id);}validateVoxelLandmarkCoverage(space,observation);return space;}

/** Materialize immutable observed constraints without asking the model to copy them. */
export function completeObservedSpacePlan(value:any,observation:any){
 // Saved v1 outputs still have to prove their original relations. Never repair
 // a changed critical flag or missing historical relation during recovery.
 if(value?.version==='scene-space-v1')return bindObservedSpace(value,observation);
 if(value?.version!=='scene-space-plan-v2')throw Error('空间规划输出版本无效');
 if(Object.hasOwn(value,'spatialRelations'))throw Error('新空间规划不能覆盖已冻结关系');
 if(!Array.isArray(value.observedBindings))throw Error('每个已观察地标都必须绑定空间实例');
 if(!Array.isArray(observation?.relations)||!observation.relations.length)throw Error('缺少已冻结的空间关系');
 const spatialRelations=observation.relations.map((relation:any)=>{
  if(typeof relation.critical!=='boolean'||!relation.description?.trim()||!Array.isArray(relation.landmarkIds)||!relation.landmarkIds.length)throw Error('已冻结空间关系无效：'+relation.id);
  const instanceIds=[...new Set(relation.landmarkIds.flatMap((id:string)=>{
   const binding=value.observedBindings.find((b:any)=>b.landmarkId===id);
   if(!Array.isArray(binding?.instanceIds)||!binding.instanceIds.length)throw Error('地标缺少真实实例绑定：'+id);
   return binding.instanceIds;
  }))];
  return {id:relation.id,description:relation.description,critical:relation.critical,...(relation.scale!==undefined?{scale:relation.scale}:{}),instanceIds};
 });
 return bindObservedSpace({...value,version:'scene-space-v1',spatialRelations},observation);
}
