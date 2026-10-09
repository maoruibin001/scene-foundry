import {test,expect} from 'bun:test';
import {voxelizeScene,triangleCellOverlap,measuredPalette} from './voxelize';
import {voxelGrid,compileVoxelScene,voxelFile} from './program';
import type {SceneInput} from '../geometry/scene-contract';

const plan={requirements:[{id:'R1',critical:true,count:null}]};
function scene(parts:any[]=[{position:[0,0,.5],shape:{type:'box',size:[1,1,1],radius:0}}]):SceneInput{
 return {version:'scene-v1',program:{version:'geometry-v1',name:'转换契约测试',materials:[{id:'red',color:[1,0,0,1],roughness:1,metallic:0,textureId:null}],templates:[{id:'geometry',parts:parts.map((p,i)=>({id:'part_'+i,material:'red',position:p.position,rotation:[0,0,0],scale:[1,1,1],shape:p.shape}))}],instances:[{id:'subject',label:'主体',template:'geometry',position:[0,0,0],rotation:[0,0,0],scale:[1,1,1],requirementIds:['R1']}]},entities:[{instanceId:'subject',role:'subject',category:'主体'}],cameras:[{name:'参考机位',referenceIndex:1,position:[-3,-4,3],target:[0,0,.5],fov:.785,projection:'orthographic',orthographicHeight:3},{name:'检查机位',referenceIndex:null,position:[3,4,3],target:[0,0,.5],fov:.785,projection:'perspective',orthographicHeight:null}],lighting:{direction:[.4,-.6,-.7],color:[1,1,1],intensity:2,ambientColor:[1,1,1],ambientIntensity:.65,points:[]},textures:[],assumptions:[]};
}
function cellAt(result:ReturnType<typeof voxelizeScene>,world:number[]){const v=world.map((n,k)=>Math.floor((n-result.report.origin[k])/result.program.cellSize));return v[0]+result.grid.size[0]*(v[1]+result.grid.size[1]*v[2]);}

test('triangle rasterization checks actual cell intersections, including thin diagonal faces',()=>{
 const t:[[number,number,number],[number,number,number],[number,number,number]]=[[0,0,0],[2,0,0],[0,2,0]];
 expect(triangleCellOverlap(t,[.5,.5,.5])).toBe(true);
 expect(triangleCellOverlap(t,[1.8,1.8,.5])).toBe(false);
 expect(triangleCellOverlap(t,[.5,.5,2])).toBe(false);
});
test('closed source solids become actual interior voxels; world origin, requirements and cameras remain fixed',()=>{
 const input=scene(),r=voxelizeScene(input,plan,1,{}, {resolution:24});
 expect(r.program.version).toBe('voxel-grid-v2');expect(r.grid.owners[cellAt(r,[0,0,.5])]).toBe(1);
 expect(r.program.palette.map(p=>p.color)).toEqual(['#ff0000']);expect(r.scene.cameras).toEqual(input.cameras);
 expect(r.scene.program.instances[0].requirementIds).toEqual(['R1']);
 expect(r.scene.program.templates[0].parts[0].shape.type).toBe('indexedMesh');
 expect(voxelGrid(JSON.parse(JSON.stringify(r.program))).filled).toBe(r.grid.filled);
 const data=voxelFile(r.program,r.grid);expect(data.subarray(0,4).toString()).toBe('VOX ');expect(data.readUInt32LE(4)).toBe(150);
 expect(r.report.origin[0]).toBeLessThan(-.5);
});
test('actual openings stay empty instead of filling the bounding box of an entity',()=>{
 const input=scene([{position:[-1,0,1],shape:{type:'box',size:[.25,.3,2],radius:0}},{position:[1,0,1],shape:{type:'box',size:[.25,.3,2],radius:0}},{position:[0,0,1.8],shape:{type:'box',size:[2,.3,.3],radius:0}}]);
 const r=voxelizeScene(input,plan,1,{}, {resolution:40});expect(r.grid.owners[cellAt(r,[0,0,.8])]).toBe(0);expect(r.grid.owners[cellAt(r,[-1,0,.8])]).toBe(1);
});
test('shared templates and transformed instances retain separate semantic identities',()=>{
 const input=scene();input.program.instances.push({...input.program.instances[0],id:'second',position:[2,0,0]});input.entities.push({instanceId:'second',role:'subject',category:'主体'});
 const r=voxelizeScene(input,plan,1,{}, {resolution:48});expect(r.report.entities.every(e=>e.cells>0)).toBe(true);expect(r.grid.owners[cellAt(r,[0,0,.5])]).toBe(1);expect(r.grid.owners[cellAt(r,[2,0,.5])]).toBe(2);
});
test('reference texture pixels determine palette colors; no invented model color table',()=>{
 const input=scene();input.program.materials[0].color=[1,1,1,1];input.program.materials[0].textureId='reference_patch';input.textures=[{id:'reference_patch',referenceIndex:1,quad:[[0,0],[.3,0],[.3,.3],[0,.3]],size:256,description:'原图局部表面'}];
 const rgba=Buffer.from([255,0,0,255,0,255,0,255,255,0,0,255,0,255,0,255]);
 const r=voxelizeScene(input,plan,1,{reference_patch:{width:2,height:2,rgba8:rgba.toString('base64'),colorSpace:'srgb'}},{resolution:24});
 expect(r.program.palette.map(p=>p.color)).toContain('#ff0000');expect(r.program.palette.map(p=>p.color)).toContain('#00ff00');
});
test('bounded conversion rejects invalid metadata, overlapping occupancy and missing entities',()=>{
 const r=voxelizeScene(scene(),plan,1,{}, {resolution:20});
 const duplicate=structuredClone(r.program);duplicate.runs!.splice(1,0,duplicate.runs![0]);expect(()=>voxelGrid(duplicate)).toThrow('越界、重叠');
 const missing=structuredClone(r.program);missing.entities.push({...missing.entities[0],id:'missing'});expect(()=>voxelGrid(missing)).toThrow('丢失了实体');
 expect(()=>voxelizeScene(scene(),plan,1,{}, {maxRasterTests:1})).toThrow('有界预算');
 const transparent=scene();transparent.program.materials[0].color[3]=.5;expect(()=>voxelizeScene(transparent,plan,1,{})).toThrow('透明材质');
});
test('weighted measured palette is deterministic and bounded with many sampled colors',()=>{
 const h=new Map(Array.from({length:8000},(_,i)=>[(i*2001)&0xffffff,1]));
 expect(measuredPalette(h,16)).toHaveLength(16);expect(measuredPalette(h,16)).toEqual(measuredPalette(h,16));
});
