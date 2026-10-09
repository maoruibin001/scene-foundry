import {validateVoxelLattice,type VoxelLattice} from './scene-lattice';
import {createHash} from 'node:crypto';
import {transformPoint,type GeometryProgram,type Part,type Pose} from '../geometry/program';
import {evaluateVoxelVolume,type VoxelVolume,type VoxelVolumeEvaluation} from '../geometry/voxel-volume';
import {VOXEL_LIMITS} from './program';

type V=[number,number,number];
type Compiled={bounds:{min:V;max:V};meshes:{name:string;entityId:string;geometry:{material:{surface:any}}}[]};
export type NativeRasterVolume={meshId:string;instanceId:string;partId:string;shape:VoxelVolume;worldOrigin:V;basis:V[];spacing:V;evaluation?:VoxelVolumeEvaluation};
const tolerance=1e-6;
const fail=(ok:any,reason:string)=>{if(!ok)throw Error('VOXELIZATION: native lattice '+reason);};
const sha=(value:any)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const nearInteger=(n:number)=>Math.abs(n-Math.round(n))<=tolerance;
const world=(point:V,part:Part,instance:Pose)=>transformPoint(transformPoint(point,part),instance);
const sub=(a:V,b:V)=>a.map((n,k)=>n-b[k]) as V;

/** Choose a feasible common lattice with a bounded divisor search, never a decimal GCD or silent coarsening. */
export function prepareNativeRaster(program:GeometryProgram,compiled:Compiled,lattice?:VoxelLattice){
 const volumes:NativeRasterVolume[]=[],fallbacks:any[]=[];
 for(const instance of program.instances){
  const template=program.templates.find(t=>t.id===instance.template)!;
  for(const part of template.parts){
   if(part.shape.type!=='voxelVolume')continue;
   const shape=part.shape,meshId=instance.id+'__'+part.id+'__'+part.material,mesh=compiled.meshes.find(m=>m.name===meshId);
   fail(mesh,'missing compiled native mesh '+meshId);
   const surface=mesh!.geometry.material.surface;
   fail(surface.baseColor?.[3]>=.99,'不能用不透明原生格替代透明材质：'+meshId);
   const provenance={meshId,instanceId:instance.id,partId:part.id,shapeSha256:sha(shape)};
   // Actual texture pixels still use the existing measured-color converter; do not invent a flat native color.
   if(surface.baseColorTexture){fallbacks.push({...provenance,reason:'native material has texture pixels; existing surface/color rasterization retained',occupancyPreservation:'resampled-unverified'});continue;}
   const worldOrigin=world(shape.origin,part,instance),basis=[0,1,2].map(axis=>{
    const point=[...shape.origin] as V;point[axis]+=shape.cellSize;return sub(world(point,part,instance),worldOrigin);
   });
   const spacing=[0,0,0] as V,axes=new Set<number>();let reason='';
   for(const direction of basis){
    const axis=[0,1,2].reduce((best,k)=>Math.abs(direction[k])>Math.abs(direction[best])?k:best,0),length=Math.abs(direction[axis]);
    if(!(length>0)||direction.some((n,k)=>k!==axis&&Math.abs(n)>Math.max(1e-9,length*1e-7))||axes.has(axis)){reason='native transformed cells are not signed-axis aligned';break;}
    axes.add(axis);spacing[axis]=length;
   }
   if(!reason){for(let corner=0;corner<8;corner++){const drift=[0,0,0];for(let axis=0;axis<3;axis++)if(corner&(1<<axis))for(let k=0;k<3;k++)drift[k]+=basis[axis][k]*shape.dimensions[axis];if(drift.some((n,k)=>!nearInteger(n/spacing[k]))){reason='native transformed corners accumulate off-axis drift';break;}}}
   if(reason){fallbacks.push({...provenance,reason,occupancyPreservation:'resampled-unverified'});continue;}
   volumes.push({meshId,instanceId:instance.id,partId:part.id,shape,worldOrigin,basis,spacing});
  }
 }
 let unit:number|null=null,origin:V|null=null,size:V|null=null;
 if(volumes.length){
  const minimum=Math.min(...volumes.flatMap(v=>v.spacing)),anchor=lattice?.origin??volumes[0].worldOrigin;
  for(let divisor=1;divisor<=(lattice?1:192);divisor++){
   const candidate=lattice?.cellSize??minimum/divisor;if(candidate<.001)break;if(candidate>1)continue;
   if(volumes.some(v=>v.spacing.some(n=>!nearInteger(n/candidate))||v.worldOrigin.some((n,k)=>!nearInteger((n-anchor[k])/candidate))))continue;
   if(volumes.some(v=>Array.from({length:8},(_,corner)=>v.worldOrigin.map((n,k)=>n+v.basis.reduce((sum,b,axis)=>sum+((corner&(1<<axis))?b[k]*v.shape.dimensions[axis]:0),0))).some(point=>point.some((n,k)=>!nearInteger((n-anchor[k])/candidate)))))continue;
   const lower=compiled.bounds.min.map((n,k)=>anchor[k]+(Math.floor((n-anchor[k])/candidate+tolerance)-1)*candidate) as V;
   const dimensions=compiled.bounds.max.map((n,k)=>Math.ceil((n-lower[k])/candidate-tolerance)+1) as V;
   if(dimensions.some(n=>n<1||n>VOXEL_LIMITS.dimension)||dimensions.reduce((a,b)=>a*b,1)>VOXEL_LIMITS.gridCells)continue;
   unit=candidate;origin=lower;size=dimensions;break;
  }
  if(unit===null){for(const volume of volumes)fallbacks.push({meshId:volume.meshId,instanceId:volume.instanceId,partId:volume.partId,shapeSha256:sha(volume.shape),reason:'no meaningful common native lattice fits fixed 192-axis/2M-grid limits within 192 divisor candidates',occupancyPreservation:'resampled-unverified'});volumes.length=0;}
 }
 if(lattice){validateVoxelLattice(lattice);fail(!fallbacks.length&&volumes.length===compiled.meshes.length&&unit===lattice.cellSize,'strict scene requires all meshes on the frozen lattice; no resampling fallback');}
 const evaluations=new Map<VoxelVolume,VoxelVolumeEvaluation>(),meshes=new Map<string,NativeRasterVolume>();
 for(const volume of volumes){let evaluation=evaluations.get(volume.shape);if(!evaluation){evaluation=evaluateVoxelVolume(volume.shape);evaluations.set(volume.shape,evaluation);}volume.evaluation=evaluation;meshes.set(volume.meshId,volume);}
 const total=volumes.length+fallbacks.length;
 return {unit,origin,size,meshes,provenance:{version:'native-voxel-raster-v1',mode:volumes.length?(fallbacks.length?'mixed-exact-and-resampled':'exact-native-lattice'):total?'resampled-native-fallback':'not-applicable',
  nativeMeshes:total,exactMeshes:volumes.map(v=>({meshId:v.meshId,instanceId:v.instanceId,partId:v.partId,shapeSha256:sha(v.shape),worldOrigin:v.worldOrigin,axisSpacing:v.spacing,sourceOccupiedCells:v.evaluation!.occupiedCells,orderedOperations:true,colorSource:'actual compiled opaque baseColor'})),fallbackMeshes:fallbacks,
  globalLattice:unit===null?null:{cellSize:unit,origin,size,selection:lattice?'frozen scene lattice; no divisor search or precision coarsening':'largest feasible divisor of transformed native spacing, at most 192 candidates; no precision coarsening'},
  limitations:'原生对齐体积直接映射有序占用格，不经三角边界膨胀；原生以外几何及显式回退体积仍使用表面采样。存在准确原生格时，普通三角仅接触格边界不会填入邻格，封闭体内部仍按绕数填充；共同场景其他实际相交几何可占据原生空隙。回退不证明挖空仍然保留。完整场景仍须独立原图验收。'}};
}

