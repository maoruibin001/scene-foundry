import {assetGeometryBasis} from './asset-geometry-basis';
import {proceduralSeeds,assertProceduralHandoff} from './procedural-handoff';
import {digest} from '../store';
import {stable} from '../validated-cache';
import {spatialInstances} from './spatial-order';

export const ASSET_CONTEXT_VERSION='accepted-space-context-v1';
export type AssetSceneContext={scene:any;review?:any;observation?:any};

/** The other objects are the accepted blockout, never invented finished assets. */
export function assetContextContract(layout:any,context:AssetSceneContext){
 const scene=context.scene;
 if(!scene?.program?.templates?.length||stable(spatialInstances(scene.program.instances))!==stable(spatialInstances(layout.program.instances))||stable(scene.cameras)!==stable(layout.cameras))throw Error('ASSET_CONTEXT_CHANGED：资产上下文必须使用已验收的实例和机位');
 const ids=scene.program.templates.map((t:any)=>t.id).sort(),expected=layout.program.templates.map((t:any)=>t.id).sort();
 if(stable(ids)!==stable(expected))throw Error('ASSET_CONTEXT_INCOMPLETE：灰模模板不完整');
 return digest(stable({version:ASSET_CONTEXT_VERSION,layout,scene:context.scene,observation:context.observation??null}));
}

export function assetSpatialHandoff(brief:any,layout:any,context:AssetSceneContext){
 const contextSha256=assetContextContract(layout,context),instances=layout.program.instances.filter((i:any)=>i.template===brief.id),ids=new Set(instances.map((i:any)=>i.id));
 const relations=(layout.spatialRelations??[]).filter((r:any)=>r.instanceIds.some((id:string)=>ids.has(id))).map((r:any)=>({...r,review:context.review?.relations?.find((v:any)=>v.id===r.id)??null}));
 const visible=(context.observation?.landmarks??[]).filter((l:any)=>layout.observedBindings?.some((b:any)=>b.landmarkId===l.id&&b.instanceIds.some((id:string)=>ids.has(id))));
 const cameras=layout.cameras.filter((c:any)=>c.referenceIndex!==null);
 if(!cameras.length)throw Error('ASSET_CONTEXT_CAMERA_REQUIRED：上下文缺少参考机位');
 const area=(c:any)=>Math.max(0,...visible.flatMap((l:any)=>l.views.filter((v:any)=>v.referenceIndex===c.referenceIndex).map((v:any)=>(v.box[2]-v.box[0])*(v.box[3]-v.box[1]))));
 const camera=[...cameras].sort((a,b)=>area(b)-area(a)||a.referenceIndex-b.referenceIndex)[0];
 return {version:ASSET_CONTEXT_VERSION,contextSha256,instances,referenceCamera:camera,relations,
  acceptedGeometrySha256:assetGeometryBasis(context.scene,brief.id)?.sha256??null,
  proceduralStructure:proceduralSeeds(context.scene,brief.id),
  proceduralInstructions:'若存在proceduralStructure，保留各branchCrown部件id/姿态/所有结构参数，调整segments与材质/UV，或按id+_branches和id+_leaves两部件拆层绑定不同材质。不能重抽seed、改密度、缩冠或重造已验收轮廓；其他非程序部件按简报细化。',
  scope:'世界布局和机位已冻结；当前资产必须在这些实际位置形成有依据的轮廓与承托。上下文其余物体是已验收灰模，不是最终成品，不能用灰模密度冒充完整场景质量。',
  residuals:relations.filter((r:any)=>r.review&&r.review.verdict!=='met').map((r:any)=>({id:r.id,verdict:r.review.verdict,score:r.review.score,reason:r.review.reason}))};
}

export function assetContextScene(value:any,brief:any,layout:any,context:AssetSceneContext){
 assertProceduralHandoff(value,context.scene);
 const handoff=assetSpatialHandoff(brief,layout,context),used=new Set(value.template.parts.map((p:any)=>p.material));
 for(const i of handoff.instances)for(const o of i.surfaceOverrides??[])used.add(o.targetMaterialId);
 const materials=layout.program.materials.filter((m:any)=>used.has(m.id)).map((m:any)=>structuredClone(m));
 const placeholders=context.scene.program.templates.filter((t:any)=>t.id!==brief.id);
 const templates=placeholders.map((t:any,n:number)=>{
  let id='context_clay_'+n;while(materials.some((m:any)=>m.id===id))id+='_';
  const level=[.32,.5,.68][n%3];materials.push({id,color:[level,level,level,1],roughness:1,metallic:0,textureId:null});
  return {...structuredClone(t),parts:t.parts.map((p:any)=>({...structuredClone(p),material:id}))};
 });
 templates.push(structuredClone(value.template));
 const textureIds=new Set(materials.map((m:any)=>m.textureId).filter(Boolean));
 const scene={...structuredClone(layout),version:'scene-v1',program:{...structuredClone(layout.program),materials,templates,
  instances:layout.program.instances.map((i:any)=>i.template===brief.id?structuredClone(i):spatialInstances([structuredClone(i)])[0])},
  textures:layout.textures.filter((t:any)=>textureIds.has(t.id)),textureReuse:(layout.textureReuse??[]).filter((t:any)=>textureIds.has(t.textureId)),
  cameras:[structuredClone(handoff.referenceCamera)],
  assumptions:[...layout.assumptions??[],handoff.scope,'当前资产使用真实实例表面配置和计划灯光；灰模邻居影响遮挡、阴影及探针，不能将该图视为最终材质或全场评分。']};
 return {scene,handoff,placeholderTemplateIds:placeholders.map((t:any)=>t.id)};
}
