import {repairBudget,LEGACY_REPAIR_BUDGET} from './repair-budget';
import {observeOpenings} from './opening-observations';
import {refinementFocus,assertRefinementFocus,FOCUSED_REFINEMENT_PROMPT} from './refinement-focus';
import {refinementBaseline} from './refinement-baseline';
import {inspectOpenings,openingSummary,assertAssetOpenings} from './openings';
import {scoringGuidance} from '../quality';
import {repairGoalContext,repairGoalReferences,validateRepairGoals,assertPlannedRepair,REPAIR_GOALS_PROMPT} from './repair-goals';
import {readFileSync,existsSync,mkdirSync} from 'node:fs';
import {join,relative} from 'node:path';
import {callValidated} from '../contracts';
import {read,save,digest,runDir,event} from '../store';
import {COMPLEXITIES} from '../complexity';
import {sceneSchema,validateScene,type SceneInput} from './scene-contract';
import {compileGeometryProgram,validateGeometryProgram,GEOMETRY_LIMITS} from './program';
import {GEOMETRY_RULES} from './program-schema';
import {textureCandidates,resolveTextureReuse} from './texture-library';
import {repairHistory} from './repair-history';
import {prepareVisibilityEvidence} from './visibility-evidence';
import {VISIBILITY_PROMPT} from './visibility';
import {cameraChangeHistory} from './camera-change-history';
import {CAMERA_CHANGE_PROMPT} from './camera-change';

