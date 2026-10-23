import type {AssetGeometry,SceneLayout} from '../geometry/layout';
import {assertAssembledOpenings,assertVoxelDetailOwnership} from './detail-ownership';
import {assertVoxelDetailAssembly,type VoxelDetailAllocation} from './entity-detail';

/**
 * Added parts that block an opening the graybox accepted are removed before any model repair. Village 875110b6 (2026-10-23) had T16 in a
 * cell conflict and T01's new path_ne_3 across I_red_wall's door: the cell check fails first, its single repair went to T16, and T16's
 * repair validation then failed the job on T01's door. A blocker is named `<instance>__<part>__<material>`; only parts the template added
 * are removed, so the accepted seed (which kept the door clear) stays, and at most `limit` parts are dropped before giving up.
 */
export function withoutOpeningBlockers(layout:SceneLayout,assets:AssetGeometry[],acceptedScene:any,limit=8){
 const removed:{templateId:string;partId:string;opening:string}[]=[];
 for(;;){
  try{assertAssembledOpenings(layout,assets,acceptedScene);return {assets,removed};}
  catch(error){
   const m=/封堵已接受开口 (\S+?)，.*blocker (\S+?)__(\S+?)__/.exec(String(error)),templateId=m&&layout.program.instances.find(i=>i.id===m[2])?.template;
   const seeds=templateId?new Set(acceptedScene.program.templates.find((s:any)=>s.id===templateId)?.parts.map((p:any)=>p.id)):null;
   if(!m||!templateId||seeds!.has(m[3])||removed.length>=limit)throw error;
   removed.push({templateId,partId:m[3],opening:m[1]});
   assets=assets.map(a=>a.template.id===templateId?{...a,template:{...a.template,parts:a.template.parts.filter(p=>p.id!==m[3])}}:a);
  }
 }
}
/** A precise merge conflict gets one coordinated entity repair, never a fresh
 * scene or an unbounded retry. All siblings stay frozen during that repair. */
export async function mergeVoxelDetails(layout:SceneLayout,assets:AssetGeometry[],acceptedScene:any,allocation:VoxelDetailAllocation,textures:any,options:{signal:AbortSignal;canRepair:()=>boolean;repair:(templateId:string,feedback:any,validate:(value:AssetGeometry)=>void)=>Promise<AssetGeometry>}){
 const check=(values:AssetGeometry[])=>({budget:assertVoxelDetailAssembly(layout,values,allocation,textures),ownership:assertVoxelDetailOwnership(layout,values,acceptedScene)});
 options.signal.throwIfAborted();
 const cleared=withoutOpeningBlockers(layout,assets,acceptedScene);assets=cleared.assets;const openingBlockers=cleared.removed.length?{removed:cleared.removed}:{};
 try{return {assets,report:{...check(assets),...openingBlockers},repair:null};}
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
  return {assets:selected,report:{...check(selected),...openingBlockers},repair:{templateId:target.id,feedback,attempts:1}};
 }
}
