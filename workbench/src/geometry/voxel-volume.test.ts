import {test,expect} from 'bun:test';
import {evaluateVoxelVolume,validateVoxelVolume,voxelVolumeMesh,VOXEL_VOLUME_LIMITS,type VoxelVolume} from './voxel-volume';
import {compileGeometryProgram,shapeTriangles,validateGeometryProgram,type GeometryProgram} from './program';
import {geometryProgramSchema,GEOMETRY_RULES} from './program-schema';
import {cross,sub,type V} from './mesh';

const pose={position:[0,0,0] as V,rotation:[0,0,0] as V,scale:[1,1,1] as V};
const volume=(overrides:Partial<VoxelVolume>={}):VoxelVolume=>({type:'voxelVolume',cellSize:.2,origin:[-.5,-.3,-.1],dimensions:[5,3,4],operations:[{mode:'fill',min:[0,0,0],size:[5,3,4],repeat:null}],...overrides});
const program=(shape:VoxelVolume):GeometryProgram=>({version:'geometry-v1',name:'整数体素验收',materials:[{id:'m',color:[.2,.5,.1,1],roughness:.7,metallic:0,textureId:null}],templates:[{id:'t',parts:[{id:'p',material:'m',...pose,shape,smoothAngle:0}]}],instances:[{id:'i',label:'格子结构',template:'t',...pose,requirementIds:[]}]});
const dot=(a:V,b:V)=>a.reduce((sum,x,k)=>sum+x*b[k],0);
function rays(mesh:any,origin:V,direction:V){
 const hits:number[]=[];
 for(let i=0;i<mesh.indices.length;i+=3){
  const [a,b,c]=mesh.indices.slice(i,i+3).map((id:number)=>mesh.positions.slice(id*3,id*3+3) as V),e1=sub(b,a),e2=sub(c,a),h=cross(direction,e2),det=dot(e1,h);if(Math.abs(det)<1e-10)continue;
  const s=sub(origin,a),u=dot(s,h)/det;if(u<0||u>1)continue;const q=cross(s,e1),v=dot(direction,q)/det;if(v<0||u+v>1)continue;const distance=dot(e2,q)/det;if(distance>1e-9&&!hits.some(n=>Math.abs(n-distance)<1e-7))hits.push(distance);
 }
 return hits.sort((a,b)=>a-b);
}
function signedVolume(mesh:any){let sum=0;for(let i=0;i<mesh.indices.length;i+=3){const [a,b,c]=mesh.indices.slice(i,i+3).map((id:number)=>mesh.positions.slice(id*3,id*3+3) as V);sum+=dot(a,cross(b,c))/6;}return sum;}

