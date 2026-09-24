import {LEGACY_REPAIR_BUDGET,type RepairBudget} from './repair-budget';
import {NoActionableChange} from '../contracts';
import {spatialContext} from './spatial-refinement';
import type {SceneInput} from './scene-contract';
import {VISIBILITY_PROMPT} from './visibility';
import {GEOMETRY_RULES} from './program-schema';

export const REPAIR_GOALS_VERSION='scene-repair-goals-v1';
const kinds=['layout','geometry','opening','surface','lighting','camera'];
const dimensions=['coverage','spatial','shape','material','readability'];
const obj=(properties:any)=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const str={type:'string'},arr=(items:any,maxItems:number)=>({type:'array',items,maxItems});
export type RepairGoalReferences=Record<'requirementIds'|'instanceIds'|'templateIds'|'materialIds'|'cameraNames'|'openingIds'|'frames',string[]>&{referenceCount:number};
export function repairGoalReferences(source:SceneInput,plan:any,references:number,frames:string[]):RepairGoalReferences{return {
 requirementIds:plan.requirements.map((r:any)=>r.id),instanceIds:source.program.instances.map(i=>i.id),templateIds:source.program.templates.map(t=>t.id),
 materialIds:source.program.materials.map(m=>m.id),cameraNames:source.cameras.map(c=>c.name),openingIds:(source.spatialOpenings??[]).map(o=>o.id),frames,referenceCount:references,
};}
export function repairGoalsSchema(known?:RepairGoalReferences,budget:RepairBudget=LEGACY_REPAIR_BUDGET){
 const ids=(key:Exclude<keyof RepairGoalReferences,'referenceCount'>,max:number)=>arr(known?.[key].length?{type:'string',enum:known[key]}:str,known?Math.min(max,known[key].length):max);
 // 将目标类型与相关字段的条件关系放进输出契约，避免完整规划后才发现静态字段组合无效。
 const variants=kinds.filter(kind=>kind!=='opening'||!known||known.openingIds.length>0).map(kind=>obj({
  id:str,kind:{type:'string',enum:[kind]},dimension:{type:'string',enum:dimensions},problem:str,whyPriority:str,expectedChange:str,
  requirementIds:{...ids('requirementIds',12),minItems:1},instanceIds:ids('instanceIds',20),templateIds:ids('templateIds',budget.templates),
  materialIds:kind==='opening'?arr(str,0):{...ids('materialIds',8),...(kind==='surface'?{minItems:1}:{})},
  cameraNames:kind==='opening'?arr(str,0):{...ids('cameraNames',6),...(kind==='camera'?{minItems:1}:{})},
  openingIds:kind==='opening'?{...ids('openingIds',8),minItems:1}:arr(str,0),
  addGeometry:['geometry','opening'].includes(kind)?{type:'boolean'}:{type:'boolean',enum:[false]},
  evidence:{...arr(obj({frame:known?{type:'string',enum:known.frames}:str,referenceIndex:known?(known.referenceCount?{type:'integer',enum:Array.from({length:known.referenceCount},(_,i)=>i+1)}:{type:'null'}):{type:['integer','null']},region:{type:'array',items:{type:'number'},minItems:4,maxItems:4},observation:str}),6),minItems:1},
 }));
 return obj({version:{type:'string',enum:[REPAIR_GOALS_VERSION]},summary:str,goals:arr({anyOf:variants},3),deferred:arr(obj({problem:str,reason:str}),6)});
}

