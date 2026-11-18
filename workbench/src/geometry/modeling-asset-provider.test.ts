import {test,expect} from 'bun:test';
import {createModelingAssetProvider,meshToAssetGeometry,normalizeMesh} from './modeling-asset-provider';
import {validateAllocatedAsset} from './asset-validation';

// 一个单位立方体网格(8 顶点/12 三角),代表"引擎 modeling 内核 bake 出的某物体"。
const cube={
 positions:[[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]] as number[][],
 triangles:[[0,1,2],[0,2,3],[4,6,5],[4,7,6],[0,4,5],[0,5,1],[1,5,6],[1,6,2],[2,6,7],[2,7,3],[3,7,4],[3,4,0]] as [number,number,number][],
};
const brief={id:'box',label:'box',description:'a box',origin:'scene',bounds:{min:[-0.5,-0.5,0],max:[0.5,0.5,1]},materialIds:['m1'],maxParts:4};
const layout={voxelLattice:undefined,spatialOpenings:[],spatialContacts:[],program:{version:'geometry-v1',name:'scene',
 materials:[{id:'m1',color:[0.6,0.5,0.4,1],roughness:0.8,metallic:0,textureId:null,surfaceDetail:null,emission:null}],
 templates:[{id:'box',label:'box',description:'a box',origin:'scene',bounds:brief.bounds,materialIds:['m1'],maxParts:4,parts:[]}],
 instances:[{id:'i1',label:'box',template:'box',position:[1,1,0],rotation:[0,0,0],scale:[1,1,1],surfaceOverrides:[],requirementIds:[]}]}} as any;

test('modeling mesh -> AssetProvider -> validateAsset -> compiled within brief.bounds',async()=>{
 const provider=createModelingAssetProvider(async()=>cube);
 const asset=await provider({brief:brief as any,layout,textures:{}});
 expect(asset.version).toBe('asset-geometry-v1');
 expect(asset.template.parts).toHaveLength(1);
 expect((asset.template.parts[0].shape as any).type).toBe('indexedMesh');
 expect(asset.template.parts[0].material).toBe('m1');
 const checked=validateAllocatedAsset(asset,brief as any,layout,{});
 expect(checked.triangles).toBe(12);
 for(let k=0;k<3;k++){expect(checked.bounds.min[k]).toBeGreaterThanOrEqual(brief.bounds.min[k]-0.05);expect(checked.bounds.max[k]).toBeLessThanOrEqual(brief.bounds.max[k]+0.05);}
});

test('meshToAssetGeometry rejects empty / out-of-range meshes',()=>{
 expect(()=>meshToAssetGeometry(brief as any,{positions:[],triangles:[]})).toThrow('网格为空');
 expect(()=>meshToAssetGeometry(brief as any,{positions:[[0,0,0]],triangles:[[0,5,9]]})).toThrow('索引越界');
});

test('normalizeMesh accepts MeshAsset(attributes.position + indices) and plain form',()=>{
 const asset={kind:'mesh',indices:[0,1,2],attributes:{position:[0,0,0,1,0,0,0,1,0]}};
 expect(normalizeMesh(asset)).toEqual({positions:[[0,0,0],[1,0,0],[0,1,0]],triangles:[[0,1,2]]});
 expect(normalizeMesh({value:{'mesh/x':asset}})).toEqual({positions:[[0,0,0],[1,0,0],[0,1,0]],triangles:[[0,1,2]]});
 expect(normalizeMesh(cube)).toBe(cube);
});
