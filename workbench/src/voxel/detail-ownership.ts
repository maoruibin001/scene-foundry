import {type AssetGeometry,type AssetBrief,type SceneLayout} from '../geometry/layout';
import {transformPoint,type Part} from '../geometry/program';
import {assertProceduralHandoff,proceduralSeeds} from '../geometry/procedural-handoff';
import {inspectOpenings} from '../geometry/openings';
import {evaluateVoxelVolume,type VoxelVolume} from '../geometry/voxel-volume';
import {assertLatticePose,validateVoxelLattice,type VoxelLattice} from './scene-lattice';
import {VOXEL_LIMITS} from './limits';

type Cell=[number,number,number];
type Owners=Map<string,Set<string>>;
function fail(ok:unknown,message:string):asserts ok{if(!ok)throw Error('VOXEL_DETAIL_PRESERVATION: '+message);}
const cellKey=(value:Cell)=>value.join(',');

/** Sparse occupied indexes are cached per volume. Large empty envelopes are not
 * rescanned for every repeated instance and are never treated as ownership. */
function occupiedCells(){
 const cache=new Map<VoxelVolume,{indexes:number[];occupied:number}>();
 return (shape:VoxelVolume)=>{
  let cached=cache.get(shape);if(cached)return cached;
  fail(shape?.type==='voxelVolume','所有权检查仅接受共同格网原生体积');
  const evaluation=evaluateVoxelVolume(shape),indexes:number[]=[];
  for(let i=0;i<evaluation.occupied.length;i++)if(evaluation.occupied[i])indexes.push(i);
  cached={indexes,occupied:evaluation.occupiedCells};cache.set(shape,cached);return cached;
 };
}
function worldKey(index:number,part:Part,instance:any,lattice:VoxelLattice){
 const shape=part.shape as VoxelVolume,[nx,ny]=shape.dimensions;
 const local=[index%nx,Math.floor(index/nx)%ny,Math.floor(index/(nx*ny))];
 const center=shape.origin.map((n,k)=>n+(local[k]+.5)*shape.cellSize) as Cell;
 const world=transformPoint(transformPoint(center,part),instance);
 const relative=world.map((n,k)=>(n-lattice.origin[k])/lattice.cellSize-.5),grid=relative.map(Math.round) as Cell;
 fail(relative.every((n,k)=>Math.abs(n-grid[k])<=1e-6),'实际占用格没有精确落在冻结共同格网');
 return cellKey(grid);
}
function baselineOwnership(layout:SceneLayout,acceptedScene:any){
 const lattice=validateVoxelLattice(layout.voxelLattice),owners:Owners=new Map(),occupied=occupiedCells();
 fail(layout.program.instances.length<=VOXEL_LIMITS.entities,'实例超过64个，含ground/context/subject');
 const templates=new Map<string,any>((acceptedScene?.program?.templates??[]).map((t:any)=>[t.id,t]));
 let expanded=0;
 for(const instance of layout.program.instances){
  assertLatticePose(instance,lattice,'frozen instance '+instance.id);
  const template=templates.get(instance.template);fail(template,'已接受灰模缺少模板 '+instance.template);
  for(const part of template.parts){
   assertLatticePose(part,lattice,'frozen part '+part.id);
   fail(part.shape?.type==='voxelVolume'&&part.shape.cellSize===lattice.cellSize,'已接受体积不是冻结原生格 '+part.id);
   const cells=occupied(part.shape);expanded+=cells.occupied;
   fail(expanded<=VOXEL_LIMITS.filledCells,'已接受实例展开占用上界超过500000');
   for(const index of cells.indexes){
    const key=worldKey(index,part,instance,lattice),set=owners.get(key)??new Set<string>();
    set.add(instance.id);owners.set(key,set);
   }
  }
 }
 return {lattice,owners,occupied,expanded};
}
function details(value:AssetGeometry,acceptedScene:any){
 const template=acceptedScene.program.templates.find((t:any)=>t.id===value.template.id);fail(template,'缺少已接受模板 '+value.template.id);
 const ids=new Set(template.parts.map((p:any)=>p.id));
 return value.template.parts.filter(p=>!ids.has(p.id));
}
function checkAddedCells(layout:SceneLayout,value:AssetGeometry,acceptedScene:any,baseline:ReturnType<typeof baselineOwnership>,detailsOwners?:Owners,previousAdded=0){
 let expanded=0;
 for(const part of details(value,acceptedScene)){
  assertLatticePose(part,baseline.lattice,'detail part '+part.id);
  fail(part.shape?.type==='voxelVolume'&&part.shape.cellSize===baseline.lattice.cellSize,'新增部件不是冻结原生格 '+part.id);
  const cells=baseline.occupied(part.shape);
  for(const instance of layout.program.instances.filter(i=>i.template===value.template.id)){
   expanded+=cells.occupied;fail(baseline.expanded+previousAdded+expanded<=VOXEL_LIMITS.filledCells,'新增后实例展开占用上界超过500000');
   for(const index of cells.indexes){
    const key=worldKey(index,part,instance,baseline.lattice),prior=baseline.owners.get(key);
    // A historical coarse overlap already belongs to this instance. Keeping
    // that same occupied cell is not a newly introduced ownership conflict.
    if(prior&&!prior.has(instance.id))throw Error('VOXEL_DETAIL_PRESERVATION: 新增部件 '+instance.id+'/'+part.id+' 侵入其他实体已接受格 '+key+'，所有者 '+[...prior].join(','));
    if(prior?.has(instance.id))continue;
    if(detailsOwners){
     const others=detailsOwners.get(key);
     if(others&&[...others].some(owner=>owner!==instance.id))throw Error('VOXEL_DETAIL_PRESERVATION: 新增细节实体在同一格冲突 '+key+'：'+[...others].join(',')+' / '+instance.id);
     const set=others??new Set<string>();set.add(instance.id);detailsOwners.set(key,set);
    }
   }
  }
 }
 return expanded;
}
function openingScene(layout:SceneLayout,template:any,acceptedScene:any,templateId:string){
 // Strict native materials are opaque. Ignore surface binding declarations for
 // this geometry-only ray audit: an accepted coarse material slot can differ
 // from the later frozen surface plan while the volume remains identical.
 const materials=[...new Map<string,any>([...(acceptedScene.program.materials??[]),...layout.program.materials].map(m=>[m.id,m])).values()];
 return {program:{...layout.program,materials,templates:[template],instances:layout.program.instances.filter(i=>i.template===templateId).map(({surfaceOverrides,...pose})=>pose)},spatialOpenings:layout.spatialOpenings};
}
function assertOpeningSamples(baseline:ReturnType<typeof inspectOpenings>,result:ReturnType<typeof inspectOpenings>){
 let clearSamples=0;
 for(const check of baseline.checks){
  const after=result.checks.find(c=>c.id===check.id);fail(after,'精修缺少原开口检查 '+check.id);
  fail(after.samples.length===check.samples.length,'原开口采样契约已改变 '+check.id);
  for(let i=0;i<check.samples.length;i++)if(check.samples[i].blocked===false){
   clearSamples++;
   fail(after.samples[i].blocked===false,'新增部件封堵已接受开口 '+check.id+'，sample '+i+'，blocker '+(after.samples[i].hit?.meshId??'unknown'));
  }
 }
 return {checked:baseline.checks.length,clearSamples};
}
function preserveOpeningSamples(value:AssetGeometry,brief:AssetBrief,layout:SceneLayout,acceptedScene:any,partial:boolean){
 const relevant=(layout.spatialOpenings??[]).filter(o=>layout.program.instances.some(i=>i.id===o.instanceId&&i.template===brief.id));
 if(!relevant.length)return {checked:0,clearSamples:0};
 const accepted=acceptedScene.program.templates.find((t:any)=>t.id===brief.id);fail(accepted,'开口检查缺少已接受模板 '+brief.id);
 const ids=new Set(value.template.parts.map(p=>p.id));
 const candidate=partial?{...value.template,parts:[...accepted.parts.filter((p:any)=>!ids.has(p.id)),...value.template.parts]}:value.template;
 const baseline=inspectOpenings(openingScene(layout,accepted,acceptedScene,brief.id),{assetTemplateId:brief.id});
 const result=inspectOpenings(openingScene(layout,candidate,acceptedScene,brief.id),{assetTemplateId:brief.id});
 return assertOpeningSamples(baseline,result);
}

