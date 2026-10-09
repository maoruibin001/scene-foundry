import {expect,test} from 'bun:test';
import {voxelizeScene} from './voxelize';
import {prepareNativeRaster,rasterNativeVolume} from './native-raster';
import {compileGeometryProgram,transformPoint} from '../geometry/program';
import type {VoxelVolume} from '../geometry/voxel-volume';
import type {SceneInput} from '../geometry/scene-contract';

const plan={requirements:[{id:'R1',critical:true,count:null}]};
const door=():VoxelVolume=>({type:'voxelVolume',cellSize:.1,origin:[0,0,0],dimensions:[7,2,7],operations:[{mode:'fill',min:[0,0,0],size:[7,2,7]},{mode:'erase',min:[3,0,0],size:[1,2,5]}]});
const slats=():VoxelVolume=>({type:'voxelVolume',cellSize:.1,origin:[0,0,0],dimensions:[5,5,1],operations:[{mode:'fill',min:[0,0,0],size:[5,1,1],repeat:{count:3,step:[0,2,0]}}]});
function scene(shapes:any[]=[door()]):SceneInput{
 return {version:'scene-v1',program:{version:'geometry-v1',name:'原生体素精度验证',materials:[{id:'red',color:[1,0,0,1],roughness:1,metallic:0,textureId:null}],templates:[{id:'geometry',parts:shapes.map((shape,i)=>({id:'part_'+i,material:'red',position:[0,0,0],rotation:[0,0,0],scale:[1,1,1],shape}))}],instances:[{id:'subject',label:'主体',template:'geometry',position:[0,0,0],rotation:[0,0,0],scale:[1,1,1],requirementIds:['R1']}]},entities:[{instanceId:'subject',role:'subject',category:'主体'}],cameras:[{name:'参考机位',referenceIndex:1,position:[-3,-4,3],target:[0,0,.5],fov:.785,projection:'orthographic',orthographicHeight:3},{name:'检查机位',referenceIndex:null,position:[3,4,3],target:[0,0,.5],fov:.785,projection:'perspective',orthographicHeight:null}],lighting:{direction:[.4,-.6,-.7],color:[1,1,1],intensity:2,ambientColor:[1,1,1],ambientIntensity:.65,points:[]},textures:[],assumptions:[]};
}
function owner(result:ReturnType<typeof voxelizeScene>,point:number[]){const cell=point.map((n,k)=>Math.floor((n-result.program.origin![k])/result.program.cellSize));return result.grid.owners[cell[0]+result.grid.size[0]*(cell[1]+result.grid.size[1]*cell[2])];}
test('原生门洞的单格贯通净空不被三角形边界膨胀封闭',()=>{
 const source=scene(),before=JSON.stringify(source),result=voxelizeScene(source,plan,1,{}, {resolution:16});
 expect(result.program.cellSize).toBeCloseTo(.1);expect(result.grid.filled).toBe(88);
 for(let z=0;z<5;z++)for(const y of [.05,.15])expect(owner(result,[.35,y,(z+.5)*.1])).toBe(0);
 expect(owner(result,[.25,.05,.25])).toBe(1);expect(owner(result,[.45,.05,.25])).toBe(1);expect(owner(result,[.35,.05,.65])).toBe(1);
 expect(result.report.nativeLattice!.mode).toBe('exact-native-lattice');expect(result.report.nativeLattice!.exactMeshes[0].sourceOccupiedCells).toBe(88);
 expect(result.report.rasterTests).toBe(88);expect(JSON.stringify(source)).toBe(before);
});
test('同材质有序重复板条与单格板缝保持准确占用',()=>{
 const result=voxelizeScene(scene([slats()]),plan,1,{}, {resolution:190});
 expect(result.grid.filled).toBe(15);expect(result.program.palette.map(p=>p.color)).toEqual(['#ff0000']);
 for(let x=0;x<5;x++){for(const y of [.15,.35])expect(owner(result,[(x+.5)*.1,y,.05])).toBe(0);for(const y of [.05,.25,.45])expect(owner(result,[(x+.5)*.1,y,.05])).toBe(1);}
});
test('原生整数体积加普通箱体保留共享世界坐标及门洞，其他几何仍采样',()=>{
 const source=scene([door(),{type:'box',size:[.2,.2,.2],radius:0}]);source.program.templates[0].parts[1].position=[1.2,.4,.2];
 const result=voxelizeScene(source,plan,1,{}, {resolution:16});
 expect(result.program.cellSize).toBeCloseTo(.1);expect(owner(result,[.35,.05,.25])).toBe(0);expect(owner(result,[1.2,.4,.2])).toBe(1);
 expect(result.report.nativeLattice!.exactMeshes).toHaveLength(1);expect(result.report.rasterTests).toBeGreaterThan(88);
 expect(result.scene.cameras).toEqual(source.cameras);
});
test('邻接的普通箱体仅触碰原生门洞格的边界时，不把一格净空膨胀封闭',()=>{
 const source=scene([door(),{type:'box',size:[.2,.2,.2],radius:0}]);source.program.templates[0].parts[1].position=[.2,-.1,.2];
 const result=voxelizeScene(source,plan,1,{}, {resolution:24});
 expect(owner(result,[.35,.05,.25])).toBe(0);expect(owner(result,[.35,.05,.15])).toBe(0);expect(owner(result,[.2,-.1,.2])).toBe(1);
 expect(result.grid.filled).toBe(96);
});
test('90度旋转、负轴映射与统一缩放后，门洞和实体所有格保持准确',()=>{
 const source=scene(),part=source.program.templates[0].parts[0],instance=source.program.instances[0];
 part.rotation=[0,0,Math.PI/2];part.scale=[2,2,2];part.position=[.2,-.4,.3];instance.rotation=[Math.PI/2,0,0];instance.scale=[.5,.5,.5];instance.position=[1,-2,3];
 const result=voxelizeScene(source,plan,1,{}, {resolution:24}),point=(p:[number,number,number])=>transformPoint(transformPoint(p,part),instance);
 expect(result.program.cellSize).toBeCloseTo(.1);expect(result.grid.filled).toBe(88);
 expect(owner(result,point([.35,.05,.25]))).toBe(0);expect(owner(result,point([.25,.05,.25]))).toBe(1);
 expect(result.report.nativeLattice!.fallbackMeshes).toHaveLength(0);
});
test('公共半格原点和整数比非均匀轴尺度可有界细分而不填掉空格',()=>{
 const source=scene([door(),slats()]);source.program.templates[0].parts[0].scale=[1,2,1];source.program.templates[0].parts[1].position=[1.05,0,0];
 const result=voxelizeScene(source,plan,1,{}, {resolution:24});
 expect(result.program.cellSize).toBeCloseTo(.05);expect(owner(result,[.35,.1,.25])).toBe(0);expect(owner(result,[1.2,.15,.025])).toBe(0);
 expect(owner(result,[1.2,.05,.025])).toBe(1);expect(result.report.nativeLattice!.exactMeshes).toHaveLength(2);
});
test('不共格的旧浮点摆放不会以GCD爆增格数，显式回退且不声称原生格准确',()=>{
 const source=scene([door(),slats()]);source.program.templates[0].parts[1].position=[Math.SQRT2,0,0];
 const result=voxelizeScene(source,plan,1,{}, {resolution:24});
 expect(result.report.nativeLattice!.mode).toBe('resampled-native-fallback');expect(result.report.nativeLattice!.exactMeshes).toHaveLength(0);
 expect(result.report.nativeLattice!.fallbackMeshes).toHaveLength(2);expect(result.report.nativeLattice!.fallbackMeshes.every(x=>x.occupancyPreservation==='resampled-unverified')).toBe(true);
 expect(Math.max(...result.program.size)).toBeLessThanOrEqual(192);expect(result.report.nativeLattice!.globalLattice).toBeNull();
});
test('小旋转累积到整段体积时超出共格容差，在写入前明确回退',()=>{
 const volume=door();volume.dimensions=[120,2,7];volume.operations=[{mode:'fill',min:[0,0,0],size:[120,2,7]}];
 const source=scene([volume]);source.program.templates[0].parts[0].rotation=[0,0,1e-8];
 const native=prepareNativeRaster(source.program,compileGeometryProgram(source.program));
 expect(native.meshes.size).toBe(0);expect(native.provenance.fallbackMeshes[0].reason).toContain('accumulate off-axis');
 expect(native.provenance.fallbackMeshes[0].occupancyPreservation).toBe('resampled-unverified');
});
test('任意角度旋转和超过全局192格的精度需求显示回退原因，不删除资产',()=>{
 const rotated=scene();rotated.program.templates[0].parts[0].rotation=[0,0,Math.PI/4];
 const result=voxelizeScene(rotated,plan,1,{}, {resolution:24});expect(result.report.nativeLattice!.fallbackMeshes[0].reason).toContain('signed-axis');expect(result.report.entities[0].cells).toBeGreaterThan(0);
 const long=door();long.dimensions=[192,2,7];long.operations=[{mode:'fill',min:[0,0,0],size:[192,2,7]}];
 const out=voxelizeScene(scene([long]),plan,1,{}, {resolution:24});expect(out.report.nativeLattice!.mode).toBe('resampled-native-fallback');expect(out.report.nativeLattice!.fallbackMeshes[0].reason).toContain('fixed 192-axis');
});
test('有纹理的原生材质保留实际像素转换并明确标注占用重采样限制',()=>{
 const source=scene();source.program.materials[0].color=[1,1,1,1];source.program.materials[0].textureId='patch';source.textures=[{id:'patch',referenceIndex:1,quad:[[0,0],[.3,0],[.3,.3],[0,.3]],size:256,description:'原图局部纹理'}];
 const pixels=Buffer.from([255,0,0,255,0,255,0,255,255,0,0,255,0,255,0,255]);
 const result=voxelizeScene(source,plan,1,{patch:{width:2,height:2,rgba8:pixels.toString('base64'),colorSpace:'srgb'}},{resolution:24});
 expect(result.report.nativeLattice!.fallbackMeshes[0].reason).toContain('texture pixels');expect(result.program.palette.some(p=>p.color==='#ff0000'||p.color==='#00ff00')).toBe(true);
});
test('原生占用写入、透明材质、显式错格由预算检查拒绝而不悄悄裁切',()=>{
 expect(()=>voxelizeScene(scene(),plan,1,{}, {maxRasterTests:1})).toThrow('有界预算');
 const transparent=scene();transparent.program.materials[0].color[3]=.5;expect(()=>voxelizeScene(transparent,plan,1,{})).toThrow('透明材质');
 const source=scene(),native=prepareNativeRaster(source.program,compileGeometryProgram(source.program)),volume=[...native.meshes.values()][0];
 expect(()=>rasterNativeVolume(volume,{unit:.07,origin:[0,0,0],size:[20,20,20]},()=>{},1000)).toThrow('cell spacing');
 expect(()=>rasterNativeVolume(volume,{unit:.1,origin:[.05,0,0],size:[20,20,20]},()=>{},1000)).toThrow('off lattice');
});
test('不含原生体积时报告和转换保持原有路径',()=>{
 const source=scene([{type:'box',size:[1,1,1],radius:0}]);source.program.templates[0].parts[0].position=[0,0,.5];
 const native=prepareNativeRaster(source.program,compileGeometryProgram(source.program)),result=voxelizeScene(source,plan,1,{}, {resolution:24});
 expect(native.provenance.mode).toBe('not-applicable');expect(native.meshes.size).toBe(0);expect(native.unit).toBeNull();expect(result.report).not.toHaveProperty('nativeLattice');
 expect(result.program.cellSize).toBeCloseTo(1/22);expect(owner(result,[0,0,.5])).toBe(1);
});
