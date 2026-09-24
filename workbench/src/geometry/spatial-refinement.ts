import {inspectOpenings,openingSummary,assertAssetOpenings} from './openings';
import {readFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {callValidated,NoActionableChange} from '../contracts';
import {read,save,digest,listJobs,runDir,event} from '../store';
import {scoringGuidance} from '../quality';
import {compileGeometryProgram,type Pose} from './program';
import {validateScene,type SceneInput} from './scene-contract';
import {project} from './camera-fit';
import {GEOMETRY_RULES,geometryProgramSchema} from './program-schema';

export const SPATIAL_METHOD='spatial-refinement-v2';

const obj=(properties:any)=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const str={type:'string'},vector={type:'array',items:{type:'number'},minItems:3,maxItems:3};
const pose={position:vector,rotation:vector,scale:vector};
const arr=(items:any,maxItems:number)=>({type:'array',items,maxItems});
export function spatialRefinementSchema(){const geometry=geometryProgramSchema().properties.templates.items.properties.parts.items.properties;return obj({version:{type:'string',enum:[SPATIAL_METHOD]},reason:str,
 instances:arr(obj({id:str,...pose}),20),parts:arr(obj({templateId:str,partId:str,...pose}),48),
 shapes:arr(obj({templateId:str,partId:str,shape:geometry.shape,uvScale:geometry.uvScale}),24),
 cameras:arr(obj({name:str,referenceIndex:{type:['integer','null']},position:vector,target:vector,fov:{type:'number'}}),6),
 observations:arr(obj({issue:str,evidenceFrames:arr(str,8),expectedChange:str}),4)});}

export const SPATIAL_REFINEMENT_PROMPT=`这是通用三维场景的空间与构图修正步骤。所有说明使用中文，最终由当前 ForgeaX Engine 运行。原始参考图在前，实际场景截图在后。只返回 ${SPATIAL_METHOD} JSON；不使用工具，不生成代码。
openingDiagnostics包含实际网格的开口净空射线和遮挡部件，只是几何诊断，不等于画面评分；spatialOpenings是冻结的约束，不可通过缩小净空或删除约束规避。
本轮修正空间及造成空间偏差的结构几何，复用正确资产、全部材质、纹理与灯光。根据原图和独立验收，选择最多四个关联问题，优先解决占画面较大的结构比例、主体位置与尺度、视线遮挡、空间纵深和机位透视。观察点是辅助诊断，可能有误配，必须结合图片；未通过的相机拟合不是已验证答案。
输入包含每个模板和部件的完整shape、位姿、uvScale及真实编译范围，可以检查复合开口、相接边界和共享支撑。localBounds 是已经应用部件变换后、尚未应用实例变换的模板坐标包围盒；worldBounds 是实例在统一世界中的真实范围。projectedBounds 是16:9相机下的投影包围盒，不代表可见像素，也不证明遮挡。图像有黑边时比较场景内容区。
坐标以米为单位，Z向上。实例位姿作用于整个物体；部件位姿在模板局部坐标，依次施加缩放、绕X/Y/Z旋转、平移，最后再应用实例位姿。parts最多修改四类模板的48个现有部件，不能新增或删除；修改模板会影响它的全部实例。每个条目的position、rotation、scale是完整的新值，不是增量。修改范围必须涵盖相关边框、支撑和包边，防止连接断裂；同一物件应优先调整实例而非逐部件移动。
当源结构挡住参考图本来开敞的视线，应调整错误的构件尺寸与位置，恢复真实空间；不能仅把障碍藏到镜头外。保留承重、地面接触、所有关键物件与各机位的一致性，不得用极小缩放隐藏对象。各轴缩放相对原值只能在0.5–2倍以内。没有依据的部位保持不变。
shapes最多替换24个现有部件的完整几何及uvScale，parts与shapes合计最多影响四类模板；二者可以同时引用一个部件，分别改变位姿与局部形状。不可新增/删除模板、部件、实例或语义对象。必须保留各模板功能、厚度和支撑，所有需求仍要实现。局部缩放无法改变复合开口时，可以重写已有挤出轮廓或网格控制点，并同步相连边框、过梁和墙面，保持接缝连续。门洞应形成真正三维空隙；明确打开的门扇应保持铰接关系旋转开启，不能用封闭板面或极小尺寸代替洞口。此原则适用于输入中的所有建筑、家具和复合物体，不依赖预设类别。
先处理独立验收中最影响画幅和纵深的结构问题，再处理小配件。每个observations必须说明结构变更如何同时改善对应参考机位，避免为一张图破坏另一张图。shape只改变局部几何，不能将实例世界坐标再次写入局部控制点。保留正确原纹理；改变表面尺寸时通过uvScale维护原有合理纹理尺度。其余字段不变就返回空数组。
cameras只列要修改的已有机位，保留name和referenceIndex，fov为垂直视场弧度。相机不得进入墙体，不用远处俯视掩盖结构问题。优先从物体布局本身解决偏差，仅在参考透视确实不符时联动相机。
reason说明修正依据，observations列出具体问题、对应实际帧和预期可观察变化。没有明确可执行的改进时返回空修改数组并说明，管线将停止本路径。不得宣称已达到分数；修改后必须重新构建、截图与独立验收。
${GEOMETRY_RULES}`;

const assert=(ok:any,message:string)=>{if(!ok)throw Error(message)};
const poseOf=(p:Pose)=>({position:[...p.position],rotation:[...p.rotation],scale:[...p.scale]});
function bounds(positions:number[]){const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];positions.forEach((n,i)=>{min[i%3]=Math.min(min[i%3],n);max[i%3]=Math.max(max[i%3],n);});return {min,max};}
function corners(b:{min:number[];max:number[]}){return Array.from({length:8},(_,i)=>[0,1,2].map(k=>(i>>k)&1?b.max[k]:b.min[k]));}
/** 几何和真实范围同时提供，空间修正才能处理相互连接的复合结构。 */
export function spatialContext(source:SceneInput){
 const materials=source.program.materials.map(m=>({...m,textureId:null}));
 const templates=source.program.templates.map(t=>{
  const compiled=compileGeometryProgram({...source.program,materials,templates:[t],instances:[{id:'bounds',label:'模板局部范围',template:t.id,position:[0,0,0],rotation:[0,0,0],scale:[1,1,1],requirementIds:[]}]});
  return {id:t.id,localBounds:compiled.bounds,parts:t.parts.map((p,i)=>({id:p.id,...poseOf(p),shape:structuredClone(p.shape),uvScale:p.uvScale??[1,1],material:p.material,localBounds:bounds(compiled.meshes[i].geometry.positions)}))};
 });
 const compiled=compileGeometryProgram({...source.program,materials});
 const instances=source.program.instances.map(i=>{const worldBounds=bounds(compiled.meshes.filter(m=>m.entityId===i.id).flatMap(m=>m.geometry.positions));return {...i,worldBounds,projectedBounds:source.cameras.filter(c=>c.referenceIndex!==null).map(c=>{const pts=corners(worldBounds).map(p=>project(c,p));return {referenceIndex:c.referenceIndex,hasBehindCamera:pts.some(p=>p[2]<=.1),rect:[Math.min(...pts.map(p=>p[0])),Math.min(...pts.map(p=>p[1])),Math.max(...pts.map(p=>p[0])),Math.max(...pts.map(p=>p[1]))]};})};});
 return {spatialOpenings:source.spatialOpenings??null,openingDiagnostics:openingSummary(inspectOpenings(source)),name:source.program.name,worldBounds:compiled.bounds,templates,instances,cameras:source.cameras};
}
export function applySpatialRefinement(source:SceneInput,patch:any,plan:any,references:number,frameNames:string[]){
 assert(patch?.version===SPATIAL_METHOD&&typeof patch.reason==='string'&&patch.reason.trim(),'空间修正版本或依据无效');
 for(const [key,max] of Object.entries({instances:20,parts:48,shapes:24,cameras:6,observations:4}))assert(Array.isArray(patch[key])&&patch[key].length<=max,'空间修正数量超限：'+key);
 if(['instances','parts','shapes','cameras'].every(k=>patch[k].length===0))throw new NoActionableChange('空间修正没有任何可执行变化：'+patch.reason);
 assert(patch.observations.length>0&&patch.observations.every((o:any)=>typeof o.issue==='string'&&o.issue.trim()&&typeof o.expectedChange==='string'&&o.expectedChange.trim()&&Array.isArray(o.evidenceFrames)&&o.evidenceFrames.length>0&&o.evidenceFrames.every((f:string)=>frameNames.includes(f))),'空间修正缺少实际帧依据');
 assert(new Set([...patch.parts,...patch.shapes].map((p:any)=>p.templateId)).size<=4,'单轮空间修正最多影响四类资产');
 const next=structuredClone(source),seen=new Set<string>();
 const update=(key:string,target:Pose|undefined,p:any)=>{assert(target,'空间修正引用未知对象：'+key);assert(!seen.has(key),'空间修正对象重复：'+key);seen.add(key);
  for(const field of ['position','rotation','scale'])assert(Array.isArray(p[field])&&p[field].length===3&&p[field].every(Number.isFinite),'空间变换无效：'+key);
  assert(p.scale.every((n:number,k:number)=>n/target!.scale[k]>=.5&&n/target!.scale[k]<=2),'空间缩放相对原值必须在0.5–2倍：'+key);
  Object.assign(target!,poseOf(p));
 };
 for(const p of patch.instances)update('instance:'+p.id,next.program.instances.find(i=>i.id===p.id),p);
 for(const p of patch.parts)update('part:'+p.templateId+'/'+p.partId,next.program.templates.find(t=>t.id===p.templateId)?.parts.find(x=>x.id===p.partId),p);
 for(const p of patch.shapes){const key='shape:'+p.templateId+'/'+p.partId,target=next.program.templates.find(t=>t.id===p.templateId)?.parts.find(x=>x.id===p.partId);assert(target,'结构修正引用未知部件');assert(!seen.has(key),'结构修正部件重复');assert(Array.isArray(p.uvScale)&&p.uvScale.length===2,'结构修正缺少完整贴图比例');seen.add(key);target!.shape=structuredClone(p.shape);target!.uvScale=structuredClone(p.uvScale);}
 for(const p of patch.cameras){const key='camera:'+p.name,target=next.cameras.find(c=>c.name===p.name&&c.referenceIndex===p.referenceIndex);assert(target&&!seen.has(key),'空间修正引用未知或重复机位');seen.add(key);Object.assign(target!,{position:p.position,target:p.target,fov:p.fov});}
 validateScene(next,plan,references);for(const t of next.program.templates)assertAssetOpenings(next,t.id);compileGeometryProgram({...next.program,materials:next.program.materials.map(m=>({...m,textureId:null}))});if(digest(JSON.stringify(next))===digest(JSON.stringify(source)))throw new NoActionableChange('空间修正没有任何可执行变化');return next;
}
export function preferSpatialRefinement(review:any,policy:any,iteration:number,previousMethod?:string){
 const score=review?.dimensions?.find((d:any)=>d.id==='spatial')?.score;
 return iteration===0&&previousMethod!==SPATIAL_METHOD&&Number.isFinite(score)&&score<policy.score/20;
}
export async function refineSpatial(job:any,plan:any,images:{path:string;mime:string}[],dir:string,signal:AbortSignal,from?:{dir:string;jobId:string;version:any;iteration:number}){
 const sourceDir=from?.dir??runDir(job.reuseSceneFrom),sourceId=from?.jobId??job.reuseSceneFrom,source=read(join(sourceDir,'generated-scene.json')) as SceneInput,review=read(join(sourceDir,'review.json')),runtime=read(join(sourceDir,'runtime/runtime.json')),sourceDigest=digest(JSON.stringify(source)),folder=join(dir,'refinement');mkdirSync(folder,{recursive:true});
 const refs=images.map(i=>digest(readFileSync(i.path)));assert(JSON.stringify(refs)===JSON.stringify((job.images??[]).map((i:any)=>i.id)),'空间修正参考图与来源不一致');
 const frames=runtime.images.filter((f:string)=>/^reference-|^inspection-/.test(f));assert(frames.length>0,'空间修正缺少实际运行截图');
 for(const f of frames)assert(digest(readFileSync(join(sourceDir,'runtime',f)))===runtime.hashes[runtime.images.indexOf(f)],'空间修正画面摘要不符');
 const observation=listJobs().find(j=>j.cameraAlignment?.sourceDigest===sourceDigest&&JSON.stringify(j.cameraAlignment.referenceSha256)===JSON.stringify(refs))?.cameraAlignment;
 const input={originalPrompt:job.prompt,frozenPlan:plan,scoring:scoringGuidance(job.policy),referenceImages:images.length,actualFrameNames:frames,review,scene:spatialContext(source),diagnosticCorrespondences:observation?{sourceDigest,quality:'not-assessed',views:observation.views.map((v:any)=>({referenceIndex:v.referenceIndex,acceptedCameraFit:v.accepted,points:(v.rows??v.matches??[]).map((p:any)=>({label:p.label,meshId:p.meshId,observed:p.observed,expected:p.expected,confidence:p.confidence}))}))}:null};
 save(join(folder,'source.json'),{method:SPATIAL_METHOD,sourceJobId:sourceId,sourceIteration:from?.iteration??null,sourceVersion:from?.version??read(join(sourceDir,'job.json')).pipelineVersion,sourceDigest,referenceSha256:refs,frameNames:frames,qualityBefore:read(join(sourceDir,'quality.json')),modelSettings:job.modelSettings});save(join(folder,'spatial-input.json'),input);
 event(job,'refinement','优先修正空间与复合结构；复用既有资产和材质，允许有依据地调整现有构件的形状与机位');
 const result=await callValidated({role:'scene-spatial-refine',modelSettings:job.modelSettings,signal,maxTokens:16000,images:[...images,...frames.map((f:string)=>({path:join(sourceDir,'runtime',f),mime:'image/png'}))],system:SPATIAL_REFINEMENT_PROMPT,text:JSON.stringify(input)},folder,v=>{applySpatialRefinement(source,v,plan,images.length,frames);return v;});
 signal.throwIfAborted();assert(digest(JSON.stringify(read(join(sourceDir,'generated-scene.json'))))===sourceDigest,'修正期间原场景发生变化');
 const scene=applySpatialRefinement(source,result.value,plan,images.length,frames),changedTemplates=scene.program.templates.filter((t,i)=>JSON.stringify(t)!==JSON.stringify(source.program.templates[i])).length;
 save(join(folder,'patch.json'),result.value);save(join(folder,'scene.json'),scene);save(join(folder,'receipt.json'),{method:result.value.version,sourceJobId:sourceId,sourceDigest,sceneDigest:digest(JSON.stringify(scene)),changedTemplates,unchangedTemplates:scene.program.templates.length-changedTemplates,addedTemplates:0,reusedMaterials:scene.program.materials.length,quality:'not-assessed',modelReceipt:result.receipt});
 job.visualRefinement={method:result.value.version,sourceJobId:sourceId,sourceIteration:from?.iteration??null,sourceScore:read(join(sourceDir,'quality.json')).score,changedTemplates,unchangedTemplates:scene.program.templates.length-changedTemplates,addedTemplates:0};return scene;
}