/** Full output retains every accepted native seed. A partial checkpoint may omit
 * seeds not uploaded yet; any uploaded seed must still match the accepted one. */
export function assertVoxelDetailPreservation(value:AssetGeometry,brief:AssetBrief,layout:SceneLayout,acceptedScene:any,options:{partial?:boolean}={}){
 fail(value?.template?.id===brief.id&&Array.isArray(value.template.parts),'精修模板身份或部件无效');
 const partial=!!options.partial;
 if(partial){
  const ids=new Set(value.template.parts.map(p=>p.id)),missing=proceduralSeeds(acceptedScene,brief.id).filter((p:any)=>!ids.has(p.id));
  assertProceduralHandoff({...value,template:{...value.template,parts:[...value.template.parts,...missing]}},acceptedScene);
 }else assertProceduralHandoff(value,acceptedScene);
 const baseline=baselineOwnership(layout,acceptedScene),addedOccupiedUpperBound=checkAddedCells(layout,value,acceptedScene,baseline);
 const openings=preserveOpeningSamples(value,brief,layout,acceptedScene,partial);
 return {version:'voxel-detail-preservation-v1',baselineOccupiedUpperBound:baseline.expanded,baselineOwnedCells:baseline.owners.size,addedOccupiedUpperBound,openings};
}

/** Sibling workers see frozen coarse ownership independently. Merge separately
 * refuses their newly occupied cross-entity collisions instead of discarding
 * one entity by converter priority. Coarse overlaps remain unchanged. */