export const REPAIR_GOALS_PROMPT=`这是通用场景管线的修正目标选择步骤，先决定本轮最值得修的内容，暂不生成几何。使用中文，不调用工具，只返回 scene-repair-goals-v1。原始参考图在前，当前 ForgeaX Engine 实际截图在后。输入包含冻结需求、独立评审、评分权重及实际对象范围。
按画面对整体还原的影响选择最多三个关联目标，数组顺序就是执行优先级。先比对建筑与空间比例、相机透视、主体尺度与位置、前中后景和遮挡关系，再比较表面与小配件。结合评分权重、关键需求、多个视角和实际可见差异排序；权重不允许改变真实评分，也不代表小面积但关键的主体可以忽略。
历史记录包含当前场景的直接修正、沿已核验来源链追溯的祖先修正，以及从祖先出发的其他尝试。结合relation、sourceDigest、sceneDigest区分它们，不把祖先或其他分支的画面缺陷说成当前画面已确认的缺陷。较早失败的方案仍可作为避免重复的依据，但改动必须由本次原图与真实截图支持；只展示最近四轮时，不把其余轮次当成从未尝试。
previousRepairs是同输入、模型、路由、规范和验收策略，且有场景和实际画面摘要支持的历史修正结果。scoreComparison标明评估证据契约是否与当前相同；comparableToCurrentAssessment为false的记录仅供理解旧策略和原观测，不能与当前分数比较、计算当前收益或预测本轮评分。scoreGain只表示历史尝试内部的有效分差，为null则历史前后也不可比较。先检查哪些目标已尝试但无足够收益，以及哪些主要问题被连续暂缓；不能将这些结果当成第一次尚未尝试。优先改变导致失败的策略，而不是再次分配相同对象和操作。确需重新处理同一区域时，在whyPriority中明确这次新的证据、不同操作及可观察区别。已有局部修正无收益时，不应为了容易在修改额度内完成而继续暂缓主导画面的结构比例；可将本轮名额集中给一个有依据的主要目标。历史分数只是已有证据，不能改写或预测本轮分数。先前分开修正的结构若必须联动才能成立，应选择一个覆盖相关模板、实例及必要机位的整体空间目标；不要仅为隔离变量而将已知错误的相邻结构永久冻结。当前提供的编辑范围可能大于历史试验，必须依据当前 repairBudget 规划，而不是照抄历史32部件的上限。
每个目标必须写清当前问题、为何优先、可观察的预期变化和原图/截图证据。evidence.region是对应实际截图中归一化的[x0,y0,x1,y1]，仅描述问题范围，不是面积评分；不能用包围整个画面的矩形夸大收益。referenceIndex是1起的原图序号，纯文字输入填null。每个实例的projectedBounds只是三维包围盒投影，未做遮挡判断，不能当成真实可见面积。照片与重建可能有透视差异，不把投影数据当成已校准答案。
只引用给定的对象、模板、材质、机位、需求和开口ID。templateIds表示允许调整该模板的几何，改模板会影响其所有实例；instanceIds表示允许移动、缩放，或在有原图和实际截图证据时移除的现有实例。结构或布局目标可以纠正多生成的重复物体，须在problem和expectedChange明确可见数量、遮挡或空间关系；不能仅因遮挡看不清就删除，不能移除冻结开口宿主、破坏关键需求或明确数量。materialIds表示允许更改的现有材质及其绑定的局部贴图；纹理裁切或复用来源变化会影响所有引用材质，若有未选材质也引用同一纹理则不能直接修改，应为已选材质建立独立声明。几何目标可同时纠正其已选材质的贴图映射，不需要伪装成新增几何；cameraNames表示允许调整的已有机位。每个目标只选必要对象，合计模板上限见 repairBudget.templates；最多二十个实例、八种材质。需要新增真实几何时addGeometry才为true，新增内容必须服务所选目标，不能堆无关细节。部件修改与删除上限分别见 repairBudget.parts、repairBudget.removeParts；最多16个有依据的实例移除，原复杂度预算不变。编辑上限不是必须用满的数量。
openingDiagnostics只是沿开口法线的射线诊断，不是质量排名。不要因为它给出blocked或missing-background，就自动把整个修正机会用在很小的窗口。仅在图片和整体空间关系证明它应优先时选择kind=opening并列出openingIds；此类目标保留原机位、光照和既有材质，只编辑相关几何。表面目标不能用相机变化充当完成，结构目标不能仅靠换材质或镜头掩盖问题。
deferred记录本轮暂缓的问题和理由。没有可执行且有依据的改进时goals填[]并解释，不承诺分数或声称修改已经成功。
${VISIBILITY_PROMPT}
以下是当前实际支持的构造能力，只用于判断修正目标是否可执行。本步骤仍只选择目标，不输出几何。历史中的能力限制可能已变化，必须说明新能力能改变哪个已观察到的缺陷，不能仅因新增能力就无依据地扩大范围。
${GEOMETRY_RULES}`;

