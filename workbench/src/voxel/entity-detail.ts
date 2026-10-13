import {validateAllocatedAsset,validateAllocatedAssetParts} from '../geometry/asset-validation';
import {type AssetGeometry,type AssetBrief,type SceneLayout} from '../geometry/layout';
import {type Texture} from '../geometry/program';
import {assetPartCapacity} from '../geometry/surface-part-budget';
import {validateVoxelVolume,VOXEL_VOLUME_LIMITS} from '../geometry/voxel-volume';
import {validateVoxelGeometry,validateVoxelTemplate,validateVoxelMaterials} from './geometry-lattice';
import {validateVoxelLattice,voxelSpaceGrid,type VoxelLattice} from './scene-lattice';
import {VOXEL_LIMITS} from './limits';

export const VOXEL_DETAIL_POLICY='voxel-detail-v1';
const VERSION='voxel-entity-allocation-v1';
function fail(ok:unknown,message:string):asserts ok{if(!ok)throw Error('VOXEL_ENTITY_DETAIL: '+message);}

/** An absent historical policy is not permission to reinterpret the old job. */
export function voxelDetailPolicyFor(sceneKind:unknown,source?:{voxelDetailPolicy?:unknown}|null){
 const inherited=source?.voxelDetailPolicy;
 fail(inherited==null||inherited===VOXEL_DETAIL_POLICY,'未知精修策略版本');
 if(sceneKind!=='voxel')return null;
 return source?inherited??null:VOXEL_DETAIL_POLICY;
}

export type VoxelEntityMetrics={gridCells:number;operationCells:number;occupiedCells:number;operations:number;expandedOperations:number;parts:number};
export type VoxelEntityAllocation={templateId:string;instances:number;minimum:VoxelEntityMetrics;maximum:VoxelEntityMetrics};
export type VoxelDetailAllocation={version:typeof VERSION;lattice:VoxelLattice;limits:{gridCells:number;operationCells:number;occupiedCells:number;entities:number;operationsPerPart:number;expandedOperationsPerPart:number};templates:VoxelEntityAllocation[];expandedMinimum:VoxelEntityMetrics;expandedMaximum:VoxelEntityMetrics};
const zero=():VoxelEntityMetrics=>({gridCells:0,operationCells:0,occupiedCells:0,operations:0,expandedOperations:0,parts:0});

/** Cells/writes count each native template once, matching validateGeometryProgram.
 * Occupancy is the actual ordered fill/erase result, expanded by instance count.
 * Neither empty bounds nor legacy voxel-program op/box counts are quality metrics. */
function nativeMetrics(template:any,lattice:VoxelLattice,maximum?:VoxelEntityMetrics):VoxelEntityMetrics{
 const metrics=zero();
 fail(Array.isArray(template?.parts),'精修部件缺失');
 // Admit allocation-free native work before allocating/evaluating occupancy.
 // The shape limits alone would permit many expensive volumes in one template.
 for(const part of template.parts){
  fail(part?.shape?.type==='voxelVolume','strict parts must use voxelVolume: '+part?.id);
  const plan=validateVoxelVolume(part.shape);
  metrics.gridCells+=plan.cells;metrics.operationCells+=plan.writes;
  metrics.operations+=part.shape.operations.length;metrics.expandedOperations+=plan.expandedOperations;metrics.parts++;
  fail(metrics.gridCells<=(maximum?.gridCells??VOXEL_VOLUME_LIMITS.programCells),'gridCells '+metrics.gridCells+' 超过分配 '+(maximum?.gridCells??VOXEL_VOLUME_LIMITS.programCells));
  fail(metrics.operationCells<=(maximum?.operationCells??VOXEL_VOLUME_LIMITS.programWrites),'operationCells '+metrics.operationCells+' 超过分配 '+(maximum?.operationCells??VOXEL_VOLUME_LIMITS.programWrites));
  if(maximum)for(const key of ['operations','expandedOperations','parts'] as const)fail(metrics[key]<=maximum[key],key+' '+metrics[key]+' 超过分配 '+maximum[key]);
 }
 metrics.occupiedCells=validateVoxelTemplate(template,lattice).occupiedUpperBound;
 return metrics;
}
function totals(rows:VoxelEntityAllocation[],field:'minimum'|'maximum'){
 const sum=zero();
 for(const row of rows)for(const key of Object.keys(sum) as (keyof VoxelEntityMetrics)[])sum[key]+=row[field][key]*(key==='occupiedCells'?row.instances:1);
 return sum;
}
function assertTotals(sum:VoxelEntityMetrics){
 fail(sum.gridCells<=VOXEL_VOLUME_LIMITS.programCells,'唯一模板格数超过全程序 '+VOXEL_VOLUME_LIMITS.programCells);
 fail(sum.operationCells<=VOXEL_VOLUME_LIMITS.programWrites,'唯一模板写入超过全程序 '+VOXEL_VOLUME_LIMITS.programWrites);
 fail(sum.occupiedCells<=VOXEL_LIMITS.filledCells,'实例展开实际占用上界超过 '+VOXEL_LIMITS.filledCells);
}

