import type {SceneInput} from './scene-contract';
import {repairPartContext} from './repair-part-context';
/** 共用写入对象或耦合空间调整放在同一调用；独立目标才可并行。 */
export function repairBatches(selection:any,source:SceneInput,maxBatches=Infinity){
 if(maxBatches!==Infinity&&(!Number.isInteger(maxBatches)||maxBatches<1))throw Error('修复调用额度不足，需保留成品评审额度');
 // A camera edit changes the reference projection for every geometry goal,
 // even when the two patches write disjoint object IDs. Solve them together.
 const lightingChanges=selection.goals.some((g:any)=>g.kind==='lighting');
 const cameraChanges=selection.goals.some((g:any)=>g.cameraNames.length>0);
 const keys=(g:any)=>{
  const templates=new Set([...g.templateIds,...source.program.instances.filter(i=>g.instanceIds.includes(i.id)).map(i=>i.template)]);
  const textures=source.program.materials.filter(m=>g.materialIds.includes(m.id)&&m.textureId).map(m=>'texture:'+m.textureId);
  return new Set([...templates].map(id=>'template:'+id).concat(g.instanceIds.map(id=>'instance:'+id),g.materialIds.map(id=>'material:'+id),g.cameraNames.map(id=>'camera:'+id),textures,['layout','opening','camera'].includes(g.kind)||cameraChanges&&(g.cameraNames.length>0||g.kind==='geometry')?['spatial']:[],g.kind==='lighting'?['lighting']:[],g.addGeometry?['new-geometry']:[],lightingChanges?['shared-illumination']:[]));
 };
 const groups:{goals:any[];keys:Set<string>}[]=[];
 for(const g of selection.goals){
  const k=keys(g),matches=groups.filter(b=>[...k].some(x=>b.keys.has(x)));
  const merged={goals:[...matches.flatMap(b=>b.goals),g],keys:new Set([...k,...matches.flatMap(b=>[...b.keys])])};
  for(const b of matches)groups.splice(groups.indexOf(b),1);
  groups.push(merged);
 }
 // 原子依赖组保持完整；调用额度有限时合并较小独立组，不丢弃任何目标。
 while(groups.length>maxBatches){groups.sort((a,b)=>a.goals.length-b.goals.length);const a=groups.shift()!,b=groups.shift()!;groups.push({goals:[...a.goals,...b.goals],keys:new Set([...a.keys,...b.keys])});}
 return groups.map((b,index)=>({...selection,goals:b.goals,id:'batch-'+(index+1)}));
}
/** 模型只收到可编辑部件；未选物件仍保留世界变换和范围，防止失去空间上下文。 */
export function repairSourceContext(source:SceneInput,anchors:any[],selection:any){
 const templatesFor=(g:any)=>[...g.templateIds,...source.program.instances.filter(i=>g.instanceIds?.includes(i.id)).map(i=>i.template)];
 const editable=new Set(selection.goals.flatMap(templatesFor)),geometry=new Set(selection.goals.filter(g=>!['surface','lighting'].includes(g.kind)).flatMap(templatesFor)),surfaceOnly=geometry.size===0;
 const selected=anchors.filter(t=>editable.has(t.id)).map(t=>({...t,parts:t.parts.map(p=>repairPartContext(p,geometry.has(t.id)))}));
 return {...source,assumptions:source.assumptions.slice(0,14),program:{...source.program,templates:selected},
  frozenTemplates:anchors.filter(t=>!editable.has(t.id)).map(t=>({id:t.id,meshBounds:t.meshBounds,partCount:t.parts.length})),
  surfaceOnly,contextRule:(surfaceOnly?'当前仅修改表面与光照，使用surfaceUpdates，不得重写几何。':'')+'逐模板按目标提供上下文：仅改表面的模板省略密集形状数组；几何目标保留小型完整数据，大型数组标注 Omitted、数量、来源摘要和可用范围。省略不是缺失几何，禁止把摘要当作完整部件提交；需要修改具体形状时先用 inspect_scene_parts 读取原始部件。program.templates 仅列可编辑部件；frozenTemplates 是保留的真实资产。完整 instances、cameras 与所有材质保持可见；未选对象禁止重建或修改。'};
}
/** 并行结果不做 last-write-wins；冲突必须显式停止，完整合并后再做原契约检查。 */
export function mergeRefinementPatches(patches:any[]){
 if(!patches.length)throw Error('修复批次为空');
 const out:any={version:'scene-refinement-v5',reason:patches.map(p=>p.reason).join('；'),lighting:null,assumptions:patches.flatMap(p=>p.assumptions)};
 const keys:any={screenTargets:(v:any)=>v.instanceId,instances:(v:any)=>v.id,cameras:(v:any)=>v.referenceIndex===null?v.name:'ref:'+v.referenceIndex,materials:(v:any)=>v.id,removeInstances:(v:any)=>v.instanceId,surfaceUpdates:(v:any)=>v.templateId+'/'+v.partId,parts:(v:any)=>v.templateId+'/'+v.part.id,removeParts:(v:any)=>v.templateId+'/'+v.partId,addTemplates:(v:any)=>v.id,addEntities:(v:any)=>v.instanceId,textures:(v:any)=>v.id,textureReuse:(v:any)=>v.textureId};
 for(const [field,key] of Object.entries(keys)){
  const entries=patches.flatMap(p=>p[field]??[]),ids=entries.map(key as any);
  if(new Set(ids).size!==ids.length)throw Error('并行修复写入冲突：'+field);
  out[field]=entries;
 }
 for(const t of out.screenTargets)if(out.instances.some(i=>i.id===t.instanceId)||out.removeInstances.some(i=>i.instanceId===t.instanceId))throw Error('并行修复写入冲突：图像约束与实例');
 for(const u of out.surfaceUpdates)if(out.parts.some(p=>p.templateId===u.templateId&&p.part.id===u.partId)||out.removeParts.some(p=>p.templateId===u.templateId&&p.partId===u.partId))throw Error('并行修复写入冲突：部件表面与几何');
 const lights=patches.filter(p=>p.lighting!==null);
 if(lights.length>1)throw Error('并行修复写入冲突：lighting');
 if(lights.length)out.lighting=lights[0].lighting;
 return out;
}