const obj=(properties:any)=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const arr=(items:any,maxItems=64)=>({type:'array',items,maxItems});
const str={type:'string'};
export function refinementSchema(level:keyof typeof COMPLEXITIES='simple'){
 const budget=repairBudget(level);
 const s=sceneSchema().properties,p=s.program.properties;
 return obj({version:{type:'string',enum:['scene-refinement-v3']},reason:str,
  instances:arr(p.instances.items),cameras:arr(s.cameras.items,6),materials:arr(p.materials.items,24),
  removeInstances:arr(obj({instanceId:str,reason:str}),16),
  parts:arr(obj({templateId:str,part:p.templates.items.properties.parts.items}),budget.parts),
  removeParts:arr(obj({templateId:str,partId:str,reason:str}),budget.removeParts),
  addTemplates:arr(p.templates.items,4),addEntities:arr(s.entities.items,16),
  textures:arr(s.textures.items,4),textureReuse:arr(s.textureReuse.items,8),
  lighting:{anyOf:[s.lighting,{type:'null'}]},assumptions:arr(str,24)});
}
const require=(ok:any,message:string)=>{if(!ok)throw Error(message)};
const unique=(items:any[],key:(x:any)=>string,label:string)=>{require(Array.isArray(items)&&new Set(items.map(key)).size===items.length,label+'重复或无效')};
function upsert(target:any[],updates:any[]){for(const v of updates){const at=target.findIndex(x=>x.id===v.id);if(at<0)target.push(v);else target[at]=v;}}
/** 原场景不可变；所有补丁经过完整几何、来源与复杂度契约，再允许导出。 */
export function applyRefinement(source:SceneInput,patch:any,plan:any,references:number,level:keyof typeof COMPLEXITIES){
 require(['scene-refinement-v1','scene-refinement-v2','scene-refinement-v3'].includes(patch?.version)&&typeof patch.reason==='string'&&patch.reason.trim(),'场景修正版本或依据无效');
 // v1 是已持久化的历史修改契约；恢复时不能将其解释为支持删除实例的新协议。
 require(patch.version!=='scene-refinement-v1'||patch.removeInstances===undefined,'历史修正协议不支持删除实例');
 const removals=patch.version!=='scene-refinement-v1'?patch.removeInstances:[];
 require(Array.isArray(removals)&&removals.length<=16,'删除实例数量超限或缺失');
 unique(removals,x=>x.instanceId,'删除实例');
 const edits=patch.version==='scene-refinement-v3'?repairBudget(level):LEGACY_REPAIR_BUDGET;
 const limits:any={instances:64,cameras:6,materials:24,parts:edits.parts,removeParts:edits.removeParts,addTemplates:4,addEntities:16,textures:4,textureReuse:8,assumptions:24};
 for(const [key,max] of Object.entries(limits))require(Array.isArray(patch[key])&&patch[key].length<=(max as number),'修正数量超限：'+key);
 for(const key of ['instances','materials','addTemplates','textures'])unique(patch[key],x=>x.id,key);
 unique(patch.parts,x=>x.templateId+'/'+x.part?.id,'部件');unique(patch.removeParts,x=>x.templateId+'/'+x.partId,'删除部件');
 unique(patch.textureReuse,x=>x.textureId,'纹理复用');unique(patch.addEntities,x=>x.instanceId,'语义实体');
 unique(patch.cameras,x=>x.referenceIndex===null?x.name:'ref:'+x.referenceIndex,'相机');
 const next=structuredClone(source),p=next.program;
 for(const removal of removals){
  require(source.program.instances.some(i=>i.id===removal.instanceId)&&typeof removal.reason==='string'&&removal.reason.trim(),'删除实例缺少原对象或依据');
  require(!patch.instances.some((i:any)=>i.id===removal.instanceId)&&!patch.addEntities.some((e:any)=>e.instanceId===removal.instanceId),'同一实例不能同时删除与修改或新增');
  require(!(source.spatialOpenings??[]).some(o=>o.instanceId===removal.instanceId),'不能删除冻结开口所属实例');
 }
 const removedIds=new Set(removals.map((r:any)=>r.instanceId));
 p.instances=p.instances.filter(i=>!removedIds.has(i.id));next.entities=next.entities.filter(e=>!removedIds.has(e.instanceId));
 for(const t of patch.addTemplates)require(!p.templates.some(x=>x.id===t.id),'新增模板不能覆盖已有资产');
 p.templates.push(...patch.addTemplates);
 for(const r of patch.removeParts){const t=p.templates.find(x=>x.id===r.templateId);require(t&&t.parts.some(x=>x.id===r.partId)&&typeof r.reason==='string'&&r.reason.trim(),'删除部件缺少原对象或依据');require(!patch.parts.some((x:any)=>x.templateId===r.templateId&&x.part.id===r.partId),'同一部件不能同时删除和替换');t!.parts=t!.parts.filter(x=>x.id!==r.partId);}
 for(const u of patch.parts){const t=p.templates.find(x=>x.id===u.templateId);require(t,'修改了不存在的模板');upsert(t!.parts,[u.part]);}
 const originalIds=new Set(p.instances.map(i=>i.id));
 for(const e of patch.addEntities)require(!originalIds.has(e.instanceId)&&patch.instances.some((i:any)=>i.id===e.instanceId),'新增语义实体必须对应新增实例');
 for(const i of patch.instances)require(originalIds.has(i.id)||patch.addEntities.some((e:any)=>e.instanceId===i.id),'新增实例缺少语义实体');
 upsert(p.instances,patch.instances);for(const t of patch.addTemplates)require(p.instances.some(i=>i.template===t.id),'新增模板必须有实际场景实例');next.entities.push(...patch.addEntities);upsert(p.materials,patch.materials);upsert(next.textures,patch.textures);
 for(const c of patch.cameras){const at=next.cameras.findIndex(x=>c.referenceIndex===null?x.referenceIndex===null&&x.name===c.name:x.referenceIndex===c.referenceIndex);require(at>=0,'修正只能调整已有参考或检查机位');next.cameras[at]=c;}
 next.textureReuse=(next.textureReuse??[]).filter(t=>!patch.textures.some((u:any)=>u.id===t.textureId)||patch.textureReuse.some((u:any)=>u.textureId===t.textureId));for(const t of patch.textureReuse){const at=next.textureReuse.findIndex(x=>x.textureId===t.textureId);if(at<0)next.textureReuse.push(t);else next.textureReuse[at]=t;}
 // 材质换用新图后，退役的旧声明不继续占据本轮贴图预算；历史来源和物理资产仍保留。
 const previouslyUsed=new Set(source.program.materials.map(m=>m.textureId).filter(Boolean)),stillUsed=new Set(p.materials.map(m=>m.textureId).filter(Boolean));
 const retired=new Set(source.textures.filter(t=>previouslyUsed.has(t.id)&&!stillUsed.has(t.id)).map(t=>t.id));
 next.textures=next.textures.filter(t=>!retired.has(t.id));next.textureReuse=next.textureReuse.filter(t=>!retired.has(t.textureId));
 if(patch.lighting!==null)next.lighting=patch.lighting;
 next.assumptions.push(...patch.assumptions);
 validateScene(next,plan,references);
 for(const t of p.templates)assertAssetOpenings(next,t.id);
 const budget=COMPLEXITIES[level],entities=next.entities.filter(e=>e.role!=='ground'),parts=p.instances.reduce((n,i)=>n+p.templates.find(t=>t.id===i.template)!.parts.length,0);
 require(parts<=budget.maxParts&&p.materials.length<=budget.maxMaterials,'修正后的部件或材质超过原复杂度预算');
 require(entities.length>=budget.minEntities&&entities.length<=budget.maxEntities&&new Set(entities.map(e=>e.category)).size>=budget.minKinds,'修正后未满足原复杂度');
 require(digest(JSON.stringify({...next,assumptions:[]}))!==digest(JSON.stringify({...source,assumptions:[]})),'没有任何可执行的场景变化');
 return next;
}