/** Reserve accepted native anchors before distributing spare capacity. No threshold
 * is enlarged and no accepted seed is silently shrunk to fit an equal-share budget. */
export function allocateVoxelEntityDetails(layout:SceneLayout,acceptedScene:any):VoxelDetailAllocation{
 const lattice=validateVoxelLattice(layout.voxelLattice);voxelSpaceGrid(layout);
 const ids=new Set(layout.program.templates.map(t=>t.id));
 fail(ids.size===layout.program.templates.length,'冻结模板身份重复');
 fail(Array.isArray(acceptedScene?.program?.templates),'缺少已接受的原生灰模');
 const rows=layout.program.templates.map(brief=>{
  const seeds=acceptedScene.program.templates.filter((t:any)=>t.id===brief.id);
  fail(seeds.length===1&&Array.isArray(seeds[0].parts)&&seeds[0].parts.length>0,'已接受灰模缺少唯一原生模板 '+brief.id);
  const minimum=nativeMetrics(seeds[0],lattice),instances=layout.program.instances.filter(i=>i.template===brief.id).length;
  const maxParts=assetPartCapacity(layout,brief).maxParts;
  fail(instances>0,'模板没有实例 '+brief.id);fail(minimum.parts<=maxParts,'已接受部件超出详细资产容量 '+brief.id);
  return {templateId:brief.id,instances,minimum,maximum:{...minimum,parts:maxParts,operations:maxParts*VOXEL_VOLUME_LIMITS.operations,expandedOperations:maxParts*VOXEL_VOLUME_LIMITS.expandedOperations}};
 });
 const expandedMinimum=totals(rows,'minimum');assertTotals(expandedMinimum);
 const limits={gridCells:VOXEL_VOLUME_LIMITS.programCells,operationCells:VOXEL_VOLUME_LIMITS.programWrites,occupiedCells:VOXEL_LIMITS.filledCells,entities:VOXEL_LIMITS.entities,operationsPerPart:VOXEL_VOLUME_LIMITS.operations,expandedOperationsPerPart:VOXEL_VOLUME_LIMITS.expandedOperations};
 for(const key of ['gridCells','operationCells','occupiedCells'] as const){
  const weight=rows.reduce((n,row)=>n+row.maximum.parts*(key==='occupiedCells'?row.instances:1),0),remaining=limits[key]-expandedMinimum[key];
  for(const row of rows){
   // Occupancy's local share is divided by repetition before dispatching workers.
   const factor=key==='occupiedCells'?row.instances:1;
   row.maximum[key]=row.minimum[key]+Math.floor(remaining*row.maximum.parts*factor/weight/factor);
  }
 }
 const expandedMaximum=totals(rows,'maximum');assertTotals(expandedMaximum);
 return {version:VERSION,lattice:structuredClone(lattice),limits,templates:rows,expandedMinimum,expandedMaximum};
}
export function voxelEntityAllocation(allocation:VoxelDetailAllocation,templateId:string){
 fail(allocation?.version===VERSION,'分配版本无效');
 const rows=allocation.templates.filter(t=>t.templateId===templateId);
 fail(rows.length===1,'缺少唯一模板分配 '+templateId);return rows[0];
}
function assertAllocation(layout:SceneLayout,allocation:VoxelDetailAllocation){
 fail(allocation?.version===VERSION,'分配版本无效');
 const lattice=validateVoxelLattice(layout.voxelLattice),allocatedLattice=validateVoxelLattice(allocation.lattice);
 fail(allocatedLattice.cellSize===lattice.cellSize&&allocatedLattice.origin.every((n,k)=>n===lattice.origin[k]),'分配共同格网与冻结布局不一致');
 validateVoxelMaterials(layout.program.materials);
 voxelSpaceGrid(layout);
 fail(allocation.templates.length===layout.program.templates.length,'分配模板数量与冻结布局不一致');
 for(const brief of layout.program.templates){
  const row=voxelEntityAllocation(allocation,brief.id),instances=layout.program.instances.filter(i=>i.template===brief.id).length;
  fail(row.instances===instances,'分配实例倍数已改变 '+brief.id);
  for(const key of Object.keys(zero()) as (keyof VoxelEntityMetrics)[])fail(Number.isSafeInteger(row.minimum[key])&&row.minimum[key]>=0&&Number.isSafeInteger(row.maximum[key])&&row.maximum[key]>=row.minimum[key],'分配数值无效 '+brief.id+'/'+key);
  const maxParts=assetPartCapacity(layout,brief).maxParts;
  fail(row.maximum.parts<=maxParts&&row.maximum.operations<=maxParts*VOXEL_VOLUME_LIMITS.operations&&row.maximum.expandedOperations<=maxParts*VOXEL_VOLUME_LIMITS.expandedOperations,'分配超出当前原生部件契约 '+brief.id);
 }
 assertTotals(totals(allocation.templates,'maximum'));
}

