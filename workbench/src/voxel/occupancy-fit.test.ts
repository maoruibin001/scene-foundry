import {test,expect} from 'bun:test';
import {evaluateVoxelVolume} from '../geometry/voxel-volume';
import {validateVoxelGeometry} from './geometry-lattice';
import {exteriorSurface,fitVoxelOccupancy,interiorCells,largestBox,voxelOccupancyRule,VOXEL_OCCUPANCY} from './occupancy-fit';

const lattice={version:'voxel-lattice-v1',cellSize:.1,origin:[0,0,0]};
const materials=[{id:'blockout',color:[.52,.55,.58,1],roughness:.85,metallic:0,textureId:null}];
/** A solid wall with a through doorway, like the over-filled tower back walls. */
const wall=(id:string)=>({id,parts:[{id:'body',position:[0,0,0],rotation:[0,0,0],scale:[1,1,1],material:'blockout',smoothAngle:0,
 shape:{type:'voxelVolume',cellSize:.1,origin:[0,0,0],dimensions:[60,40,60],operations:[{mode:'fill',min:[0,0,0],size:[60,40,60],repeat:null},{mode:'erase',min:[25,0,0],size:[10,40,20],repeat:null}]}}]});
const space=(templates:any[],copies:number)=>({voxelLattice:lattice,program:{templates:templates.map(t=>({id:t.id})),instances:Array.from({length:copies},(_,i)=>({id:'i'+i,template:templates[0].id,position:[(i%2)*6,Math.floor(i/2)%2*4,Math.floor(i/4)*6],rotation:[0,0,0],scale:[1,1,1]}))}});

test('only new voxel jobs under the policy hollow grayboxes',()=>{
 expect(voxelOccupancyRule({voxelOccupancyPolicy:VOXEL_OCCUPANCY})).toBe(true);
 expect(voxelOccupancyRule({voxelOccupancyPolicy:null})).toBe(false);
 expect(voxelOccupancyRule({})).toBe(false);
});

test('a graybox inside the summed occupancy bound is returned unchanged',()=>{
 const value={templates:[wall('w')]},r=fitVoxelOccupancy(space(value.templates,2),value);
 expect(r.value).toBe(value);expect(r.report).toMatchObject({status:'within-budget',before:2*(144000-8000),changes:[]});
});

test('an over-budget graybox is hollowed inside closed shells without changing any exterior face',()=>{
 const value={templates:[wall('w')]},s=space(value.templates,4),before=structuredClone(value);
 expect(()=>validateVoxelGeometry({voxelLattice:lattice,program:{...s.program,materials,templates:value.templates}} as any)).toThrow(/500000/);
 const r=fitVoxelOccupancy(s,value),shape=r.value.templates[0].parts[0].shape;
 expect(r.report.status).toBe('hollowed');expect(r.report.before).toBe(4*136000);expect(r.report.after).toBeLessThanOrEqual(400000);
 expect(r.report.after).toBe(4*evaluateVoxelVolume(shape).occupiedCells);
 // Only erase operations are appended; the original operations, part pose, template and the input object are untouched.
 expect(shape.operations.slice(0,2)).toEqual(before.templates[0].parts[0].shape.operations);
 expect(shape.operations.slice(2).every((op:any)=>op.mode==='erase')).toBe(true);
 expect(value).toEqual(before);
 expect(exteriorSurface(shape)).toEqual(exteriorSurface(before.templates[0].parts[0].shape as any));
 validateVoxelGeometry({voxelLattice:lattice,program:{...s.program,materials,templates:r.value.templates}} as any);
 // Re-running on the fitted graybox is a no-op.
 expect(fitVoxelOccupancy(s,r.value).value).toBe(r.value);
});

test('thin parts without enclosed interior are left alone and still fail the original bound',()=>{
 const slab={id:'s',parts:[{id:'body',position:[0,0,0],rotation:[0,0,0],scale:[1,1,1],material:'blockout',smoothAngle:0,shape:{type:'voxelVolume',cellSize:.1,origin:[0,0,0],dimensions:[64,64,2],operations:[{mode:'fill',min:[0,0,0],size:[64,64,2],repeat:null}]}}]};
 const value={templates:[slab]},r=fitVoxelOccupancy(space(value.templates,64),value);
 expect(r.report).toMatchObject({status:'insufficient',changes:[]});expect(r.value).toBe(value);
});

test('interior cells keep a one-cell shell and the largest box covers them exactly',()=>{
 const cube={type:'voxelVolume' as const,cellSize:.1,origin:[0,0,0] as [number,number,number],dimensions:[5,6,7] as [number,number,number],operations:[{mode:'fill' as const,min:[0,0,0] as [number,number,number],size:[5,6,7] as [number,number,number],repeat:null}]};
 const mask=interiorCells(cube);expect(mask.reduce((a,b)=>a+b,0)).toBe(3*4*5);
 expect(largestBox(mask,cube.dimensions)).toEqual({cells:60,min:[1,1,1],size:[3,4,5]});
});