/** Exact integer cuboids also support commensurate signed-axis nonuniform scales, without changing occupancy. */
export function rasterNativeVolume(volume:NativeRasterVolume,grid:{unit:number;origin:V;size:V},visit:(cell:V)=>void,maxVisits:number){
 const evaluation=volume.evaluation??evaluateVoxelVolume(volume.shape),dimensions=volume.shape.dimensions,[nx,ny]=dimensions;
 const subdivisions=volume.spacing.map(n=>Math.round(n/grid.unit)) as V;
 fail(volume.spacing.every((n,k)=>nearInteger(n/grid.unit)&&subdivisions[k]>=1),'cell spacing does not match chosen lattice');
 const expectedWrites=evaluation.occupiedCells*subdivisions.reduce((a,b)=>a*b,1);
 fail(Number.isSafeInteger(expectedWrites)&&expectedWrites<=maxVisits,'原生格写入超出有界预算；未丢弃几何');
 let writes=0;
 for(let index=0;index<evaluation.occupied.length;index++){
  if(!evaluation.occupied[index])continue;
  const local=[index%nx,Math.floor(index/nx)%ny,Math.floor(index/(nx*ny))];
  const corner=[...volume.worldOrigin] as V;
  for(let axis=0;axis<3;axis++)for(let k=0;k<3;k++)corner[k]+=volume.basis[axis][k]*(local[axis]+(volume.basis[axis][k]<0?1:0));
  const relative=corner.map((n,k)=>(n-grid.origin[k])/grid.unit),minimum=relative.map(Math.round) as V;
  fail(relative.every(nearInteger)&&minimum.every((n,k)=>n>=0&&n+subdivisions[k]<=grid.size[k]),'mapped native cell is off lattice or outside fixed grid');
  for(let z=0;z<subdivisions[2];z++)for(let y=0;y<subdivisions[1];y++)for(let x=0;x<subdivisions[0];x++){visit([minimum[0]+x,minimum[1]+y,minimum[2]+z]);writes++;}
 }
 return {sourceOccupiedCells:evaluation.occupiedCells,gridWrites:writes};
}