const assert=(ok:any,message:string)=>{if(!ok)throw Error('修正目标：'+message)};
const equal=(a:any,b:any)=>JSON.stringify(a)===JSON.stringify(b);
const text=(v:any)=>typeof v==='string'&&v.trim().length>0;
const uniqueIds=(values:any,allowed:string[],max:number,label:string)=>{
 assert(Array.isArray(values)&&values.length<=max&&new Set(values).size===values.length,label+'重复、数量超限或不是数组');
 const unknown=values.filter((v:any)=>typeof v!=='string'||!allowed.includes(v));assert(!unknown.length,label+'引用未知对象：'+JSON.stringify(unknown)+'；可用ID：'+JSON.stringify(allowed));
};

export function repairGoalContext(source:SceneInput){
 const c=spatialContext(source);
 return {...c,templates:c.templates.map(t=>({id:t.id,localBounds:t.localBounds,partCount:t.parts.length})),
  entities:source.entities,budgetedEntityCount:source.entities.filter(e=>e.role!=='ground').length,entityBudgetRule:'复杂度实体数不含ground地面；部件数按全部实例展开计算，包含地面。',materials:source.program.materials,expandedParts:source.program.instances.reduce((n,i)=>n+source.program.templates.find(t=>t.id===i.template)!.parts.length,0)};
}

/** 检查证据与编辑对象确实存在；优先级仍是待实际画面检验的模型判断。 */
export function validateRepairGoals(value:any,source:SceneInput,plan:any,references:number,frames:string[],budget:RepairBudget=LEGACY_REPAIR_BUDGET){
 assert(value?.version===REPAIR_GOALS_VERSION&&text(value.summary),'版本或摘要无效');
 assert(Array.isArray(value.goals)&&value.goals.length<=3,'单轮最多三个目标');
 assert(Array.isArray(value.deferred)&&value.deferred.length<=6&&value.deferred.every((d:any)=>text(d.problem)&&text(d.reason)),'暂缓原因无效');
 if(!value.goals.length)throw new NoActionableChange('没有有依据的修正目标：'+value.summary);
 const ids=new Set();
 for(const g of value.goals){
  assert(text(g.id)&&!ids.has(g.id),'目标ID无效或重复');ids.add(g.id);
  assert(kinds.includes(g.kind)&&dimensions.includes(g.dimension)&&text(g.problem)&&text(g.whyPriority)&&text(g.expectedChange),'目标描述不完整');
  for(const [key,allowed,max] of [
   ['requirementIds',plan.requirements.map((r:any)=>r.id),12],['instanceIds',source.program.instances.map(i=>i.id),20],
   ['templateIds',source.program.templates.map(t=>t.id),budget.templates],['materialIds',source.program.materials.map(m=>m.id),8],
   ['cameraNames',source.cameras.map(c=>c.name),6],['openingIds',(source.spatialOpenings??[]).map(o=>o.id),8],
  ] as [string,string[],number][])uniqueIds(g[key],allowed,max,key);
  assert(g.requirementIds.length>0,'必须关联冻结需求');
  assert(typeof g.addGeometry==='boolean'&&(!g.addGeometry||['geometry','opening'].includes(g.kind)),'新增几何必须属于结构或开口目标');
  assert(Array.isArray(g.evidence)&&g.evidence.length>0&&g.evidence.length<=6,'缺少图片证据');
  for(const e of g.evidence){
   assert(frames.includes(e.frame)&&text(e.observation),'证据帧不存在或缺少观察');
   assert(references?Number.isInteger(e.referenceIndex)&&e.referenceIndex>=1&&e.referenceIndex<=references:e.referenceIndex===null,'参考图片序号无效');
   const r=e.region;assert(Array.isArray(r)&&r.length===4&&r.every((n:any)=>Number.isFinite(n)&&n>=0&&n<=1)&&r[0]<r[2]&&r[1]<r[3],'证据区域无效');
  }
  if(['layout','geometry','opening'].includes(g.kind))assert(g.instanceIds.length+g.templateIds.length>0,'结构目标必须指定实际对象');
  if(g.kind==='surface')assert(g.materialIds.length>0,'表面目标必须指定材质');
  if(g.kind==='camera')assert(g.cameraNames.length>0,'机位目标必须指定相机');
  if(g.kind==='opening')assert(g.openingIds.length>0&&!g.cameraNames.length&&!g.materialIds.length,'开口目标需要冻结开口并保留观察条件');
  else assert(!g.openingIds.length,'仅开口目标可指定开口修复义务');
 }
 for(const [key,max] of [['templateIds',budget.templates],['instanceIds',20],['materialIds',8]] as const)assert(new Set(value.goals.flatMap((g:any)=>g[key])).size<=max,'本轮'+key+'范围过大');
 return value;
}

