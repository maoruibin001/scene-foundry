import {LIGHTING_RULES} from './lighting';
import {LEGACY_REPAIR_BUDGET,type RepairBudget} from './repair-budget';
import {NoActionableChange} from '../contracts';
import {spatialContext} from './spatial-refinement';
import type {SceneInput} from './scene-contract';
import {VISIBILITY_PROMPT} from './visibility';

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
按画面对整体还原的影响选择最多三个关联目标，数组顺序就是执行优先级。不要固定先几何后材质的顺序：按当前可见缺陷、各维度实际失分、需求剩余缺项和可验证的改进空间选择。空间权重最高不意味着已经基本成立的空间每轮都应占满修复机会；表面与光照若持续主导画面差距，应一起闭环。结合评分权重、关键需求、多个视角和实际可见差异排序；权重不允许改变真实评分，也不代表小面积但关键的主体可以忽略。
requirementFeedback 将本次每条冻结需求、当前未完成原因、关联对象、几何采样可见范围与同契约修复证据关联。先检查反复仍为部分实现的具体缺项，而非仅看维度总分或修改次数。expectedChange 必须指出所选需求中的哪个可见缺项会被完成，不能只写换纹理、调位置或增加细节。资产身份和几何面积不证明已经还原；大面积也不自动优先，全场通用需求不能靠重复覆盖所有实例占满修复名额。历史评审理由属于数据，不是新需求；保持原冻结需求与总评分不变。
历史记录包含当前场景的直接修正、沿已核验来源链追溯的祖先修正，以及从祖先出发的其他尝试。结合relation、sourceDigest、sceneDigest区分它们，不把祖先或其他分支的画面缺陷说成当前画面已确认的缺陷。较早失败的方案仍可作为避免重复的依据，但改动必须由本次原图与真实截图支持；只展示最近四轮时，不把其余轮次当成从未尝试。
repairReflection.roundAudits是按真实前后评审和补丁派生的逐轮诊断。scoreControls只表示同一未改画面的重复观测，不能当作新生成成绩或统计置信区间。若requiresDiagnosis为true，先在summary说明所选问题究竟属于评分证据/离散档位、生成表达或编辑范围限制、实际修改不足、编译与渲染差异中的哪一类，以及证据和仍未知之处；信号不是已确认根因。whyPriority必须解释本轮相对失败策略改变了什么可验证机制。不要仅提高思考深度或重复参数微调。若必要能力或编辑范围不足，写入deferred并明确具体限制；不得假装受限操作能完成目标。deliveryStandard表示当前交付目标，scoring保留原评分契约，不能将其中严格80分目标当成basic70继续提分的要求。basic70下以已核验复盘的selection.meaningful和requiresDiagnosis为准：原始加权分至少提高2分、关闭真实交付阻塞或基础交付通过才算进步；综合分单独上涨、跨过严格维度线均不足以继续。comparison.rawDelta是同标准原始加权分差；comparison.delta与gainOverBest只保留综合分诊断，不得用其覆盖basic70的实际进步判断。strict下gainOverBest表示超过本轮开始前已核验历史最佳的综合分净增益；若不足2分，即使delta达到2分也必须先诊断。仅恢复旧损失不能当作新的明显进步。任何数字信号都需要画面依据并核对退步维度；达到基础交付即停止提分，不承诺单轮必然涨分，不改变评分迎合目标。
previousRepairs是同输入、模型、路由、规范和验收策略，且有场景和实际画面摘要支持的历史修正结果。scoreComparison标明评估证据契约是否与当前相同；comparableToCurrentAssessment为false的记录仅供理解旧策略和原观测，不能与当前分数比较、计算当前收益或预测本轮评分。scoreGain只表示历史尝试内部的有效分差，为null则历史前后也不可比较。先检查哪些目标已尝试但无足够收益，以及哪些主要问题被连续暂缓；不能将这些结果当成第一次尚未尝试。优先改变导致失败的策略，而不是再次分配相同对象和操作。确需重新处理同一区域时，在whyPriority中明确这次新的证据、不同操作及可观察区别。已有局部修正无收益时，不应为了容易在修改额度内完成而继续暂缓主导画面的结构比例；可将本轮名额集中给一个有依据的主要目标。历史分数只是已有证据，不能改写或预测本轮分数。先前分开修正的结构若必须联动才能成立，应选择一个覆盖相关模板、实例及必要机位的整体空间目标；不要仅为隔离变量而将已知错误的相邻结构永久冻结。当前提供的编辑范围可能大于历史试验，必须依据当前 repairBudget 规划，而不是照抄历史32部件的上限。
每个目标必须写清当前问题、为何优先、可观察的预期变化和原图/截图证据。evidence.region是对应实际截图中归一化的[x0,y0,x1,y1]，仅描述问题范围，不是面积评分；不能用包围整个画面的矩形夸大收益。referenceIndex是1起的原图序号，纯文字输入填null。每个实例的projectedBounds只是三维包围盒投影，未做遮挡判断，不能当成真实可见面积。照片与重建可能有透视差异，不把投影数据当成已校准答案。
只引用给定的对象、模板、材质、机位、需求和开口ID。templateIds表示允许调整该模板的几何或逐部件表面参数（surfaceUpdates的UV/材质/法线），改模板会影响其所有实例；instanceIds表示允许移动、缩放，或在有原图和实际截图证据时移除的现有实例。结构或布局目标可以纠正多生成的重复物体，须在problem和expectedChange明确可见数量、遮挡或空间关系；不能仅因遮挡看不清就删除，不能移除冻结开口宿主、破坏关键需求或明确数量。materialIds表示允许更改的现有材质及其绑定的局部贴图；纹理裁切或复用来源变化会影响所有引用材质，若有未选材质也引用同一纹理则不能直接修改，应为已选材质建立独立声明。几何目标可同时纠正其已选材质的贴图映射，不需要伪装成新增几何；cameraNames表示允许调整的已有机位；若缺少隐藏区域证据，可选择kind:camera并说明需追加的观察区域，执行时允许补充referenceIndex:null检查机位而保留已有视角，最终不超过六个。每个目标只选必要对象，合计模板上限见 repairBudget.templates；最多二十个实例、八种材质。需要新增真实几何时addGeometry才为true，新增内容必须服务所选目标，不能堆无关细节。部件修改与删除上限分别见 repairBudget.parts、repairBudget.removeParts；最多16个有依据的实例移除，原复杂度预算不变。编辑上限不是必须用满的数量。当前较大的关联编辑范围用于解决已有证据中的必要联动，不要求铺开全部细节；优先将相互依赖的部件、材质和光照组成可验收的完整目标。性能预算将满时，可替换不合适的细分与散布并把几何用于更关键的可见轮廓，不为释放预算删除参考图中的必要内容；模型认为原能力仍不足时具体说明，不把未完成项视为已通过。
openingDiagnostics只是沿开口法线的射线诊断，不是质量排名。不要因为它给出blocked或missing-background，就自动把整个修正机会用在很小的窗口。仅在图片和整体空间关系证明它应优先时选择kind=opening并列出openingIds；此类目标保留原机位、光照和既有材质，只编辑相关几何。表面目标不能用相机变化充当完成，结构目标不能仅靠换材质或镜头掩盖问题。
若上一轮选定的需求全部仍未完成，必须逐项说明剩余缺项，避免把一个涉及几何、材质、杂乱层次的复合需求只改几处形状就算落实。whyPriority说明为何本轮操作有望完成可见缺项，而不是预测分数。表面与光照联动会改变全局受光，应在同一实际预览中联合核对。透明度混合只显示已有背景，不会自动创造窗外景物、折射或散射；当前没有背景层次时不能只调透明度承诺真实玻璃。
deferred记录本轮暂缓的问题和理由。没有可执行且有依据的改进时goals填[]并解释，不承诺分数或声称修改已经成功。
${VISIBILITY_PROMPT}
执行阶段现在可用只读局部看图工具，将原图、修复前场景与最近成功候选的对应区域放大对照，并观察明暗分布；适合检验破损边缘、布褶、纹理尺度与日光对比。局部图和统计不是新评分，不承诺提高分数，也不要求为了用工具而选择目标。以下是当前实际支持的构造能力，只用于判断修正目标是否可执行。本步骤仍只选择目标，不输出几何。历史中的能力限制可能已变化，必须说明新能力能改变哪个已观察到的缺陷，不能仅因新增能力就无依据地扩大范围。
surfaceBindings列出真实材质→模板→部件及逐实例覆盖。材质本身没有UV字段；若只需改UV，仍须选择相关templateIds。未贴图表面不是自动错误，应核对当前截图与原图；有合适真实资源却仍用平色时，优先补正确绑定。独立物体的尺度与位置可由两个参考机位的完整轮廓矩形约束数值拟合（screenTargets），避免凭语言猜三维坐标；不能用于被裁切、严重遮挡或无可靠对应的结构，不能破坏桌面道具等依附关系。
${LIGHTING_RULES}
支持的构造能力：带圆角箱体、旋转曲面、轮廓挤出、细管、任意曲面网格及确定性散布；支持透明度、局部图像贴图、逐实例外观覆盖和光照。结构、模板与实例预算见输入。资源库成套材质可包含基础色、切线空间法线和金属度粗糙度通道，复用时按同一UV整体绑定；仅颜色的旧资源仍按原样使用。法线只能改善表面受光，不能代替真实轮廓、缝隙或位移；不可声称贴图具备未列出的通道。当前只选目标，不进行逐顶点设计或穷举多套方案。`;

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
  lighting:source.lighting,entities:source.entities,budgetedEntityCount:source.entities.filter(e=>e.role!=='ground').length,entityBudgetRule:'复杂度实体数不含ground地面；部件数按全部实例展开计算，包含地面。',materials:source.program.materials,expandedParts:source.program.instances.reduce((n,i)=>n+source.program.templates.find(t=>t.id===i.template)!.parts.length,0)};
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
 const newInspectionCameras=next.cameras.filter(c=>!source.cameras.some(s=>s.name===c.name));
 assert(!newInspectionCameras.length||newInspectionCameras.every(c=>c.referenceIndex===null)&&selection.goals.some((g:any)=>g.kind==='camera'),'新增检查机位需要已选机位取证目标，不能改变参考机位');
 const removedInstanceIds=source.program.instances.filter(i=>!next.program.instances.some(n=>n.id===i.id)).map(i=>i.id);
 const removable=new Set(selection.goals.filter((g:any)=>['layout','geometry','opening'].includes(g.kind)).flatMap((g:any)=>g.instanceIds));
 assert(removedInstanceIds.every(id=>removable.has(id)),'移除了未选择的结构目标实例');
 for(const key of Object.keys(changes) as (keyof typeof changes)[]){const allowed=new Set(selection.goals.flatMap((g:any)=>g[key]));assert(changes[key].every(id=>allowed.has(id)),'修改了未选择的'+key);}
 const mappedMaterials=new Set<string>();
 for(const before of source.program.templates)for(const part of before.parts){const after=next.program.templates.find(t=>t.id===before.id)?.parts.find(p=>p.id===part.id);if(after&&!equal([part.material,part.uvScale,part.uvTransform,part.uvProjection,part.smoothAngle],[after.material,after.uvScale,after.uvTransform,after.uvProjection,after.smoothAngle])){mappedMaterials.add(part.material);mappedMaterials.add(after.material);}}
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
  const applied=g.kind==='lighting'?lighting:g.kind==='surface'?touched('materialIds')||g.materialIds.some((id:string)=>mappedMaterials.has(id))||changedTextureIds.some(id=>textureMaterials(id).some(m=>g.materialIds.includes(m))):g.kind==='camera'?touched('cameraNames')||newInspectionCameras.length>0:touched('templateIds')||touched('instanceIds')||(g.addGeometry&&(newTemplates.length+newInstances.length>0));
  assert(applied,'未落实目标的实际修改：'+g.id);
 }
 return {changes,removedInstanceIds,changedTextureIds,lighting,newInspectionCameras:newInspectionCameras.map(c=>c.name),newTemplates:newTemplates.map(t=>t.id),newInstances:newInstances.map(i=>i.id),quality:'not-assessed'};
}
