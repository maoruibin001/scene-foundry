import type {AssetGeometry,SceneLayout} from '../geometry/layout';
import {assertVoxelDetailOwnership} from './detail-ownership';
import {assertVoxelDetailAssembly,type VoxelDetailAllocation} from './entity-detail';

/** A precise merge conflict gets one coordinated entity repair, never a fresh
 * scene or an unbounded retry. All siblings stay frozen during that repair. */
export async function mergeVoxelDetails(layout:SceneLayout,assets:AssetGeometry[],acceptedScene:any,allocation:VoxelDetailAllocation,textures:any,options:{signal:AbortSignal;canRepair:()=>boolean;repair:(templateId:string,feedback:any,validate:(value:AssetGeometry)=>void)=>Promise<AssetGeometry>}){
 const check=(values:AssetGeometry[])=>({budget:assertVoxelDetailAssembly(layout,values,allocation,textures),ownership:assertVoxelDetailOwnership(layout,values,acceptedScene)});
 options.signal.throwIfAborted();
 try{return {assets,report:check(assets),repair:null};}
 catch(error){
  options.signal.throwIfAborted();
  const message=String(error);
  if(!/新增细节实体在同一格冲突|新增部件封堵已接受开口/.test(message)||!options.canRepair())throw error;
  const candidates=layout.program.templates.filter(t=>{
   const asset=assets.find(a=>a.template.id===t.id)!;
   const seeds=new Set(acceptedScene.program.templates.find((s:any)=>s.id===t.id).parts.map((p:any)=>p.id));
   return asset.template.parts.some(p=>!seeds.has(p.id));
  });
  const implicated=candidates.filter(t=>layout.program.instances.some(i=>i.template===t.id&&message.includes(i.id)));
  const target=(implicated.length?implicated:candidates).at(-1);
  if(!target)throw error;
  const feedback={version:'voxel-detail-merge-feedback-v1',error:message,templateId:target.id,maximumCoordinatedRepairs:1,frozenSiblings:assets.filter(a=>a.template.id!==target.id),instructions:'仅修正此模板新增细节的实际格冲突或开口遮挡，保留原灰模种子、全部其他模板和预算。没有解决全部冲突的候选不能选择。'};
  const replace=(value:AssetGeometry)=>assets.map(a=>a.template.id===target.id?value:a);
  const repaired=await options.repair(target.id,feedback,value=>{check(replace(value));});
  options.signal.throwIfAborted();const selected=replace(repaired);
  return {assets:selected,report:check(selected),repair:{templateId:target.id,feedback,attempts:1}};
 }
}
