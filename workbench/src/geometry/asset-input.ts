import {assetGeometryBasis} from './asset-geometry-basis';
import {assetContacts} from './contacts';
import {assetTriangleBudget} from './triangle-budget';
import {assetPartCapacity} from './surface-part-budget';
import {digest} from '../store';
import type {AssetBrief,SceneLayout} from './layout';
import type {Texture} from './program';
/** A template is local geometry. World poses/cameras/other templates are assembly inputs. */
export function assetInput(prompt:string,plan:any,layout:SceneLayout,brief:AssetBrief,textures:Record<string,Texture>,acceptedScene?:any){
 brief={...brief,maxParts:assetPartCapacity(layout,brief).maxParts};
 const instances=layout.program.instances.filter(i=>i.template===brief.id),targets=new Set(instances.flatMap(i=>(i.surfaceOverrides??[]).map(b=>b.targetMaterialId)));
 const materials=layout.program.materials.filter(m=>brief.materialIds.includes(m.id)||targets.has(m.id)),ids=new Set(materials.map(m=>m.textureId).filter(Boolean));
 const required=new Set(instances.flatMap(i=>i.requirementIds));
 return {contract:'local-asset-input-v7',...(layout.voxelLattice?{voxelLattice:layout.voxelLattice}:{}),acceptedGeometry:assetGeometryBasis(acceptedScene,brief.id),triangleBudget:assetTriangleBudget(layout,brief),input:prompt,usage:instances.map(i=>({id:i.id,label:i.label,scale:i.scale,worldSize:brief.bounds.max.map((n,k)=>(n-brief.bounds.min[k])*i.scale[k]),surfaceOverrides:i.surfaceOverrides??[]})),instructions:'只实现冻结的局部资产；世界位置、相机及其他资产由组装阶段处理，不重新解释整体布局。',requirements:plan.requirements.filter(r=>required.has(r.id)),brief,spatialContacts:assetContacts(layout,brief.id),spatialOpenings:(layout.spatialOpenings??[]).filter(o=>instances.some(i=>i.id===o.instanceId)),materials,textures:layout.textures.filter(t=>ids.has(t.id)),textureRegistry:Object.entries(textures).filter(([id])=>ids.has(id)).map(([id,t])=>({id,width:t.width,height:t.height,colorSpace:t.colorSpace,rgbaSha256:digest(t.rgba8)}))};
}
