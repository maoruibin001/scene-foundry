import {sourceSceneFile} from './source-scene';
import {scoreControlEvidence} from './score-controls';
import {restoreRepairAttempt} from './repair-attempt-recovery';
import {createRepairTools,REPAIR_TOOL_PROMPT} from './repair-tools';
import {LIGHTING_RULES} from './lighting';
import {assertCameraPreflight} from './camera-preflight';
import {stable} from '../validated-cache';
import {budget as callBudget,PROVIDER} from '../provider';
import {fitScreenTargets,surfaceBindings} from './screen-fit';
import {repairRequirementFeedback} from './repair-requirement-feedback';
import {repairReflection} from './repair-reflection';
import {validatedKey,validatedCache,persistValidatedReuse} from '../validated-cache';
import {repairTextureEvidence,repairReusableTextureEvidence} from './repair-texture-evidence';
import {repairExecutionContext,repairBatches,repairSourceContext,mergeRefinementPatches,repairPlanningContext} from './repair-batches';
import {repairBudget,repairGeometryBudget,LEGACY_REPAIR_BUDGET} from './repair-budget';
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
import {COMPLEXITIES,complexityPolicy} from '../complexity';
import {sceneSchema,validateScene,type SceneInput} from './scene-contract';
import {compileGeometryProgram} from './program';
import {GEOMETRY_RULES,uvTransformSchema,uvProjectionSchema} from './program-schema';
import {resolveTextureReuse} from './texture-library';
import {CATALOG_GUIDANCE} from './material-catalog';
import {repairHistory} from './repair-history';
import {prepareVisibilityEvidence} from './visibility-evidence';
import {ensureProjectionEvidence} from './projection-evidence';
import {VISIBILITY_PROMPT} from './visibility';
import {cameraChangeHistory} from './camera-change-history';
import {CAMERA_CHANGE_PROMPT} from './camera-change';

