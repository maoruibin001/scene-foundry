import {type AssetGeometry,type SceneLayout} from '../geometry/layout';
import {type Texture} from '../geometry/program';
import {stable} from '../validated-cache';
import {allocateVoxelEntityDetails,validateVoxelEntityDetail,assertVoxelDetailAssembly,type VoxelDetailAllocation} from './entity-detail';
import {assertVoxelDetailPreservation,assertVoxelDetailOwnership} from './detail-ownership';
import {validateVoxelLattice} from './scene-lattice';

export const VOXEL_DETAIL_BASIS='voxel-detail-basis-v1';
export type VoxelDetailBasis={version:typeof VOXEL_DETAIL_BASIS;layout:SceneLayout;acceptedScene:any;allocation:VoxelDetailAllocation};
function fail(ok:unknown,message:string):asserts ok{if(!ok)throw Error('VOXEL_DETAIL_BASIS: '+message);}
const equal=(a:any,b:any)=>stable(a)===stable(b);
const ids=(items:any[],key='id')=>{fail(Array.isArray(items),'身份数组缺失');const values=items.map(item=>item?.[key]);fail(values.every(id=>typeof id==='string')&&new Set(values).size===values.length,'身份缺失或重复');return values.sort();};
const byId=(items:any[],key='id')=>[...items].sort((a,b)=>a[key].localeCompare(b[key]));
const instanceSkeleton=(items:any[])=>byId(items.map(({surfaceOverrides,...rest})=>rest));

/** This basis is immutable production input, never synthesized from a repaired
 * candidate. Recomputing its allocation prevents a stale or edited sidecar from
 * authorizing larger budgets after the quality refinement stage. */
export function validateVoxelDetailBasis(value:any):VoxelDetailBasis{
 fail(value?.version===VOXEL_DETAIL_BASIS&&value.layout?.version==='scene-layout-v1','缺少合法精修基线');
 validateVoxelLattice(value.layout.voxelLattice);
 fail(equal(value.acceptedScene?.voxelLattice,value.layout.voxelLattice),'已接受灰模与冻结共同格网不一致');
 fail(equal(instanceSkeleton(value.acceptedScene.program.instances),instanceSkeleton(value.layout.program.instances)),'已接受灰模与冻结实例骨架不一致');
 fail(equal(ids(value.acceptedScene.program.templates),ids(value.layout.program.templates)),'已接受灰模与冻结模板身份不一致');
 const allocation=allocateVoxelEntityDetails(value.layout,value.acceptedScene);
 fail(equal(value.allocation,allocation),'精修分配与已接受原生基线不一致');
 return value;
}
export function createVoxelDetailBasis(layout:SceneLayout,acceptedScene:any,allocation=allocateVoxelEntityDetails(layout,acceptedScene)):VoxelDetailBasis{
 return validateVoxelDetailBasis(structuredClone({version:VOXEL_DETAIL_BASIS,layout,acceptedScene,allocation}));
}

/** Final/repair output may improve cameras, native detail parts and appearances;
 * it cannot redefine the accepted spatial skeleton or its safety constraints. */
export function assertVoxelDetailScene(value:any,inputBasis:VoxelDetailBasis,textures:Record<string,Texture>){
 const basis=validateVoxelDetailBasis(inputBasis),layout=basis.layout;
 fail(value?.version==='scene-v1'&&value.program?.version===layout.program.version,'场景或程序版本改变');
 fail(equal(value.voxelLattice,layout.voxelLattice),'精修改变共同格网');
 fail(value.program.name===layout.program.name,'精修改变冻结场景身份');
 fail(equal(ids(value.program.templates),ids(layout.program.templates)),'精修改变模板身份');
 fail(equal(ids(value.program.instances),ids(layout.program.instances)),'精修改变实例身份');
 fail(equal(instanceSkeleton(value.program.instances),instanceSkeleton(layout.program.instances)),'精修改变冻结实例骨架或姿态');
 fail(equal(ids(value.program.materials),ids(layout.program.materials)),'精修改变冻结材料ID');
 fail(equal(byId(value.entities,'instanceId'),byId(layout.entities,'instanceId')),'精修改变冻结实体语义或绑定');
 for(const key of ['spatialOpenings','spatialContacts','spatialRelations','observedBindings'])fail(equal(value[key],(layout as any)[key]),'精修改变冻结 '+key);
 // The material set is frozen above; within it a repair may move a part to any existing material. Camp 08f393d2's repair rebound the
 // tent entrance lining to the scene's dark brown and the chimney to its grey brick, and the per-template allocation refused both.
 const palette=ids(layout.program.materials),templates=layout.program.templates.map(t=>({...t,materialIds:[...new Set([...t.materialIds,...palette])]}));
 const currentLayout:SceneLayout={...layout,program:{...layout.program,templates,materials:value.program.materials,instances:value.program.instances},textures:value.textures,textureReuse:value.textureReuse};
 const assets:AssetGeometry[]=value.program.templates.map((template:any)=>({version:'asset-geometry-v1',template}));
 const preservation=currentLayout.program.templates.map(brief=>{
  const asset=assets.find(a=>a.template.id===brief.id)!;
  validateVoxelEntityDetail(asset,brief,currentLayout,basis.allocation,textures);
  return {templateId:brief.id,...assertVoxelDetailPreservation(asset,brief,currentLayout,basis.acceptedScene)};
 });
 return {version:'voxel-detail-scene-v1',budget:assertVoxelDetailAssembly(currentLayout,assets,basis.allocation,textures),ownership:assertVoxelDetailOwnership(currentLayout,assets,basis.acceptedScene),preservation};
}