/** 选目标不需要逐部件遮挡或完整净空参数；执行阶段仍取未压缩的冻结数据。 */
export function repairPlanningContext(input:any){
 const out=structuredClone(input),scene=out.scene;
 if(out.surfaceBindings)out.surfaceBindings=out.surfaceBindings.map(m=>({id:m.id,textureId:m.textureId,templates:[...new Set(m.parts.map(p=>p.templateId))].map(templateId=>{const parts=m.parts.filter(p=>p.templateId===templateId);return {templateId,partIds:parts.map(p=>p.partId),shapes:[...new Set(parts.map(p=>p.shape))],instances:parts[0]?.instances??[]};})}));
 if(scene?.spatialOpenings)scene.spatialOpenings=scene.spatialOpenings.map(({id,label,instanceId,expectedBeyond,referenceIndices})=>({id,label,instanceId,expectedBeyond,referenceIndices}));
 if(scene?.openingDiagnostics?.checks){const checks=scene.openingDiagnostics.checks;scene.openingDiagnostics={...scene.openingDiagnostics,total:checks.length,clearCount:checks.filter(c=>c.status==='clear').length,checks:checks.filter(c=>c.status!=='clear')};}
 if(out.geometryVisibility?.views)out.geometryVisibility.views=out.geometryVisibility.views.map(v=>({
  cameraName:v.cameraName,referenceIndex:v.referenceIndex,width:v.width,height:v.height,
  instances:v.instances.map(({visibleParts,...i})=>({...i,visibleMaterials:[...new Set((visibleParts??[]).map(p=>p.materialId))]})),
  instanceOcclusions:v.instanceOcclusions,
 }));
 out.planningScope='仅选择修复目标：净空完整参数、逐部件形状和遮挡记录在执行阶段读取。诊断摘要不是画面质量结论。坐标摘要四舍五入到四位小数，不能作为编辑数值来源。';
 return JSON.parse(JSON.stringify(out,(_key,value)=>typeof value==='number'&&!Number.isInteger(value)?Math.round(value*10000)/10000:value));
}

/** 执行只接收所选对象的表面绑定；所选共享材质仍保留全部引用，不能隐藏连带影响。 */
export function repairExecutionContext(input:any){
 const goals=input.repairGoals?.goals??[];
 if(!goals.length||goals.some((g:any)=>g.kind==='lighting'))return input;
 const selectedMaterials=new Set(goals.flatMap((g:any)=>g.materialIds));
 const selectedTemplates=new Set(goals.flatMap((g:any)=>g.templateIds));
 const selectedInstances=new Set(goals.flatMap((g:any)=>g.instanceIds));
 for(const i of input.sourceScene?.program?.instances??[])if(selectedInstances.has(i.id))selectedTemplates.add(i.template);
 return {...input,surfaceBindings:(input.surfaceBindings??[]).map((m:any)=>({...m,parts:selectedMaterials.has(m.id)?m.parts:m.parts.filter((p:any)=>selectedTemplates.has(p.templateId))})).filter((m:any)=>m.parts.length),surfaceBindingScope:'仅列所选模板及材质相关表面。所选共享材质保留全部引用；未选对象仍受完整后端契约保护，不因摘要省略而视为不存在。'};
}