/** 编辑落实检查不代表视觉目标已经实现；最终必须独立重渲染和评分。 */
export function assertPlannedRepair(source:SceneInput,next:SceneInput,selection:any){
 const changed=(before:any[],after:any[],key:string)=>before.filter(a=>!equal(a,after.find(b=>b[key]===a[key]))).map(a=>a[key]);
 const changes={templateIds:changed(source.program.templates,next.program.templates,'id'),instanceIds:changed(source.program.instances,next.program.instances,'id'),materialIds:changed(source.program.materials,next.program.materials,'id'),cameraNames:changed(source.cameras,next.cameras,'name')};
 const removedInstanceIds=source.program.instances.filter(i=>!next.program.instances.some(n=>n.id===i.id)).map(i=>i.id);
 const removable=new Set(selection.goals.filter((g:any)=>['layout','geometry','opening'].includes(g.kind)).flatMap((g:any)=>g.instanceIds));
 assert(removedInstanceIds.every(id=>removable.has(id)),'移除了未选择的结构目标实例');
 for(const key of Object.keys(changes) as (keyof typeof changes)[]){const allowed=new Set(selection.goals.flatMap((g:any)=>g[key]));assert(changes[key].every(id=>allowed.has(id)),'修改了未选择的'+key);}
 const lighting=!equal(source.lighting,next.lighting),allowsNew=selection.goals.some((g:any)=>g.addGeometry);
 assert(!lighting||selection.goals.some((g:any)=>g.kind==='lighting'),'修改了未选择的光照');
 const newTemplates=next.program.templates.filter(t=>!source.program.templates.some(s=>s.id===t.id));
 const newInstances=next.program.instances.filter(t=>!source.program.instances.some(s=>s.id===t.id));
 assert(allowsNew||(!newTemplates.length&&!newInstances.length),'未选择新增几何');
 assert(equal(source.spatialOpenings,next.spatialOpenings),'冻结开口不能改变');
 // 材质及其贴图是同一编辑范围；修改共享纹理必须覆盖全部实际使用者。
 const byTexture=(scene:SceneInput,id:string)=>({declaration:scene.textures.find(t=>t.id===id),reuse:scene.textureReuse?.find(t=>t.textureId===id)});
 const textureIds=new Set([...source.textures,...next.textures].map(t=>t.id));
 const changedTextureIds=[...textureIds].filter(id=>!equal(byTexture(source,id),byTexture(next,id)));
 const textureMaterials=(id:string)=>[...new Set([...source.program.materials,...next.program.materials].filter(m=>m.textureId===id).map(m=>m.id))];
 const allowedMaterials=new Set(selection.goals.flatMap((g:any)=>g.materialIds));
 const oldMaterials=new Set(source.program.materials.map(m=>m.id));
 for(const id of changedTextureIds){const users=textureMaterials(id);assert(users.length>0&&users.every(m=>allowedMaterials.has(m)||allowsNew&&!oldMaterials.has(m)),'纹理修改超出已选材质范围：'+id);}
 for(const g of selection.goals){
  const touched=(key:keyof typeof changes)=>g[key].some((id:string)=>changes[key].includes(id));
  const applied=g.kind==='lighting'?lighting:g.kind==='surface'?touched('materialIds')||changedTextureIds.some(id=>textureMaterials(id).some(m=>g.materialIds.includes(m))):g.kind==='camera'?touched('cameraNames'):touched('templateIds')||touched('instanceIds')||(g.addGeometry&&(newTemplates.length+newInstances.length>0));
  assert(applied,'未落实目标的实际修改：'+g.id);
 }
 return {changes,removedInstanceIds,changedTextureIds,lighting,newTemplates:newTemplates.map(t=>t.id),newInstances:newInstances.map(i=>i.id),quality:'not-assessed'};
}