export const REFINEMENT_PROMPT=`这是通用三维场景的视觉反馈修正步骤。原始参考图在前，当前 ForgeaX Engine 实际截图在后。根据原始需求、独立验收的明确失败和真实画面，输出 scene-refinement-v3 增量数据。不要调用工具，不输出代码，不改变输入要求或评分门槛。所有说明使用中文。
先修正整体空间、关键轮廓、可见环境和入光层次，再修小配件。openingDiagnostics为已编译几何的净空与后景射线诊断，不是质量结论；blocked给出实际遮挡部件，missing-background指出规划需要可见环境却无不透明几何。结合原图和实际画面修复，不删除或缩小sourceScene.spatialOpenings约束。保持同一空间、多机位中的物件身份一致。可见门窗外的局部环境也是画面内容；可用具有真实深度、体积与视差的必要补全，不要继续留下统一空色，不得用整张参考图或室内大面板冒充三维。仅相机调整无法纠正的布局错误必须调整实例或相关部件，不能藏到镜头外。
未改部分完全复用。instances 为要更新或新增的完整实例，新增实例必须同时给 addEntities。removeInstances最多16项，每项给出已选目标中instanceId和中文reason；只有原图和实际截图支持其为多余或错误重复的物体才能移除。解释可见数量、遮挡或空间关系的证据，不能因为暂时看不见就删除，也不能通过移到镜头外代替移除。不得移除冻结开口的宿主、破坏关键需求或明确数量；程序仅从新场景移除实例及对应entities，保留原场景和共享资产，不删除物理资源。同一实例不能同时更新与移除。cameras 仅列需调整的已有机位，保留referenceIndex。materials 为更新或新增的完整PBR材质，现有ID保持。parts 按templateId与part.id替换或添加部件；removeParts 仅删除有明确错误的部件并说明理由；addTemplates 最多4个新模板，已有模板不可整体覆盖。所有改变都必须在原复杂度和三角形预算内。不要为了显得复杂而加无关物体。repairBudget只规定本轮可编辑多少已有部件，不增加最终场景部件或实体上限；关联结构可一起调整，无需为历史的小编辑额度永久冻结已知错误的相邻对象。
textures最多4个新增或修正的局部表面声明，必须绑定到repairGoals已选materialIds或已获准新增几何的新材质。共享纹理的所有引用材质都必须在范围内，否则给已选材质建立独立声明，不改变其他表面；修改裁切会取消该纹理原有复用绑定，除非本次textureReuse同时明确指定资源；textureReuse最多8个本次候选中的资源引用。候选有明确来源，不能捏造ID、图片、路径。局部贴图只能映射到相应真实物体表面，不能替代整个房间或遮挡缺失空间。保留正确的原纹理与资产。lighting 为完整光照配置，保留则null；其余没改的字段填空数组。
关注真实截图中的纹理尺度、材质过黑、入光方向、明暗层次、轮廓与透视。表面分层应留出可见精度安全间隔，避免几乎共面的覆盖。实例/资产摘要中的meshBounds是实际编译几何的局部范围；估计相机和尺寸要结合输入图，不照抄已知错误。
reason说明本轮可观察的改变及依据；assumptions只记新增的不确定性。不能声称已执行构建或达到某个分数，最终由重新运行后的独立评分决定。
${VISIBILITY_PROMPT}
${CAMERA_CHANGE_PROMPT}
${GEOMETRY_RULES}`;