export function assertVoxelDetailOwnership(layout:SceneLayout,assets:AssetGeometry[],acceptedScene:any){
 fail(assets.length===layout.program.templates.length&&new Set(assets.map(a=>a.template.id)).size===assets.length,'合并精修资产不齐全或身份重复');
 const baseline=baselineOwnership(layout,acceptedScene),addedOwners:Owners=new Map();let addedOccupiedUpperBound=0;
 for(const asset of assets){
  fail(layout.program.templates.some(t=>t.id===asset.template.id),'合并包含其他模板 '+asset.template.id);
  assertProceduralHandoff(asset,acceptedScene);
  addedOccupiedUpperBound+=checkAddedCells(layout,asset,acceptedScene,baseline,addedOwners,addedOccupiedUpperBound);
  fail(baseline.expanded+addedOccupiedUpperBound<=VOXEL_LIMITS.filledCells,'合并实例展开实际占用上界超过500000');
 }
 const openings=assertAssembledOpenings(layout,assets,acceptedScene);
 return {version:'voxel-detail-ownership-v1',baselineOccupiedUpperBound:baseline.expanded,baselineOwnedCells:baseline.owners.size,addedOccupiedUpperBound,newOwnedCells:addedOwners.size,openings};
}

/**
 * A new part can occupy an empty opening belonging to another template without touching any coarse owner. Only the assembled ray audit
 * sees that regression; merge runs it alone first, because a cell conflict elsewhere would otherwise hide it.
 */
export function assertAssembledOpenings(layout:SceneLayout,assets:AssetGeometry[],acceptedScene:any){
 if(!layout.spatialOpenings?.length)return {checked:0,clearSamples:0};
 const materials=[...new Map<string,any>([...(acceptedScene.program.materials??[]),...layout.program.materials].map(m=>[m.id,m])).values()];
 const program={...layout.program,materials,instances:layout.program.instances.map(({surfaceOverrides,...pose})=>pose)};
 return assertOpeningSamples(inspectOpenings({program:{...program,templates:acceptedScene.program.templates},spatialOpenings:layout.spatialOpenings}),inspectOpenings({program:{...program,templates:assets.map(a=>a.template)},spatialOpenings:layout.spatialOpenings}));
}

/**
 * Surface override sources every instance of this template expects on real parts, and how many cells a new part could add without
 * entering another entity's accepted cells in any instance. The 2026-10-18 temple green_cluster (15 instances) had none beyond its seed:
 * fourteen saves of a new mat_green_light part each hit an owner, and the asset then failed the missing override source.
 */
export function voxelOverrideSources(brief:AssetBrief,layout:SceneLayout,acceptedScene:any){
 const instances=layout.program.instances.filter(i=>i.template===brief.id),required=[...new Set(instances.flatMap(i=>(i.surfaceOverrides??[]).map(b=>b.sourceMaterialId)))];
 const seeds=proceduralSeeds(acceptedScene,brief.id).filter((p:any)=>p.shape.type==='voxelVolume').map((p:any)=>p.id);
 const lattice=validateVoxelLattice(layout.voxelLattice),cs=lattice.cellSize,dims=brief.bounds.min.map((n,k)=>Math.round((brief.bounds.max[k]-n)/cs));
 let free:number|null=null;
 // Bounded audit; a very large envelope reports null instead of a guess.
 if(required.length&&dims.every(n=>n>0)&&dims[0]*dims[1]*dims[2]*instances.length<=4_000_000){
  const {owners}=baselineOwnership(layout,acceptedScene),identity={position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]} as any;free=0;
  for(let z=0;z<dims[2];z++)for(let y=0;y<dims[1];y++)for(let x=0;x<dims[0];x++){
   const centre=[x,y,z].map((n,k)=>brief.bounds.min[k]+(n+.5)*cs) as Cell;
   if(instances.every(i=>{const key=cellKey(transformPoint(transformPoint(centre,identity),i).map((n,k)=>Math.round((n-lattice.origin[k])/cs-.5)) as Cell),o=owners.get(key);return !o||o.has(i.id);}))free++;
  }
 }
 return {requiredSourceMaterialIds:required,seedPartIds:seeds,cellsUsableByEveryInstance:free,
  rule:'requiredSourceMaterialIds中每个材质都必须出现在本模板至少一个部件上，实例的surfaceOverrides才能命中；缺一个即整份资产校验失败。先把保留的种子部件material改为其中一个；其余每个源材质用一个新id的着色部件实现：复制该种子的position/rotation/scale、cellSize、origin、dimensions和完整operations，再在末尾追加erase只保留要换色的区域，这样它只占种子已有格。不要为了换色新增格：cellsUsableByEveryInstance是在所有实例中都不侵入其他实体已接受格的格数（含种子自身格；为null表示未统计），等于或接近种子格数时，任何超出种子的新格都会被拒绝。'};
}
