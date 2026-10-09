import {test,expect} from 'bun:test';
import {assertLatticePose,assertLatticeVector,validateVoxelLattice,validateVoxelSpace,voxelSpaceGrid,voxelLatticeSchema,VOXEL_LATTICE_CELL_SIZES,QUARTER_TURNS} from './scene-lattice';
import {spaceSchema,spacePlanningSchema,validateSpace} from '../geometry/layout-stages';

const lattice=()=>({version:'voxel-lattice-v1' as const,cellSize:.25,origin:[0,0,0] as [number,number,number]});
function space():any{return {version:'scene-space-v1',voxelLattice:lattice(),program:{templates:[{id:'part',bounds:{min:[-.5,-.25,0],max:[.5,.25,1]}}],instances:[{id:'one',template:'part',position:[1,0,0],rotation:[0,0,Math.PI/2],scale:[1,1,1]}]}};}

test('frozen lattice accepts only explicit supported spacing and zero phase without rewriting input',()=>{
 for(const cellSize of VOXEL_LATTICE_CELL_SIZES){const value={...lattice(),cellSize},before=JSON.stringify(value);expect(validateVoxelLattice(value)).toBe(value);expect(JSON.stringify(value)).toBe(before);}
 for(const value of [undefined,null,[],{}, {...lattice(),version:'other'},{...lattice(),cellSize:.3},{...lattice(),cellSize:NaN},{...lattice(),origin:[.25,0,0]},{...lattice(),origin:[0,0]},{...lattice(),resolution:128}])expect(()=>validateVoxelLattice(value)).toThrow('VOXEL_LATTICE');
 expect(voxelLatticeSchema().properties.cellSize.enum).toEqual([...VOXEL_LATTICE_CELL_SIZES]);
});
test('local coordinates and instance poses reject tiny drift, unsafe scales and nonquarter rotations',()=>{
 expect(()=>assertLatticeVector([-.75,.5,1],lattice(),'corner')).not.toThrow();
 const valid={position:[.75,-.5,0],scale:[1,1,1],rotation:[Math.PI/2,-Math.PI,2*Math.PI]};expect(()=>assertLatticePose(valid,lattice(),'parent')).not.toThrow();
 for(const change of [p=>p.position[0]+=.000123,p=>p.rotation[2]=1e-8,p=>p.rotation[1]=Math.PI/4,p=>p.rotation[0]=3*Math.PI,p=>p.scale[0]=1.0001,p=>p.scale[1]=1.25,p=>p.position[0]=Infinity]){const pose=structuredClone(valid);change(pose);expect(()=>assertLatticePose(pose,lattice(),'parent')).toThrow('VOXEL_LATTICE');}
 for(const value of [[0,0,NaN],[0,0,.125],[0,0], [1e20,0,0]])expect(()=>assertLatticeVector(value,lattice(),'corner')).toThrow('VOXEL_LATTICE');
});
test('transformed planning bounds use exact XYZ quarter turns and include one-cell exterior padding',()=>{
 const value=space(),before=JSON.stringify(value);expect(validateVoxelSpace(value,{required:true})).toBe(value);
 expect(voxelSpaceGrid(value)).toEqual({cellSize:.25,origin:[.5,-.75,-.25],size:[4,6,6],cells:144,bounds:{min:[.75,-.5,0],max:[1.25,.5,1]}});
 value.program.instances[0].rotation=[Math.PI/2,Math.PI/2,0];value.program.instances[0].position=[0,0,0];
 expect(voxelSpaceGrid(value).bounds).toEqual({min:[-.25,-1,-.5],max:[.25,0,.5]});
 expect(JSON.stringify(space())).toBe(before);
});
test('grid admission measures complete world extents including separated instances rather than local asset size',()=>{
 const value=space();value.program.instances.push({...structuredClone(value.program.instances[0]),id:'two',position:[48.25,0,0]});
 expect(()=>validateVoxelSpace(value,{required:true})).toThrow('192');
 value.program.instances.pop();value.program.templates[0].bounds.min=[0,0,0];value.program.templates[0].bounds.max=[47.5,.25,.25];value.program.instances[0].rotation=[0,0,0];
 expect(voxelSpaceGrid(value).size).toEqual([192,3,3]);value.program.templates[0].bounds.max[0]=47.75;expect(()=>voxelSpaceGrid(value)).toThrow('192');
});
test('fixed 2M grid allocation admits boundary-near volume and rejects overflow without coarsening',()=>{
 const value=space();value.program.instances[0].rotation=[0,0,0];value.program.templates[0].bounds={min:[0,0,0],max:[30.75,30.75,30.75]};
 expect(voxelSpaceGrid(value).cells).toBe(1_953_125);value.program.templates[0].bounds.max=[31,31,31];const before=JSON.stringify(value);
 expect(()=>voxelSpaceGrid(value)).toThrow('2000000');expect(JSON.stringify(value)).toBe(before);expect(value.voxelLattice.cellSize).toBe(.25);
});
test('all declared template bounds and parent transforms are validated even for unused templates',()=>{
 for(const change of [v=>v.program.templates[0].bounds.min[0]+=.000123,v=>v.program.templates[0].bounds.max[0]=v.program.templates[0].bounds.min[0],v=>v.program.templates.push(structuredClone(v.program.templates[0])),v=>v.program.instances[0].template='missing',v=>v.program.instances=[],v=>v.voxelLattice=null]){const value=space();change(value);expect(()=>validateVoxelSpace(value)).toThrow('VOXEL_LATTICE');}
 const unused=space();unused.program.templates.push({id:'unused',bounds:{min:[.01,0,0],max:[1,1,1]}});expect(()=>validateVoxelSpace(unused)).toThrow('共同格网');
});
test('ordinary and historical layouts remain opt-in while present invalid lattice is never ignored',()=>{
 const legacy=space();delete legacy.voxelLattice;legacy.program.instances[0].rotation=[.12,.23,.34];legacy.program.instances[0].scale=[1.2,.8,1];legacy.program.templates[0].bounds.min[0]=-.513;
 const before=JSON.stringify(legacy);expect(validateVoxelSpace(legacy)).toBe(legacy);expect(JSON.stringify(legacy)).toBe(before);expect(()=>validateVoxelSpace(legacy,{required:true})).toThrow('缺少voxelLattice');
 expect(()=>validateSpace(legacy,{},1,'simple',{strictVoxel:true})).toThrow('缺少voxelLattice');
 legacy.voxelLattice=lattice();expect(()=>validateVoxelSpace(legacy)).toThrow('VOXEL_LATTICE');
});
test('strict planning schema is explicit and does not mutate any ordinary default schema',()=>{
 const ordinary=spaceSchema(['R1']),before=JSON.stringify(ordinary);const strict=spacePlanningSchema(['R1'],{strictVoxel:true});
 expect(strict.required).toContain('voxelLattice');expect(strict.properties.voxelLattice).toEqual(voxelLatticeSchema());expect(strict.properties.program.properties.instances.items.properties.scale.items.enum).toEqual([1]);expect(strict.properties.program.properties.instances.items.properties.rotation.items.enum).toEqual(QUARTER_TURNS);
 expect(strict.properties).not.toHaveProperty('spatialRelations');expect(ordinary.properties).not.toHaveProperty('voxelLattice');expect(ordinary.properties.program.properties.instances.items.properties.scale.items).not.toHaveProperty('enum');expect(JSON.stringify(spaceSchema(['R1']))).toBe(before);
});