export async function refineScene(job:any,plan:any,images:{path:string;mime:string}[],dir:string,signal:AbortSignal,from?:{dir:string;jobId:string;version:any;iteration:number}){
 const sourceDir=from?.dir??runDir(job.reuseSceneFrom),sourceId=from?.jobId??job.reuseSceneFrom,original=read(join(sourceDir,'generated-scene.json')) as SceneInput,textures=read(join(sourceDir,'materials/texture-registry.json'));
 const sourceDigest=digest(JSON.stringify(original)),refs=images.map(i=>digest(readFileSync(i.path))),folder=join(dir,'refinement');mkdirSync(folder,{recursive:true});
 require(JSON.stringify(refs)===JSON.stringify((job.images??[]).map((i:any)=>i.id)),'参考图片内容与来源不一致');
 const runtime=read(join(sourceDir,'runtime/runtime.json')),frameNames=runtime.images.filter((x:string)=>/^reference-|^inspection-/.test(x));require(frameNames.length>0,'缺少用于修正的实际画面');
 for(const f of frameNames)require(digest(readFileSync(join(sourceDir,'runtime',f)))===runtime.hashes[runtime.images.indexOf(f)],'修正画面摘要不符');
 const baseline=from?{review:read(join(sourceDir,'review.json')),quality:read(join(sourceDir,'quality.json')),reassessed:false}:await refinementBaseline(job,read(join(sourceDir,'job.json')),sourceDir,folder,signal);
 const review=baseline.review,source=await observeOpenings(job,original,review,images,frameNames.map((name:string)=>({name,path:join(sourceDir,'runtime',name),mime:'image/png'})),folder,signal);
 const openingDiagnostics=openingSummary(inspectOpenings(source));
 const previousRepairs=repairHistory(job,original,refs);save(join(folder,'repair-history.json'),previousRepairs);
 const cameraChangeFeedback=cameraChangeHistory(sourceDir,original,textures);
 if(cameraChangeFeedback){save(join(folder,'camera-change.json'),cameraChangeFeedback);event(job,'camera-change','已核对历史来源，对比 '+cameraChangeFeedback.views.length+' 个调整机位的同几何遮挡变化；仅辅助修正，不改写评分');}
 const visibility=prepareVisibilityEvidence(source,textures,folder,sourceDir,runtime,frameNames);
 const inputImages=[...images,...frameNames.map((name:string)=>({path:join(sourceDir,'runtime',name),mime:'image/png'})),...visibility.images];
 const editBudget=repairBudget(job.complexity),sourceGeometry=validateGeometryProgram(source.program);
 const geometryBudget={currentEstimatedTriangles:sourceGeometry.triangles,maxEstimatedTriangles:GEOMETRY_LIMITS.triangles,remainingEstimatedTriangles:GEOMETRY_LIMITS.triangles-sourceGeometry.triangles,currentExpandedParts:sourceGeometry.parts,maxExpandedParts:Math.min(GEOMETRY_LIMITS.expandedParts,COMPLEXITIES[job.complexity as keyof typeof COMPLEXITIES].maxParts),instructions:'这是原场景占用，不是本轮可新增数量；替换须扣除移除的几何再加新几何。散布须乘基础元素三角形及模板实例数，未选关键结构保持不变。'};
 const goalInput={repairBudget:editBudget,geometryBudget,originalPrompt:job.prompt,scoring:scoringGuidance(job.policy),frozenPlan:plan,referenceImages:images.length,actualFrameNames:frameNames,geometryVisibility:visibility.context,cameraChangeFeedback,review,previousRepairs,budget:COMPLEXITIES[job.complexity as keyof typeof COMPLEXITIES],scene:repairGoalContext(source)};
 save(join(folder,'repair-goals-input.json'),goalInput);event(job,'refinement-plan','对照原图、实际截图与空间范围，选择本轮最影响整体还原的修正目标');
 const goalsResult=await callValidated({role:'scene-repair-plan',schemaContext:{repairReferences:repairGoalReferences(source,plan,images.length,frameNames),repairComplexity:job.complexity},modelSettings:job.modelSettings,signal,maxTokens:5000,images:inputImages,system:REPAIR_GOALS_PROMPT+'\n'+CAMERA_CHANGE_PROMPT,text:JSON.stringify(goalInput)},folder,v=>validateRepairGoals(v,source,plan,images.length,frameNames,editBudget));
 const repairGoals=goalsResult.value;
 save(join(folder,'repair-goals.json'),{...repairGoals,quality:'not-assessed',sourceDigest,referenceSha256:refs,modelReceipt:goalsResult.receipt});
 job.repairGoals={...repairGoals,artifactPath:relative(runDir(job.id),join(folder,'repair-goals.json')),historyPath:relative(runDir(job.id),join(folder,'repair-history.json')),historyCount:previousRepairs.attempts.length,visibilityPath:relative(runDir(job.id),visibility.pagePath),cameraChangePath:cameraChangeFeedback?relative(runDir(job.id),join(folder,'camera-change.json')):null};
 event(job,'refinement-plan','本轮优先修正：'+repairGoals.goals.map((g:any)=>g.problem).join('；'));
 const selectedOpeningIds=repairGoals.goals.every((g:any)=>g.kind==='opening')?repairGoals.goals.flatMap((g:any)=>g.openingIds):[];
 const focus=selectedOpeningIds.length?refinementFocus(source,openingDiagnostics,selectedOpeningIds):null;
 const anchors=source.program.templates.map(t=>{const instance={id:'anchor',label:'局部范围',template:t.id,position:[0,0,0],rotation:[0,0,0],scale:[1,1,1],requirementIds:[]};const g=compileGeometryProgram({...source.program,templates:[t],instances:[instance]} as any,textures);return {id:t.id,meshBounds:g.bounds,parts:t.parts};});
 save(join(folder,'source.json'),{repairBudget:editBudget,sourceJobId:sourceId,sourceIteration:from?.iteration??null,sourceVersion:from?.version??read(join(sourceDir,'job.json')).pipelineVersion,sourceDigest,referenceSha256:refs,frameNames,baselineProfile:job.profile,qualityBefore:baseline.quality,originalQuality:read(join(sourceDir,'quality.json')),modelSettings:job.modelSettings});
 if(focus){save(join(folder,'focus.json'),focus);event(job,'refinement','优先落实 '+focus.targets.length+' 项空间缺陷；保留无关资产、机位与光照，实际网格复查后才进入画面验收');}
 const result=await callValidated({role:'scene-refine',schemaContext:{repairComplexity:job.complexity},modelSettings:job.modelSettings,signal,maxTokens:16000,images:inputImages,system:REFINEMENT_PROMPT+'\n本轮必须落实repairGoals所选目标，只改其中允许的已有模板、实例、材质、机位或光照；每个目标必须有对应的真实数据变化。保留未选对象。目标范围不等于已经修好，最终由独立画面验收判断。\n'+FOCUSED_REFINEMENT_PROMPT,text:JSON.stringify({repairBudget:editBudget,geometryBudget,originalPrompt:job.prompt,scoring:scoringGuidance(job.policy),previousRepairs,repairGoals,repairFocus:focus,frozenPlan:plan,referenceImages:images.length,actualFrameNames:frameNames,geometryVisibility:visibility.context,cameraChangeFeedback,review,openingDiagnostics,budget:COMPLEXITIES[job.complexity as keyof typeof COMPLEXITIES],sourceScene:{...source,assumptions:source.assumptions.slice(0,14),program:{...source.program,templates:anchors}},reusableTextures:textureCandidates(refs)})},folder,v=>{const next=applyRefinement(source,v,plan,images.length,job.complexity);resolveTextureReuse(next,refs);assertPlannedRepair(source,next,repairGoals);if(focus)assertRefinementFocus(source,next,focus);
   // 新裁切片段在后续提取步骤检查像素；此处只编译几何，避免用伪造纹理预填充。
   compileGeometryProgram({...next.program,materials:next.program.materials.map(m=>({...m,textureId:null}))});return v;});
 signal.throwIfAborted();require(digest(JSON.stringify(read(join(sourceDir,'generated-scene.json'))))===sourceDigest,'修正期间原场景发生变化');
 const scene=applyRefinement(source,result.value,plan,images.length,job.complexity),unchanged=source.program.templates.filter(t=>JSON.stringify(t)===JSON.stringify(scene.program.templates.find(x=>x.id===t.id))).length;
 if(focus)save(join(folder,'focus-result.json'),{focus,after:assertRefinementFocus(source,scene,focus),quality:'not-assessed'});
 save(join(folder,'repair-goals-result.json'),assertPlannedRepair(source,scene,repairGoals));
 const removedInstances=(result.value.removeInstances??[]).map((r:any)=>({instanceId:r.instanceId,reason:r.reason}));
 save(join(folder,'patch.json'),result.value);save(join(folder,'scene.json'),scene);save(join(folder,'receipt.json'),{sourceJobId:sourceId,sourceIteration:from?.iteration??null,sourceDigest,sceneDigest:digest(JSON.stringify(scene)),unchangedTemplates:unchanged,changedTemplates:source.program.templates.length-unchanged,addedTemplates:scene.program.templates.length-source.program.templates.length,removedInstances,quality:'not-assessed',modelReceipt:result.receipt});
 job.visualRefinement={...(focus?{method:focus.version,focusIds:focus.targets.map(c=>c.id)}:{}),sourceJobId:sourceId,sourceIteration:from?.iteration??null,sourceScore:baseline.quality.score,originalSourceScore:read(join(sourceDir,'quality.json')).score,unchangedTemplates:unchanged,changedTemplates:source.program.templates.length-unchanged,addedTemplates:scene.program.templates.length-source.program.templates.length,removedInstances};return scene;
}