const obj=(properties:any)=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const arr=(items:any,maxItems=64)=>({type:'array',items,maxItems});
const str={type:'string'};
export function refinementSchema(level:keyof typeof COMPLEXITIES='simple'){
 const budget=repairBudget(level);
 const s=sceneSchema().properties,p=s.program.properties;
 return obj({version:{type:'string',enum:['scene-refinement-v5']},reason:str,
  screenTargets:arr(obj({instanceId:str,reason:str,views:{type:'array',minItems:2,maxItems:6,items:obj({referenceIndex:{type:'integer',minimum:1},rect:{type:'array',minItems:4,maxItems:4,items:{type:'number',minimum:0,maximum:1}}})}}),8),
  instances:arr(p.instances.items),cameras:arr(s.cameras.items,6),materials:arr(p.materials.items,24),
  removeInstances:arr(obj({instanceId:str,reason:str}),16),
  parts:arr(obj({templateId:str,part:p.templates.items.properties.parts.items}),budget.parts),
  surfaceUpdates:arr(obj({templateId:str,partId:str,uvProjection:{anyOf:[{type:'null'},uvProjectionSchema()]},material:{type:['string','null']},uvScale:{anyOf:[{type:'null'},{type:'array',items:{type:'number',minimum:.01,maximum:100},minItems:2,maxItems:2}]},uvTransform:{anyOf:[{type:'null'},uvTransformSchema()]},smoothAngle:{type:['number','null'],minimum:0,maximum:180}}),budget.parts),
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
 if(patch?.version==='scene-refinement-batches-v1'){
  require(Array.isArray(patch.batches)&&patch.batches.length>=1&&patch.batches.length<=3,'独立修复批次数量无效');
  require(patch.batches.every((p:any)=>p.version==='scene-refinement-v5'),'批次仅允许已验证的单次修复协议，不允许嵌套');
  const merged=mergeRefinementPatches(patch.batches),{batches,version,...summary}=patch;
  require(digest(stable({...summary,version:merged.version}))===digest(stable(merged)),'批次汇总与原补丁不一致');
  // 每批按单次编辑上限验收；冲突由合并器拒绝，累计场景预算在每次应用后复核。
  for(const part of batches)applyRefinement(source,part,plan,references,level);
  return batches.reduce((current:any,part:any)=>applyRefinement(current,part,plan,references,level),source);
 }
 require(['scene-refinement-v1','scene-refinement-v2','scene-refinement-v3','scene-refinement-v4','scene-refinement-v5'].includes(patch?.version)&&typeof patch.reason==='string'&&patch.reason.trim(),'场景修正版本或依据无效');
 // v1 是已持久化的历史修改契约；恢复时不能将其解释为支持删除实例的新协议。
 require(patch.version!=='scene-refinement-v1'||patch.removeInstances===undefined,'历史修正协议不支持删除实例');
 const removals=patch.version!=='scene-refinement-v1'?patch.removeInstances:[];
 require(Array.isArray(removals)&&removals.length<=16,'删除实例数量超限或缺失');
 unique(removals,x=>x.instanceId,'删除实例');
 const edits=['scene-refinement-v3','scene-refinement-v4','scene-refinement-v5'].includes(patch.version)?repairBudget(level):LEGACY_REPAIR_BUDGET;
 const limits:any={instances:64,cameras:6,materials:24,parts:edits.parts,removeParts:edits.removeParts,addTemplates:4,addEntities:16,textures:4,textureReuse:8,assumptions:24};
 for(const [key,max] of Object.entries(limits))require(Array.isArray(patch[key])&&patch[key].length<=(max as number),'修正数量超限：'+key);
 for(const key of ['instances','materials','addTemplates','textures'])unique(patch[key],x=>x.id,key);
 unique(patch.parts,x=>x.templateId+'/'+x.part?.id,'部件');unique(patch.removeParts,x=>x.templateId+'/'+x.partId,'删除部件');
 unique(patch.textureReuse,x=>x.textureId,'纹理复用');unique(patch.addEntities,x=>x.instanceId,'语义实体');
 unique(patch.cameras,x=>x.referenceIndex===null?x.name:'ref:'+x.referenceIndex,'相机');
 const surfaceUpdates=['scene-refinement-v4','scene-refinement-v5'].includes(patch.version)?patch.surfaceUpdates:[];
 require(['scene-refinement-v4','scene-refinement-v5'].includes(patch.version)||patch.surfaceUpdates===undefined,'历史修正协议不支持表面补丁');
 require(Array.isArray(surfaceUpdates)&&surfaceUpdates.length+patch.parts.length<=edits.parts,'表面与几何合计修改数量超限');
 unique(surfaceUpdates,x=>x.templateId+'/'+x.partId,'表面补丁');
 for(const u of surfaceUpdates)require(!patch.parts.some(x=>x.templateId===u.templateId&&x.part.id===u.partId)&&!patch.removeParts.some(x=>x.templateId===u.templateId&&x.partId===u.partId),'同一部件不能同时表面修改与替换或删除');
 const targets=patch.version==='scene-refinement-v5'?patch.screenTargets:[];
 require(patch.version==='scene-refinement-v5'||patch.screenTargets===undefined,'历史修正协议不支持图像位置约束');
 require(Array.isArray(targets),'缺少图像位置约束数组');
 for(const t of targets){const i=source.program.instances.find(i=>i.id===t.instanceId);require(i&&!patch.instances.some(x=>x.id===t.instanceId)&&!removals.some(x=>x.instanceId===t.instanceId),'图像位置约束与显式位姿或删除冲突');}
 const next=structuredClone(source),p=next.program;
 for(const u of surfaceUpdates){const part=p.templates.find(t=>t.id===u.templateId)?.parts.find(x=>x.id===u.partId);require(part,'表面补丁引用不存在的部件');for(const key of ['material','uvScale','uvTransform','smoothAngle'])if(u[key]!==null){require(u[key]!==undefined,'表面补丁缺少字段：'+key);part![key]=u[key];}if(u.uvProjection!=null)part!.uvProjection=u.uvProjection;}
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
 for(const c of patch.cameras){
  const at=next.cameras.findIndex(x=>c.referenceIndex===null?x.referenceIndex===null&&x.name===c.name:x.referenceIndex===c.referenceIndex);
  if(at<0){
   require(c.referenceIndex===null,'修正只能调整已有参考机位；新增机位必须为检查机位');
   require(!next.cameras.some(v=>v.name===c.name),'新增检查机位名称不能与已有机位重复');
   next.cameras.push({...c});
  }else next.cameras[at]={...c,...(next.cameras[at].frame?{frame:next.cameras[at].frame}:{})};
 }
 next.textureReuse=(next.textureReuse??[]).filter(t=>!patch.textures.some((u:any)=>u.id===t.textureId)||patch.textureReuse.some((u:any)=>u.textureId===t.textureId));for(const t of patch.textureReuse){const at=next.textureReuse.findIndex(x=>x.textureId===t.textureId);if(at<0)next.textureReuse.push(t);else next.textureReuse[at]=t;}
 // 材质换用新图后，退役的旧声明不继续占据本轮贴图预算；历史来源和物理资产仍保留。
 const previouslyUsed=new Set(source.program.materials.map(m=>m.textureId).filter(Boolean)),stillUsed=new Set(p.materials.map(m=>m.textureId).filter(Boolean));
 const retired=new Set(source.textures.filter(t=>previouslyUsed.has(t.id)&&!stillUsed.has(t.id)).map(t=>t.id));
 next.textures=next.textures.filter(t=>!retired.has(t.id));next.textureReuse=next.textureReuse.filter(t=>!retired.has(t.textureId));
 if(patch.lighting!==null)next.lighting={...patch.lighting,backgroundColor:patch.lighting.backgroundColor??source.lighting.backgroundColor??null};
 next.assumptions.push(...patch.assumptions);
 // 在本次形状与机位更新后求解，避免对旧几何求解后又改形导致投影失效。
 upsert(p.instances,fitScreenTargets(next,targets).instances);
 validateScene(next,plan,references);
 for(const t of p.templates)assertAssetOpenings(next,t.id);
 const budget=complexityPolicy(level,references>0&&Array.isArray((source as any).observedBindings)),entities=next.entities.filter(e=>e.role!=='ground'),parts=p.instances.reduce((n,i)=>n+p.templates.find(t=>t.id===i.template)!.parts.length,0);
 require(parts<=budget.maxParts&&p.materials.length<=budget.maxMaterials,'修正后的部件或材质超过原复杂度预算：展开部件 '+parts+'/'+budget.maxParts+'；材质 '+p.materials.length+'/'+budget.maxMaterials+'；替换已有部件或先移除有证据的冗余部分，不追加上限');
 require(entities.length>=budget.minEntities&&entities.length<=budget.maxEntities&&new Set(entities.map(e=>e.category)).size>=budget.minKinds,'修正后未满足原复杂度');
 require(digest(JSON.stringify({...next,assumptions:[]}))!==digest(JSON.stringify({...source,assumptions:[]})),'没有任何可执行的场景变化');
 return next;
}

export const REFINEMENT_PROMPT=`这是通用三维场景的视觉反馈修正步骤。原始参考图在前，当前 ForgeaX Engine 实际截图在后。根据原始需求、独立验收的明确失败和真实画面，输出 scene-refinement-v5 增量数据。只在已提供专用工具时调用它们进行自检，不输出代码，不改变输入要求或评分门槛。所有说明使用中文。
screenTargets 可针对至少两个参考机位中轮廓完整且可可靠对应的独立实例给出目标 rect=[x0,y0,x1,y1]，坐标按原图去除黑边后的内容区归一化；求解器只做有限 XY 平移和一致缩放，保留原始落地高度、形状、相机。每个机位都不得明显变差，整体误差至少降低20%才采纳，否则保留原实例。不得用受遮挡的可见碎片边界充当完整物体范围，不能用于房间围护或冻结开口宿主。该对象不能同时出现在instances；允许同轮修改其形状和参考机位，求解在这些修改之后执行；需要多物体联动时应保持依附关系，无法可靠对应时用空数组。图像约束只辅助定位，不等同得分通过。
图片还原沿用冻结参考的对象数量和类别；复杂度只限制资源上限，不能为满足通用实体下限增加对象。没有图像观察绑定的纯文字场景继续遵守所选复杂度的数量与类别要求。
先修正整体空间、关键轮廓、可见环境和入光层次，再修小配件。所有已有机位的近裁面与连续巡航须保持真实几何净空。修改墙体或其他邻近物件后要联合核对全部机位；不能把推断墙体延伸到相机附近或穿入视线。管线会在导出前用真实三角形检查并返回冲突部件，修复其几何，不关闭巡航或缩小验收范围。openingDiagnostics为已编译几何的净空与后景射线诊断，不是质量结论；blocked给出实际遮挡部件，missing-background指出规划需要可见环境却无不透明几何。结合原图和实际画面修复，不删除或缩小sourceScene.spatialOpenings约束。保持同一空间、多机位中的物件身份一致。可见门窗外的局部环境也是画面内容；可用具有真实深度、体积与视差的必要补全，不要继续留下统一空色，不得用整张参考图或室内大面板冒充三维。仅相机调整无法纠正的布局错误必须调整实例或相关部件，不能藏到镜头外。
资源库成套PBR材质通过textureReuse一次绑定全部已验证通道，共享同一UV；roughness和metallic仍为对应贴图的乘数，选择成套贴图时根据通道内容设定，不将粗糙度乘数设为零而消除纹理变化。法线贴图只改变表面受光，不能假装改变几何轮廓。未改部分完全复用。instances 为要更新或新增的完整实例，新增实例必须同时给 addEntities。removeInstances最多16项，每项给出已选目标中instanceId和中文reason；只有原图和实际截图支持其为多余或错误重复的物体才能移除。解释可见数量、遮挡或空间关系的证据，不能因为暂时看不见就删除，也不能通过移到镜头外代替移除。不得移除冻结开口的宿主、破坏关键需求或明确数量；程序仅从新场景移除实例及对应entities，保留原场景和共享资产，不删除物理资源。同一实例不能同时更新与移除。cameras 列出要调整的已有机位，保留referenceIndex；也可新增名称唯一、referenceIndex:null 的检查机位，补拍背侧或遮挡区。原参考机位与未修改检查机位全部保留，最终仍最多六个且必须通过真实几何净空和运行检查。不得用额外机位掩盖参考视角缺陷，也不得把未采集区域当作已验证。materials 为更新或新增的完整PBR材质，现有ID保持。只改材质、UV或曲面法线时使用surfaceUpdates，每项只需templateId、partId、material、uvScale、uvTransform、uvProjection、smoothAngle；null表示该字段保持不变；uvProjection可设world-box按世界尺寸投影，或{mode:"native"}明确恢复原生映射，恢复UV默认值须显式给出零偏移、零旋转、不翻转。surfaceUpdates不传顶点、形状或位置，避免为改表面重写网格。parts 按templateId与part.id替换或添加几何部件；两类修改合计受同一部件额度限制，同一部件不能两处重复写入；removeParts 仅删除有明确错误的部件并说明理由；addTemplates 最多4个新模板，已有模板不可整体覆盖。所有改变都必须在原复杂度和三角形预算内。不要为了显得复杂而加无关物体。repairBudget只规定本轮可编辑多少已有部件，不增加最终场景部件或实体上限；关联结构可一起调整，无需为历史的小编辑额度永久冻结已知错误的相邻对象。
textures最多4个新增或修正的局部表面声明，必须绑定到repairGoals已选materialIds或已获准新增几何的新材质。共享纹理的所有引用材质都必须在范围内，否则给已选材质建立独立声明，不改变其他表面；修改裁切会取消该纹理原有复用绑定，除非本次textureReuse同时明确指定资源；textureReuse最多8个本次候选中的资源引用。候选有明确来源，不能捏造ID、图片、路径。局部贴图只能映射到相应真实物体表面，不能替代整个房间或遮挡缺失空间。保留正确的原纹理与资产。${LIGHTING_RULES}
${CATALOG_GUIDANCE}
lighting 为完整光照配置，保留则null；backgroundColor 是线性 RGB 的背景颜色，有原图窗外亮区或天空依据才修改，不用补几何背景板改变遮挡；照片贴图已包含拍摄光照，避免再次过度压暗；其余没改的字段填空数组。
关注真实截图中的纹理尺度、材质过黑、入光方向、明暗层次、轮廓与透视。表面分层应留出可见精度安全间隔，避免几乎共面的覆盖。实例/资产摘要中的meshBounds是实际编译几何的局部范围；估计相机和尺寸要结合输入图，不照抄已知错误。
reason说明本轮可观察的改变及依据；assumptions只记新增的不确定性。不能声称已执行构建或达到某个分数，最终由重新运行后的独立评分决定。
${VISIBILITY_PROMPT}
${CAMERA_CHANGE_PROMPT}
${GEOMETRY_RULES}`;

export async function refineScene(job:any,plan:any,images:{path:string;mime:string}[],dir:string,signal:AbortSignal,from?:{dir:string;jobId:string;version:any;iteration:number}){
 const sourceDir=from?.dir??runDir(job.reuseSceneFrom),sourceId=from?.jobId??job.reuseSceneFrom,original=read(sourceSceneFile(job,sourceDir)) as SceneInput,textures=read(join(sourceDir,'materials/texture-registry.json'));
 const sourceDigest=digest(JSON.stringify(original)),refs=images.map(i=>digest(readFileSync(i.path))),folder=join(dir,'refinement');mkdirSync(folder,{recursive:true});
 require(JSON.stringify(refs)===JSON.stringify((job.images??[]).map((i:any)=>i.id)),'参考图片内容与来源不一致');
 const runtime=read(join(sourceDir,'runtime/runtime.json')),frameNames=runtime.images.filter((x:string)=>/^reference-|^inspection-/.test(x));require(frameNames.length>0,'缺少用于修正的实际画面');
 for(const f of frameNames)require(digest(readFileSync(join(sourceDir,'runtime',f)))===runtime.hashes[runtime.images.indexOf(f)],'修正画面摘要不符');
 const baseline=from?{review:read(join(sourceDir,'review.json')),quality:read(join(sourceDir,'quality.json')),reassessed:false}:await refinementBaseline(job,read(join(sourceDir,'job.json')),sourceDir,folder,signal);
 const review=baseline.review,source=await observeOpenings(job,original,review,images,frameNames.map((name:string)=>({name,path:join(sourceDir,'runtime',name),mime:'image/png'})),folder,signal);
 const openingDiagnostics=openingSummary(inspectOpenings(source));
 const previousRepairs=repairHistory(job,original,refs);save(join(folder,'repair-history.json'),previousRepairs);
 const reflection={...repairReflection(baseline.quality,previousRepairs),scoreControls:scoreControlEvidence(job,sourceDigest)};save(join(folder,'repair-reflection.json'),reflection);event(job,'repair-reflection','已读取 '+reflection.verifiedAttempts+' 份同契约修复证据；最大差距：'+reflection.dimensions.slice(0,2).map(d=>d.id+' 缺 '+d.pointsLost+' 分').join('、'));
 const cameraChangeFeedback=cameraChangeHistory(sourceDir,original,textures);
 if(cameraChangeFeedback){save(join(folder,'camera-change.json'),cameraChangeFeedback);event(job,'camera-change','已核对历史来源，对比 '+cameraChangeFeedback.views.length+' 个调整机位的同几何遮挡变化；仅辅助修正，不改写评分');}
 const projection=await ensureProjectionEvidence(source,images,refs,sourceDir,runtime,folder,signal);
 const visibility=prepareVisibilityEvidence(source,textures,folder,projection.sourceFolder,projection.runtime,frameNames);
 const [textureEvidence,reusableTextureEvidence]=await Promise.all([repairTextureEvidence(source,textures,folder,signal,images),repairReusableTextureEvidence(refs,folder,signal)]);
 const requirementFeedback=repairRequirementFeedback(plan,review,source,visibility.context,previousRepairs);save(join(folder,'requirement-feedback.json'),requirementFeedback);
 const inputImages=[...images,...frameNames.map((name:string)=>({path:join(sourceDir,'runtime',name),mime:'image/png'})),...visibility.images,...textureEvidence.images,...reusableTextureEvidence.images];
 const editBudget=repairBudget(job.complexity),geometryBudget=repairGeometryBudget(source.program,job.complexity);
 const recovered=from?null:restoreRepairAttempt(job,sourceId,source,plan,refs,folder);
 const remainingCalls=callBudget(job.modelSettings?.model).remaining;
 if(remainingCalls!==null&&remainingCalls<(recovered?2:3))throw Error('修复剩余调用不足；需保留独立评审，已保存候选不重复生成');
 const goalInput={requirementFeedback,callBudget:{remaining:remainingCalls,reservedAssessmentCalls:1,maxExecutionBatches:remainingCalls===null?null:remainingCalls-2,instructions:'优先能在本轮闭环的明确可见缺陷，保留一次独立评审；避免把已改善的大结构与所有细节重新打包成大量改写。'},surfaceBindings:surfaceBindings(source),repairReflection:reflection,reusableTextures:reusableTextureEvidence.context,textureEvidence:textureEvidence.context,textureEvidenceRule:'纹理证据按顺序展示当前已用贴图表，随后若有候选则展示asset-编号的可复用材质表，编号与reusableTextures对应。候选包含同参考图的历史资源及明确来源的固定外部PBR目录，均为已校验真实像素；需要看图判断适配性，不按名称或生成方式决定质量，不足时明确记录。优先使用已有合适材质，避免反复从带透视和阴影的曲面照片裁出条带。先区分裁切本身错误、UV拉伸/重复及场景光照；裁切已失真时仅调材质颜色或UV无法恢复纹样。照片带原光照，不是无光照反射率，避免再次压暗。',repairBudget:editBudget,geometryBudget,originalPrompt:job.prompt,deliveryStandard:job.policy?.deliveryStandard??'strict',scoring:scoringGuidance(job.policy),frozenPlan:plan,referenceImages:images.length,actualFrameNames:frameNames,geometryVisibility:visibility.context,cameraChangeFeedback,review,previousRepairs,budget:complexityPolicy(job.complexity,images.length>0&&Array.isArray((source as any).observedBindings)),scene:repairGoalContext(source)};
 save(join(folder,'repair-goals-input.json'),goalInput);event(job,'refinement-plan','对照原图、实际截图与空间范围，选择本轮最影响整体还原的修正目标');
 const goalsResult=recovered?{value:validateRepairGoals(recovered.goals,source,plan,images.length,frameNames,editBudget),receipt:{method:'saved-repair-goals',sourceJobId:recovered.recovery.sourceJobId}}:await callValidated({role:'scene-repair-plan',schemaContext:{repairReferences:repairGoalReferences(source,plan,images.length,frameNames),repairComplexity:job.complexity},modelSettings:job.modelSettings,signal,maxTokens:5000,reservedCalls:2,images:inputImages,system:REPAIR_GOALS_PROMPT+'\n'+CAMERA_CHANGE_PROMPT,text:JSON.stringify(repairPlanningContext(goalInput))},folder,v=>validateRepairGoals(v,source,plan,images.length,frameNames,editBudget));
 const repairGoals=goalsResult.value;
 save(join(folder,'repair-goals.json'),{...repairGoals,quality:'not-assessed',sourceDigest,referenceSha256:refs,modelReceipt:goalsResult.receipt});
 job.repairGoals={...repairGoals,artifactPath:relative(runDir(job.id),join(folder,'repair-goals.json')),historyPath:relative(runDir(job.id),join(folder,'repair-history.json')),historyCount:previousRepairs.attempts.length,visibilityPath:relative(runDir(job.id),visibility.pagePath),cameraChangePath:cameraChangeFeedback?relative(runDir(job.id),join(folder,'camera-change.json')):null};
 event(job,'refinement-plan','本轮优先修正：'+repairGoals.goals.map((g:any)=>g.problem).join('；'));
 const selectedOpeningIds=repairGoals.goals.every((g:any)=>g.kind==='opening')?repairGoals.goals.flatMap((g:any)=>g.openingIds):[];
 const focus=selectedOpeningIds.length?refinementFocus(source,openingDiagnostics,selectedOpeningIds):null;
 const anchors=source.program.templates.map(t=>{const instance={id:'anchor',label:'局部范围',template:t.id,position:[0,0,0],rotation:[0,0,0],scale:[1,1,1],requirementIds:[]};const g=compileGeometryProgram({...source.program,templates:[t],instances:[instance]} as any,textures);return {id:t.id,meshBounds:g.bounds,parts:t.parts};});
 save(join(folder,'source.json'),{repairBudget:editBudget,sourceJobId:sourceId,sourceIteration:from?.iteration??null,sourceVersion:from?.version??read(join(sourceDir,'job.json')).pipelineVersion,sourceDigest,referenceSha256:refs,frameNames,baselineProfile:job.profile,sourceCriteria:plan.acceptanceCriteria??null,qualityBefore:baseline.quality,originalQuality:read(join(sourceDir,'quality.json')),modelSettings:job.modelSettings});
 if(focus){save(join(folder,'focus.json'),focus);event(job,'refinement','优先落实 '+focus.targets.length+' 项空间缺陷；保留无关资产、机位与光照，实际网格复查后才进入画面验收');}
 const remainingAfterPlan=callBudget(job.modelSettings?.model).remaining,maxBatches=remainingAfterPlan===null?Infinity:remainingAfterPlan-1;
 if(maxBatches<1)throw Error('规划后无修复及独立评审额度，保留规划结果');
 const batches=recovered?recovered.batches:focus?[{...repairGoals,id:'batch-1'}]:repairBatches(repairGoals,source,maxBatches);
 save(join(folder,'repair-batches.json'),{version:'repair-batches-v1',batches,scope:'独立目标并行，共用对象合并；沿用全局模型并发上限，全部结果汇总后仍须完整结构与视觉验收'});
 event(job,'refinement','将 '+repairGoals.goals.length+' 个修复目标分为 '+batches.length+' 个独立调用；仅传入选中部件，复用其余场景');
 const responses=await Promise.allSettled(batches.map(async batch=>{
  const batchFolder=join(folder,batch.id);mkdirSync(batchFolder,{recursive:true});
  const request:any={role:'scene-refine',schemaContext:{repairComplexity:job.complexity},modelSettings:job.modelSettings,signal,maxTokens:16000,reservedCalls:1,images:inputImages,system:REFINEMENT_PROMPT+'\n本轮必须落实repairGoals所选目标，只改其中允许的已有模板、实例、材质、机位或光照；每个目标必须有对应的真实数据变化。保留未选对象。目标范围不等于已经修好，最终由独立画面验收判断。\n'+FOCUSED_REFINEMENT_PROMPT,text:JSON.stringify(repairExecutionContext({requirementFeedback,surfaceBindings:surfaceBindings(source),repairReflection:reflection,textureEvidence:textureEvidence.context,textureEvidenceRule:goalInput.textureEvidenceRule,repairBudget:editBudget,geometryBudget,originalPrompt:job.prompt,deliveryStandard:job.policy?.deliveryStandard??'strict',scoring:scoringGuidance(job.policy),previousRepairs,repairGoals:batch,repairFocus:focus,frozenPlan:plan,referenceImages:images.length,actualFrameNames:frameNames,geometryVisibility:visibility.context,cameraChangeFeedback,review,openingDiagnostics,budget:complexityPolicy(job.complexity,images.length>0&&Array.isArray((source as any).observedBindings)),sourceScene:repairSourceContext(source,anchors,batch),reusableTextures:reusableTextureEvidence.context}))};
  const validateBase=(v:any)=>{if(batch.goals.every(g=>['surface','lighting'].includes(g.kind))&&(v.parts.length||v.removeParts.length||v.addTemplates.length||v.instances.length||v.screenTargets?.length||v.removeInstances.length||v.cameras.length))throw Error('表面修复只允许surfaceUpdates、材质、纹理和光照，不得重写几何或机位');const next=applyRefinement(source,v,plan,images.length,job.complexity);resolveTextureReuse(next,refs);assertPlannedRepair(source,next,batch);if(focus)assertRefinementFocus(source,next,focus);
   // 新裁切片段在后续提取步骤检查像素；此处只编译几何，避免用伪造纹理预填充。
   const compiled=compileGeometryProgram({...next.program,materials:next.program.materials.map(m=>({...m,textureId:null,surfaceDetail:null}))});assertCameraPreflight(next,compiled);return v;};
  const feedback=PROVIDER==='codex-cli'?createRepairTools({source,textures,folder:join(batchFolder,'feedback'),signal,images,refs,sourceFrames:(runtime.referenceFrames??[]).map((f:any)=>({referenceIndex:f.referenceIndex,path:join(sourceDir,'runtime',f.file)})),onEvent:message=>event(job,'repair-feedback',batch.id+' · '+message),validate:validateBase,apply:v=>applyRefinement(source,v,plan,images.length,job.complexity)}):null;
  if(feedback){request.tools=feedback.kit;request.system+='\n'+REPAIR_TOOL_PROMPT;
   if(recovered&&feedback.counts.enginePreviews>=2){
    request.system='本次仅恢复中断前已完成的候选选择。对照原参考图、来源场景和随后附上的已有候选画面，选一个最能落实修复目标的成功预览。不得重新规划或生成补丁，不宣称已达标；最终仅输出selectedPatchSha256和中文reason，由管线取回原补丁重新校验、运行和独立评分。';
    request.text=JSON.stringify({repairGoals:batch,deliveryStandard:job.policy?.deliveryStandard??'strict',scoring:scoringGuidance(job.policy),qualityBefore:baseline.quality,reviewBefore:review,recovery:recovered.recovery.reason});
    request.images=[...images,...frameNames.map((name:string)=>({path:join(sourceDir,'runtime',name),mime:'image/png'}))];
   }
  }
  const validate=(v:any)=>{const value=validateBase(v);feedback?.assertReviewed(v);return value;};
  const compute=()=>callValidated(request,batchFolder,validate);
  if(job.batchId)return compute();
  const started=Date.now(),key=validatedKey(request,{version:job.pipelineVersion,profile:job.profile,sourceDigest,contract:'repair-feedback-v1'});
  const cached=await validatedCache.use(key,validateBase,compute,{jobId:job.id,pipelineVersion:job.pipelineVersion,dir:batchFolder},signal);
  return cached.reuse?persistValidatedReuse(batchFolder,'scene-refine',cached.result,cached.reuse,started):cached.result;
 }));
 const failed=responses.filter(r=>r.status==='rejected');
 if(failed.length){save(join(folder,'repair-batch-failures.json'),failed.map(r=>String((r as PromiseRejectedResult).reason)));throw (failed[0] as PromiseRejectedResult).reason;}
 const successful=responses.map(r=>(r as PromiseFulfilledResult<any>).value);
 const result={value:{...mergeRefinementPatches(successful.map(r=>r.value)),version:'scene-refinement-batches-v1',batches:successful.map(r=>r.value)},receipt:{method:'repair-batches-v2',batches:successful.map((r,i)=>({id:batches[i].id,receipt:r.receipt}))}};
 // 单批次有效不代表组合有效：原三角形、部件、范围和目标约束再统一检查。
 const merged=applyRefinement(source,result.value,plan,images.length,job.complexity);assertPlannedRepair(source,merged,repairGoals);save(join(folder,'camera-preflight.json'),assertCameraPreflight(merged));

 signal.throwIfAborted();require(digest(JSON.stringify(read(sourceSceneFile(job,sourceDir))))===sourceDigest,'修正期间原场景发生变化');
 const scene=applyRefinement(source,result.value,plan,images.length,job.complexity),unchanged=source.program.templates.filter(t=>JSON.stringify(t)===JSON.stringify(scene.program.templates.find(x=>x.id===t.id))).length;
 if(focus)save(join(folder,'focus-result.json'),{focus,after:assertRefinementFocus(source,scene,focus),quality:'not-assessed'});
 save(join(folder,'repair-goals-result.json'),assertPlannedRepair(source,scene,repairGoals));
 const removedInstances=(result.value.removeInstances??[]).map((r:any)=>({instanceId:r.instanceId,reason:r.reason}));
 save(join(folder,'screen-fit.json'),{scope:'最终候选复核；合并形状与机位后再定位',reports:fitScreenTargets(scene,result.value.screenTargets??[]).reports});
 save(join(folder,'patch.json'),result.value);save(join(folder,'scene.json'),scene);save(join(folder,'receipt.json'),{sourceJobId:sourceId,sourceIteration:from?.iteration??null,sourceDigest,sceneDigest:digest(JSON.stringify(scene)),unchangedTemplates:unchanged,changedTemplates:source.program.templates.length-unchanged,addedTemplates:scene.program.templates.length-source.program.templates.length,removedInstances,quality:'not-assessed',modelReceipt:result.receipt});
 job.visualRefinement={...(focus?{method:focus.version,focusIds:focus.targets.map(c=>c.id)}:{}),sourceJobId:sourceId,sourceIteration:from?.iteration??null,sourceScore:baseline.quality.score,originalSourceScore:read(join(sourceDir,'quality.json')).score,unchangedTemplates:unchanged,changedTemplates:source.program.templates.length-unchanged,addedTemplates:scene.program.templates.length-source.program.templates.length,removedInstances};return scene;
}
