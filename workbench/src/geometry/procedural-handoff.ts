import {stable} from '../validated-cache';
import {validateCrown} from './branch-crown';
import {shapeTriangles} from './program';
import {assetTriangleBudget} from './triangle-budget';
import {assetPartCapacity} from './surface-part-budget';

export function proceduralSeeds(scene:any,templateId:string){return (scene?.program?.templates?.find((t:any)=>t.id===templateId)?.parts??[]).filter((p:any)=>p.shape?.type==='branchCrown').map((p:any)=>structuredClone(p));}
export const PROCEDURAL_HANDOFF_RULES='保留已验收branchCrown部件id、姿态及全部结构参数，仅可调整segments与材质/UV，或按原id+_branches和原id+_leaves拆层绑定材质；不得重抽seed、改变枝叶密度或缩冠。';
/** A preserved seed must be feasible under the later per-asset allocation, not just the scene ceiling. */
export function assertProceduralBudget(scene:any,layout:any){
 const rows=[];
 for(const t of scene?.program?.templates??[]){
  const seeds=proceduralSeeds(scene,t.id);if(!seeds.length)continue;
  const brief=layout.program.templates.find((b:any)=>b.id===t.id);
  if(!brief)throw Error('PROCEDURAL_BUDGET_INFEASIBLE：枝冠模板没有对应冻结简报 '+t.id);
  const budget=assetTriangleBudget(layout,brief),maximumParts=assetPartCapacity(layout,brief).maxParts;
  const minimumTriangles=seeds.reduce((n:number,p:any)=>n+shapeTriangles({...p.shape,segments:2}),0);
  const row={templateId:t.id,minimumTriangles,maximumTriangles:budget.maximum,minimumParts:seeds.length,maximumParts,instances:budget.instances};rows.push(row);
  if(minimumTriangles>budget.maximum||seeds.length>maximumParts)throw Error('PROCEDURAL_BUDGET_INFEASIBLE：'+t.id+' 保留枝冠最低需 '+minimumTriangles+' 三角形/'+seeds.length+' 部件，详细资产额度 '+budget.maximum+' 三角形/'+maximumParts+' 部件，实例数 '+budget.instances+'。请在空间验收前减少枝叶结构密度或冠组数量并重新预览；不能改变既有总预算，也不能验收后丢弃结构。');
 }
 return rows;
}
const structure=(s:any)=>{validateCrown(s);const {segments,layer,...rest}=s;return rest;};
/** Keep accepted anchors/envelopes, allow tessellation and separate branch/leaf PBR materials. */
export function assertProceduralHandoff(value:any,scene:any){
 const seeds=proceduralSeeds(scene,value.template.id);if(!seeds.length)return;
 for(const seed of seeds){
  const parts=value.template.parts.filter((p:any)=>p.id===seed.id||p.id===seed.id+'_branches'||p.id===seed.id+'_leaves');
  const fail=()=>{throw Error('PROCEDURAL_STRUCTURE_CHANGED：保留已验收枝冠 '+seed.id+' 的结构参数和姿态；仅可改变segments/材质/UV，或拆为原id+_branches与原id+_leaves两层。');};
  if(!parts.length)fail();
  for(const p of parts)if(p.shape?.type!=='branchCrown'||stable(structure(p.shape))!==stable(structure(seed.shape))||stable([p.position,p.rotation,p.scale])!==stable([seed.position,seed.rotation,seed.scale]))fail();
  const layers=parts.map((p:any)=>p.shape.layer).sort();
  if(!(parts.length===1&&parts[0].id===seed.id&&layers[0]==='whole')&&!(parts.length===2&&stable(layers)===stable(['branches','leaves'])&&parts.every((p:any)=>p.id===seed.id+'_'+p.shape.layer)))fail();
 }
}
