import {assertLatticePose,assertLatticeVector,validateVoxelLattice,type VoxelLattice} from './scene-lattice';
import {evaluateVoxelVolume,validateVoxelVolume} from '../geometry/voxel-volume';
import {transformPoint,type GeometryProgram} from '../geometry/program';
import {VOXEL_LIMITS} from './program';

const fail=(ok:any,label:string)=>{if(!ok)throw Error('VOXEL_LATTICE: '+label);};
/** Local checkpoints reject non-native shapes and changed spacing before rendering. */
export function validateVoxelTemplate(template:any,lattice:VoxelLattice){
 validateVoxelLattice(lattice);
 let occupied=0;
 for(const part of template.parts??[]){
  assertLatticePose(part,lattice,'part '+template.id+'/'+part.id);
  const shape=part.shape;
  fail(shape?.type==='voxelVolume','strict parts must use voxelVolume: '+part.id);
  validateVoxelVolume(shape);
  fail(shape.cellSize===lattice.cellSize,'part spacing differs from frozen scene: '+part.id);
  assertLatticeVector(shape.origin,lattice,'shape.origin '+part.id);
  occupied+=evaluateVoxelVolume(shape).occupiedCells;
  fail(occupied<=VOXEL_LIMITS.filledCells,'template occupied-cell upper budget exceeds 500000');
 }
 return {occupiedUpperBound:occupied};
}

/** Validate actual final geometry, independent of model/schema declarations.
 * Sum occupancy is a conservative preflight bound; overlap is not a budget refund. */
export function validateVoxelGeometry(scene:{voxelLattice?:VoxelLattice;program:GeometryProgram}){
 if(!scene.voxelLattice)return scene;
 const lattice=validateVoxelLattice(scene.voxelLattice),templates=new Map<string,number>();
 for(const template of scene.program.templates)templates.set(template.id,validateVoxelTemplate(template,lattice).occupiedUpperBound);
 let occupied=0;const lower=[Infinity,Infinity,Infinity],upper=[-Infinity,-Infinity,-Infinity];
 for(const instance of scene.program.instances){
  assertLatticePose(instance,lattice,'instance '+instance.id);
  const template=scene.program.templates.find(t=>t.id===instance.template);
  fail(template,'unknown template '+instance.template);
  occupied+=templates.get(instance.template)!;
  fail(occupied<=VOXEL_LIMITS.filledCells,'expanded occupied-cell upper budget exceeds 500000');
  for(const part of template!.parts){
   const shape:any=part.shape;
   for(let corner=0;corner<8;corner++){
    const point=shape.origin.map((n:number,k:number)=>n+((corner&(1<<k))?shape.dimensions[k]*lattice.cellSize:0));
    const world=transformPoint(transformPoint(point as any,part),instance);
    assertLatticeVector(world,lattice,'world corner '+instance.id+'/'+part.id,lattice.origin);
    for(let k=0;k<3;k++){lower[k]=Math.min(lower[k],world[k]);upper[k]=Math.max(upper[k],world[k]);}
   }
  }
 }
 const dims=upper.map((n,k)=>Math.round((n-lower[k])/lattice.cellSize)+2);
 fail(dims.every(n=>Number.isFinite(n)&&n>0&&n<=VOXEL_LIMITS.dimension),'actual geometry exceeds 192 cells per axis including padding');
 fail(dims.reduce((a,b)=>a*b,1)<=VOXEL_LIMITS.gridCells,'actual geometry exceeds 2000000 grid cells');
 validateVoxelMaterials(scene.program.materials);
 return scene;
}

export function validateVoxelMaterials(materials:any[]){for(const material of materials)fail(material.textureId===null&&material.surfaceDetail==null&&material.color?.[3]>=.99,'strict voxel material must be opaque, untextured and without procedural surfaceDetail: '+material.id);}