test('实心体积只输出6个合并外表面；实际编译网格朝外、尺寸及体积准确',()=>{
 const s=volume(),surface=voxelVolumeMesh(s),compiled=compileGeometryProgram(program(s)),g=compiled.meshes[0].geometry;
 expect(surface.faces).toHaveLength(6);expect(surface.occupiedCells).toBe(60);expect(surface.exposedCellFaces).toBe(94);expect(compiled.triangles).toBe(12);expect(shapeTriangles(s)).toBe(compiled.triangles);
 for(let i=0;i<g.indices.length;i+=3){const ids=g.indices.slice(i,i+3),[a,b,c]=ids.map((id:number)=>g.positions.slice(id*3,id*3+3) as V),normal=cross(sub(b,a),sub(c,a));for(const id of ids){const n=g.normals.slice(id*3,id*3+3) as V;expect(Math.hypot(...n)).toBeCloseTo(1,10);expect(dot(normal,n)).toBeGreaterThan(0);}}
 expect(signedVolume(g)).toBeCloseTo(60*.2**3,10);expect(compiled.bounds.min).toEqual(s.origin);expect(compiled.bounds.max[0]).toBeCloseTo(.5,10);expect(compiled.bounds.max[1]).toBeCloseTo(.3,10);expect(compiled.bounds.max[2]).toBeCloseTo(.7,10);
 expect(g.positions.every(Number.isFinite)).toBe(true);expect(g.uvs.every((n:number)=>n>=0&&n<=1)).toBe(true);
});
test('贯通挖空在实际Engine消费网格中保持通透，并保留洞内壁与准确体积',()=>{
 const s=volume({cellSize:1,origin:[0,0,0],dimensions:[5,2,5],operations:[{mode:'fill',min:[0,0,0],size:[5,2,5]},{mode:'erase',min:[2,0,1],size:[1,2,3]}]}),g=compileGeometryProgram(program(s)).meshes[0].geometry;
 expect(evaluateVoxelVolume(s).occupiedCells).toBe(44);expect(rays(g,[2.4,-1,2.3],[0,1,0])).toEqual([]);expect(rays(g,[1.4,-1,2.3],[0,1,0])).toEqual([1,3]);
 const inside=rays(g,[2.4,1,2.3],[1,0,0]);expect(inside).toHaveLength(2);expect(inside[0]).toBeCloseTo(.6,10);expect(inside[1]).toBeCloseTo(2.6,10);expect(signedVolume(g)).toBeCloseTo(44,9);
 expect(g.indices.length/3).toBe(shapeTriangles(s));
});
test('操作顺序决定最终实体，挖空后允许局部补回，不改变输入',()=>{
 const s=volume({cellSize:1,origin:[0,0,0],dimensions:[3,1,1],operations:[{mode:'fill',min:[0,0,0],size:[3,1,1]},{mode:'erase',min:[1,0,0],size:[1,1,1]},{mode:'fill',min:[1,0,0],size:[1,1,1]}]}),before=JSON.stringify(s);
 expect(evaluateVoxelVolume(s).occupiedCells).toBe(3);expect(voxelVolumeMesh(s).triangles).toBe(12);expect(JSON.stringify(s)).toBe(before);
 s.operations.reverse();expect([...evaluateVoxelVolume(s).occupied]).toEqual([1,1,1]);
 s.operations=[{mode:'erase',min:[0,0,0],size:[3,1,1]},{mode:'fill',min:[1,0,0],size:[1,1,1]}];expect([...evaluateVoxelVolume(s).occupied]).toEqual([0,1,0]);
 s.operations.reverse();expect(()=>evaluateVoxelVolume(s)).toThrow('为空');
});
test('有界重复支持正负步进，分离板条的间隙不会被合并面填满',()=>{
 const s=volume({cellSize:1,origin:[0,0,0],dimensions:[7,3,1],operations:[{mode:'fill',min:[0,0,0],size:[1,3,1],repeat:{count:4,step:[2,0,0]}}]}),g=compileGeometryProgram(program(s)).meshes[0].geometry;
 expect(validateVoxelVolume(s)).toEqual({cells:21,writes:12,expandedOperations:4});expect(evaluateVoxelVolume(s).occupiedCells).toBe(12);expect(rays(g,[1.4,-1,.4],[0,1,0])).toEqual([]);expect(rays(g,[2.4,-1,.4],[0,1,0])).toEqual([1,4]);
 const backwards=structuredClone(s);backwards.operations[0].min=[6,0,0];backwards.operations[0].repeat={count:4,step:[-2,0,0]};expect(voxelVolumeMesh(backwards)).toEqual(voxelVolumeMesh(s));
 s.operations.push({mode:'erase',min:[0,1,0],size:[1,1,1],repeat:{count:4,step:[2,0,0]}});expect(evaluateVoxelVolume(s).occupiedCells).toBe(8);
});
test('台阶由少量整数体积构造生成，台阶轮廓及总体积保持',()=>{
 const s=volume({cellSize:1,origin:[0,0,0],dimensions:[6,2,3],operations:[{mode:'fill',min:[0,0,0],size:[6,2,1]},{mode:'fill',min:[1,0,1],size:[5,2,1]},{mode:'fill',min:[2,0,2],size:[4,2,1]}]}),g=compileGeometryProgram(program(s)).meshes[0].geometry;
 expect(evaluateVoxelVolume(s).occupiedCells).toBe(30);expect(signedVolume(g)).toBeCloseTo(30,9);expect(rays(g,[.4,.4,4],[0,0,-1])).toEqual([3,4]);expect(rays(g,[1.4,.4,4],[0,0,-1])).toEqual([2,4]);expect(rays(g,[2.4,.4,4],[0,0,-1])).toEqual([1,4]);
});
test('越界、非整数、非有限数、额外代码及空体积在编译前被拒绝',()=>{
 const changes=[(s:any)=>s.cellSize=Infinity,(s:any)=>s.cellSize=0,(s:any)=>s.origin[0]=NaN,(s:any)=>s.dimensions[0]=3.5,(s:any)=>s.dimensions[0]=193,(s:any)=>s.operations[0].size[1]=0,(s:any)=>s.operations[0].min[0]=-1,(s:any)=>s.operations[0].size[0]=6,(s:any)=>s.operations[0].mode='script',(s:any)=>s.code='arbitrary()',(s:any)=>s.operations[0].repeat={count:2,step:[1,0,0]},(s:any)=>s.operations[0].repeat={count:2,step:[-1,0,0]},(s:any)=>s.operations[0].repeat={count:1,step:[.5,0,0]},(s:any)=>s.operations[0].repeat={count:129,step:[0,0,0]},(s:any)=>s.operations=[]];
 for(const change of changes){const s=volume();change(s);expect(()=>validateGeometryProgram(program(s))).toThrow('体素');}
 expect(()=>evaluateVoxelVolume(volume({operations:[{mode:'erase',min:[0,0,0],size:[5,3,4]}]}))).toThrow('为空');
 const overSpan=volume({cellSize:10,dimensions:[11,1,1],operations:[{mode:'fill',min:[0,0,0],size:[11,1,1]}]});expect(()=>validateVoxelVolume(overSpan)).toThrow('物理跨度');
});
test('体积、操作展开、写入和占用预算分别检查，不静默丢弃结构',()=>{
 expect(()=>validateVoxelVolume(volume({dimensions:[192,192,192]}))).toThrow('格数');
 const op={mode:'fill' as const,min:[0,0,0] as V,size:[1,1,1] as V,repeat:{count:128,step:[0,0,0] as V}};
 expect(()=>validateVoxelVolume(volume({operations:Array.from({length:257},()=>({...op,repeat:null}))}))).toThrow('operations');
 expect(()=>validateVoxelVolume(volume({operations:Array.from({length:17},()=>op)}))).toThrow('展开操作');
 const big=volume({cellSize:.1,dimensions:[100,100,100],operations:[{mode:'fill',min:[0,0,0],size:[100,100,100],repeat:{count:17,step:[0,0,0]}}]});expect(()=>validateVoxelVolume(big)).toThrow('写入');
 big.operations[0].repeat=null;expect(()=>evaluateVoxelVolume(big)).toThrow('占用格数');
 // A hollow structure can temporarily fill more than the final occupancy cap.
 big.operations.push({mode:'erase',min:[1,1,1],size:[98,98,98]});expect(evaluateVoxelVolume(big).occupiedCells).toBe(58_808);
});
test('棋盘式表面实际三角形超限时拒绝，而不是缩小格数或删除面',()=>{
 const s=volume({cellSize:.1,dimensions:[62,66,64],operations:Array.from({length:62},(_,x)=>({mode:'fill' as const,min:[x,0,x%2] as V,size:[1,66,1] as V,repeat:{count:32,step:[0,0,2] as V}}))});
 // Separated slabs retain all exposed surfaces; subdivided y bands remove their joins.
 for(let y=1;y<66;y+=2)s.operations.push({mode:'erase',min:[0,y,0],size:[62,1,64]});
 expect(evaluateVoxelVolume(s).occupiedCells).toBe(65_472);expect(()=>voxelVolumeMesh(s)).toThrow('三角形预算');
});
test('全程序体素写入及格数预算在任一网格分配前核对，实例仍计入三角形预算',()=>{
 const s=volume({cellSize:.1,dimensions:[100,100,100],operations:[{mode:'fill',min:[0,0,0],size:[1,1,1]}]}),p=program(s);p.templates[0].parts=Array.from({length:5},(_,i)=>({...p.templates[0].parts[0],id:'p'+i}));expect(()=>validateGeometryProgram(p)).toThrow('全程序');
 const writes=program(volume({cellSize:.1,dimensions:[100,100,10],operations:[{mode:'fill',min:[0,0,0],size:[100,100,10],repeat:{count:128,step:[0,0,0]}}]}));writes.templates[0].parts=Array.from({length:3},(_,i)=>({...writes.templates[0].parts[0],id:'p'+i}));expect(()=>validateGeometryProgram(writes)).toThrow('全程序');
 const dense=volume({cellSize:.1,dimensions:[30,3,30],operations:Array.from({length:15},(_,i)=>({mode:'fill' as const,min:[i*2,0,0] as V,size:[1,3,1] as V,repeat:{count:15,step:[0,0,2] as V}}))}),repeated=program(dense);repeated.instances=Array.from({length:100},(_,i)=>({...repeated.instances[0],id:'i'+i}));expect(()=>validateGeometryProgram(repeated)).toThrow('三角形预算');
 const count=shapeTriangles(volume());expect(count).toBe(12);expect(VOXEL_VOLUME_LIMITS.triangles).toBe(250_000);
});
test('模型体素契约显式启用，普通3D schema和默认提示保持原构造范围',()=>{
 const shapes=(options?:{voxel?:boolean})=>geometryProgramSchema([],options).properties.templates.items.properties.parts.items.properties.shape.anyOf;
 expect(shapes().some((s:any)=>s.properties.type.enum[0]==='voxelVolume')).toBe(false);expect(GEOMETRY_RULES).not.toContain('voxelVolume');
 const voxel=shapes({voxel:true}).find((s:any)=>s.properties.type.enum[0]==='voxelVolume');expect(voxel.properties.operations.items.properties.mode.enum).toEqual(['fill','erase']);expect(voxel.properties.dimensions.items.type).toBe('integer');expect(voxel.additionalProperties).toBe(false);
 const scatter=shapes({voxel:true}).find((s:any)=>s.properties.type.enum[0]==='scatter');expect(scatter.properties.element.anyOf.some((s:any)=>s.properties.type.enum[0]==='voxelVolume')).toBe(false);
 expect(shapes({voxel:true}).some((s:any)=>s.properties.type.enum[0]==='indexedMesh')).toBe(false);
});