/** The preview, partial checkpoint, and final save share native-budget admission.
 * Existing allocated-asset validation remains authoritative for materials,
 * openings, contacts, parts and triangles; seed handoff is checked by the caller. */
export function validateVoxelEntityDetail(value:AssetGeometry,brief:AssetBrief,layout:SceneLayout,allocation:VoxelDetailAllocation,textures:Record<string,Texture>,options:{partial?:boolean}={}){
 assertAllocation(layout,allocation);
 const row=voxelEntityAllocation(allocation,brief.id);
 fail(value?.version==='asset-geometry-v1'&&value.template?.id===brief.id,'精修返回了其他模板');
 fail(Array.isArray(value.template.parts),'精修部件缺失');
 const voxelMetrics=nativeMetrics(value.template,allocation.lattice,row.maximum);
 for(const key of Object.keys(voxelMetrics) as (keyof VoxelEntityMetrics)[])fail(voxelMetrics[key]<=row.maximum[key],brief.id+' 的 '+key+' '+voxelMetrics[key]+' 超过分配 '+row.maximum[key]);
 const measured=options.partial?validateAllocatedAssetParts(value,brief,layout,textures):validateAllocatedAsset(value,brief,layout,textures);
 // Ordinary geometry permits a 5% envelope tolerance. The new detail policy is
 // strictly inside accepted bounds; it cannot buy detail by moving the envelope.
 if(value.template.parts.length)for(let axis=0;axis<3;axis++)fail(measured.bounds.min[axis]>=brief.bounds.min[axis]-1e-6&&measured.bounds.max[axis]<=brief.bounds.max[axis]+1e-6,'精修几何超出冻结边界 '+brief.id);
 if(!options.partial)fail(voxelMetrics.parts>0&&voxelMetrics.occupiedCells>0,'完整精修资产不能为空');
 return {...measured,voxelMetrics,voxelAllocation:row};
}

/** Merge is checked again rather than trusting independently saved worker receipts. */
export function assertVoxelDetailAssembly(layout:SceneLayout,assets:AssetGeometry[],allocation:VoxelDetailAllocation,textures:Record<string,Texture>){
 assertAllocation(layout,allocation);
 fail(assets.length===layout.program.templates.length&&new Set(assets.map(a=>a.template.id)).size===assets.length,'精修资产不齐全或身份重复');
 const rows=layout.program.templates.map(brief=>{
  const asset=assets.find(a=>a.template.id===brief.id);fail(asset,'缺少精修资产 '+brief.id);
  const measured=validateVoxelEntityDetail(asset,brief,layout,allocation,textures);
  return {templateId:brief.id,instances:voxelEntityAllocation(allocation,brief.id).instances,minimum:measured.voxelMetrics,maximum:measured.voxelMetrics};
 });
 const expanded=totals(rows,'minimum');assertTotals(expanded);
 validateVoxelGeometry({voxelLattice:layout.voxelLattice,program:{...layout.program,templates:assets.map(a=>a.template)}});
 return {version:'voxel-entity-detail-budget-v1',templates:rows.map(row=>({templateId:row.templateId,instances:row.instances,metrics:row.minimum})),...expanded,limits:allocation.limits};
}
