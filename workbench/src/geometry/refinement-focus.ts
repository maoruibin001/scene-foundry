import {inspectOpenings,openingSummary} from './openings';
import {compileGeometryProgram} from './program';
import type {SceneInput} from './scene-contract';

const severe=(status:string)=>status==='blocked'||status==='missing-background';
const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const assert=(ok:unknown,message:string)=>{if(!ok)throw Error('空间缺陷修正：'+message)};
/** 只从冻结声明和实际网格取目标；不根据样例名称、物体类别或模型自述选目标。 */
export function refinementFocus(source:SceneInput,report=openingSummary(inspectOpenings(source)),selectedIds?:string[]){
 const targets=report.checks.filter(c=>severe(c.status)&&(!selectedIds||selectedIds.includes(c.id)));if(!targets.length)return null;
 const ownerIds=new Set(targets.map(c=>c.instanceId)),blockerIds=new Set<string>();
 const meshes=compileGeometryProgram({...source.program,materials:source.program.materials.map(m=>({...m,textureId:null}))}).meshes;
 const meshOwner=new Map(meshes.map(m=>[m.name,m.entityId]));
 for(const target of targets)for(const id of Object.keys(target.blockers)){const instance=meshOwner.get(id);if(instance)blockerIds.add(instance);}
 const editableTemplates=source.program.instances.filter(i=>ownerIds.has(i.id)||blockerIds.has(i.id)).map(i=>i.template);
 return {version:'opening-repair-focus-v1',targets,editableTemplateIds:[...new Set(editableTemplates)],
  movableInstanceIds:[...blockerIds].filter(id=>!ownerIds.has(id)),fixedOpeningInstanceIds:[...ownerIds],
  minimumClearFraction:.8,minimumBackgroundFraction:.8,
  scope:'优先落实已检测的空间缺陷。本轮只编辑相关模板或遮挡实例，并可补充必要三维后景；保留原相机、光照及既有材质纹理。原总预算不变，命中射线不代表视觉还原通过。'};
}
export type RefinementFocus=NonNullable<ReturnType<typeof refinementFocus>>;
export const FOCUSED_REFINEMENT_PROMPT=`输入有repairFocus时，本轮只完成其中列出的空间目标。优先保证已声明开口的净空和实际三维后景，不能将修改额度分散到其他结构、家具、材质或机位。repairFocus不是降低原始需求，后续仍按原图和全部需求独立验收。
parts及removeParts只允许引用editableTemplateIds；已有实例只有movableInstanceIds可以改变位置或在有明确原图证据时用removeInstances移除错误遮挡物，所有开口所属实例的变换固定且不可删除，不能移动洞口避开诊断。可在相关模板内补充几何，或通过addTemplates和新的instances/addEntities增加必要后景。复用已有材料；确需新材料或局部纹理时仅新增ID，不得覆盖既有资源。cameras填[]，lighting填null，保留原始观察条件，避免靠改变机位或照明掩盖遗漏。
每个目标至少80%的采样射线需要保持声明的净空；expectedBeyond为geometry时，至少80%需在净空之外命中真实后景。不许用大平面、整张参考图、同一薄片封窗来凑射线命中；几何必须有与原图相符的形状、厚度及多视角关系。已无严重问题的其他开口不能因此新增封堵或缺失后景。程序会实际编译复查，仍遗漏目标则不会进入构建和独立评分；最多一次按具体错误纠正，之后停止。reason仅描述本次数据中已落实的修改，未落实内容不能写成已完成。`;

/** 对焦点以外的正确资源保持字节语义不变，再检查实际几何变化，绝不由文本声明放行。 */
export function assertRefinementFocus(source:SceneInput,next:SceneInput,focus:RefinementFocus){
 assert(equal(source.spatialOpenings,next.spatialOpenings),'不得更改或删除已冻结开口');
 assert(equal(source.cameras,next.cameras)&&equal(source.lighting,next.lighting),'本轮保留相机与光照');
 for(const t of source.program.templates)if(!focus.editableTemplateIds.includes(t.id))assert(equal(t,next.program.templates.find(x=>x.id===t.id)),'改变无关模板：'+t.id);
 for(const i of source.program.instances)if(!focus.movableInstanceIds.includes(i.id))assert(equal(i,next.program.instances.find(x=>x.id===i.id)),'改变固定实例：'+i.id);
 for(const [label,before,after,key] of [
  ['材质',source.program.materials,next.program.materials,'id'],['贴图',source.textures,next.textures,'id'],
  ['复用绑定',source.textureReuse??[],next.textureReuse??[],'textureId'],['实体语义',source.entities,next.entities,'instanceId'],
 ] as [string,any[],any[],string][])for(const item of before){
  if(label==='实体语义'&&focus.movableInstanceIds.includes(item.instanceId)&&!next.program.instances.some(i=>i.id===item.instanceId))continue;
  assert(equal(item,after.find(x=>x[key]===item[key])),'改变已有'+label+'：'+item[key]);
 }
 const after=openingSummary(inspectOpenings(next)),before=openingSummary(inspectOpenings(source));
 const failures=focus.targets.flatMap(target=>{
  const result=after.checks.find(c=>c.id===target.id);
  return !result||result.blockedFraction>1-focus.minimumClearFraction+1e-8||result.expectedBeyond==='geometry'&&result.emptyBeyondFraction>1-focus.minimumBackgroundFraction+1e-8
   ?[{id:target.id,blockedFraction:result?.blockedFraction,emptyBeyondFraction:result?.emptyBeyondFraction,blockers:result?.blockers}]:[];
 });
 assert(!failures.length,'目标尚未落实，请优先修改对应实际几何：'+JSON.stringify(failures));
 const regressed=after.checks.filter(c=>severe(c.status)&&!severe(before.checks.find(b=>b.id===c.id)?.status??'clear'));
 assert(!regressed.length,'引入新的严重开口问题：'+JSON.stringify(regressed));
 return after;
}
